/**
 * @file game-engine.js
 * @description The rules engine. Pure, side-effect-free transitions over a
 * GameState. Every function returns a *new* state (or a validation error) and
 * never mutates its input, which keeps the engine trivially testable and makes
 * optimistic UI updates safe.
 *
 * The engine is the single source of truth for legality. The UI may permit
 * messy intermediate arrangements, but a turn can only be committed through
 * {@link commitTurn}, which enforces every rule.
 */

import {
  GAME_STATUS,
  SEAT,
  INITIAL_MELD_MIN_POINTS,
} from './constants.js';
import { analyzeBoard } from './validation.js';
import { otherSeat, handOf } from '../models/game-state.js';
import { scoreEndgame } from './scoring.js';

/**
 * @typedef {Object} TurnResult
 * @property {boolean} ok
 * @property {?string} error              Human-readable reason when ok === false.
 * @property {?import('../models/game-state.js').GameState} state  New state when ok.
 */

/** Collects every tile id contained in a list of melds. */
function tileIdsOfBoard(board) {
  const ids = new Set();
  for (const meld of board) {
    for (const tile of meld.tiles) ids.add(tile.id);
  }
  return ids;
}

/** Collects every tile id from a flat tile list. */
function tileIdsOf(tiles) {
  return new Set(tiles.map((tile) => tile.id));
}

/** True when two sets contain exactly the same members. */
function sameMembers(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Returns the ids of jokers currently sitting on the board. */
function boardJokerIds(board) {
  const ids = new Set();
  for (const meld of board) {
    for (const tile of meld.tiles) if (tile.isJoker) ids.add(tile.id);
  }
  return ids;
}

/**
 * Records a second player joining and starts the game.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @param {string} guestId
 * @param {?string} [guestDeviceId] Stable device id of the joining player.
 * @returns {import('../models/game-state.js').GameState}
 */
export function joinGame(state, guestId, guestDeviceId = null) {
  return {
    ...state,
    guestId,
    status: GAME_STATUS.IN_PROGRESS,
    devices: { ...state.devices, guest: guestDeviceId },
    updatedAt: Date.now(),
  };
}

/**
 * Active player draws the top tile from the pool and passes the turn. This is
 * the fallback move when a player cannot or chooses not to meld.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @param {string} seat Seat performing the draw (must equal currentTurn).
 * @returns {TurnResult}
 */
export function drawTile(state, seat) {
  if (state.status !== GAME_STATUS.IN_PROGRESS) {
    return { ok: false, error: 'Das Spiel läuft nicht.', state: null };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, error: 'Du bist nicht am Zug.', state: null };
  }

  const pool = [...state.pool];

  // Pool empty: drawing is impossible, so this triggers the endgame.
  if (pool.length === 0) {
    return endGameByExhaustion(state);
  }

  const drawn = pool.pop();
  const hands = {
    ...state.hands,
    [seat]: [...handOf(state, seat), drawn],
  };

  return {
    ok: true,
    error: null,
    state: {
      ...state,
      pool,
      hands,
      currentTurn: otherSeat(seat),
      turnNumber: state.turnNumber + 1,
      lastAction: 'Gegner hat einen Stein gezogen.',
      lastMoves: { ...state.lastMoves, [seat]: { type: 'draw', tilesPlayed: 0 } },
      updatedAt: Date.now(),
    },
  };
}

/**
 * Ends the game because no more tiles can be drawn, scoring both hands.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @returns {TurnResult}
 */
export function endGameByExhaustion(state) {
  const { winner } = scoreEndgame(state.hands.host, state.hands.guest);
  return {
    ok: true,
    error: null,
    state: {
      ...state,
      status: GAME_STATUS.FINISHED,
      winner,
      lastAction: 'Nachziehstapel leer – Spielende durch Wertung.',
      updatedAt: Date.now(),
    },
  };
}

/**
 * Validates and commits a turn in which the player rearranged the board and/or
 * played tiles from their hand.
 *
 * @param {import('../models/game-state.js').GameState} state Authoritative state at turn start.
 * @param {string} seat Seat committing the turn (must equal currentTurn).
 * @param {{ board: import('../game/validation.js').Meld[], hand: import('../models/tile.js').Tile[] }} proposed
 *        The player's intended resulting board and own hand.
 * @returns {TurnResult}
 */
export function commitTurn(state, seat, proposed) {
  if (state.status !== GAME_STATUS.IN_PROGRESS) {
    return { ok: false, error: 'Das Spiel läuft nicht.', state: null };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, error: 'Du bist nicht am Zug.', state: null };
  }

  const startHand = handOf(state, seat);
  const proposedBoard = proposed.board;
  const proposedHand = proposed.hand;

  // (1) Tile conservation: the union of {this player's hand, board} must be
  //     unchanged. The player may not touch the pool or the opponent's hand.
  const beforeIds = new Set([
    ...tileIdsOfBoard(state.board),
    ...tileIdsOf(startHand),
  ]);
  const afterIds = new Set([
    ...tileIdsOfBoard(proposedBoard),
    ...tileIdsOf(proposedHand),
  ]);
  if (!sameMembers(beforeIds, afterIds)) {
    return {
      ok: false,
      error: 'Es wurden Steine verändert, die dir nicht gehören.',
      state: null,
    };
  }

  // (2) A joker taken from the board may never be moved onto a rack. This is
  //     an absolute rule, checked before anything else about the move.
  const jokersBefore = boardJokerIds(state.board);
  const jokersAfter = boardJokerIds(proposedBoard);
  for (const jokerId of jokersBefore) {
    if (!jokersAfter.has(jokerId)) {
      return {
        ok: false,
        error: 'Ein Joker vom Spielfeld muss wieder ausgelegt werden.',
        state: null,
      };
    }
  }

  // (3) The player must have placed at least one tile from their rack.
  if (proposedHand.length >= startHand.length) {
    return {
      ok: false,
      error: 'Du musst mindestens einen eigenen Stein auslegen oder ziehen.',
      state: null,
    };
  }

  // (4) Every meld on the resulting board must be valid.
  const boardAnalysis = analyzeBoard(proposedBoard);
  if (!boardAnalysis.valid) {
    return {
      ok: false,
      error:
        boardAnalysis.reason ??
        'Auf dem Spielfeld liegen ungültige Kombinationen.',
      state: null,
    };
  }

  // (5) Initial-meld rule: a player who has not yet melded 30 points may not
  //     touch existing melds and must lay down >= 30 points of brand-new tiles.
  if (!state.hasMadeInitialMeld[seat]) {
    const initialCheck = validateInitialMeld(state.board, proposedBoard);
    if (!initialCheck.ok) return { ok: false, error: initialCheck.error, state: null };
  }

  // All checks passed — build the committed state.
  const hands = { ...state.hands, [seat]: proposedHand };
  const playerIsOut = proposedHand.length === 0;
  const tilesPlayed = startHand.length - proposedHand.length;

  return {
    ok: true,
    error: null,
    state: {
      ...state,
      board: proposedBoard,
      hands,
      hasMadeInitialMeld: {
        ...state.hasMadeInitialMeld,
        [seat]: true,
      },
      currentTurn: playerIsOut ? state.currentTurn : otherSeat(seat),
      status: playerIsOut ? GAME_STATUS.FINISHED : state.status,
      winner: playerIsOut ? seat : state.winner,
      turnNumber: state.turnNumber + 1,
      lastAction: playerIsOut
        ? 'Gegner hat alle Steine abgelegt.'
        : 'Gegner hat Steine ausgelegt.',
      lastMoves: { ...state.lastMoves, [seat]: { type: 'meld', tilesPlayed } },
      updatedAt: Date.now(),
    },
  };
}

/**
 * Enforces the first-meld rules (house variant):
 *
 *  - The 30+ points required to "open" must come from **brand-new melds built
 *    only from the player's own tiles** — not by attaching to, or rearranging,
 *    anything already on the board.
 *  - Once that threshold is met the player may *additionally* extend existing
 *    melds with their own tiles in the same turn. Those extensions do not count
 *    toward the 30 points.
 *  - Existing melds may grow but must not be split, merged or have tiles
 *    removed.
 *
 * @param {import('../game/validation.js').Meld[]} startBoard
 * @param {import('../game/validation.js').Meld[]} proposedBoard
 * @returns {{ ok: boolean, error: ?string }}
 */
export function validateInitialMeld(startBoard, proposedBoard) {
  // Map every pre-existing tile to the meld it belonged to.
  const oldMeldOfTile = new Map();
  for (const meld of startBoard) {
    for (const tile of meld.tiles) oldMeldOfTile.set(tile.id, meld.id);
  }

  const rearrangeError =
    'Beim ersten Auslegen dürfen vorhandene Kombinationen nur erweitert, ' +
    'nicht umsortiert oder zusammengelegt werden.';

  let newPoints = 0;
  let placedPureNewMeld = false;

  for (const meld of proposedBoard) {
    const touchedOldMelds = new Set();
    for (const tile of meld.tiles) {
      if (oldMeldOfTile.has(tile.id)) {
        touchedOldMelds.add(oldMeldOfTile.get(tile.id));
      }
    }

    // A single resulting meld may contain tiles from at most one existing meld
    // (otherwise two existing melds were merged).
    if (touchedOldMelds.size > 1) {
      return { ok: false, error: rearrangeError };
    }

    // A meld made purely of freshly-played tiles is what counts toward 30.
    if (touchedOldMelds.size === 0) {
      placedPureNewMeld = true;
      newPoints += meldPoints(meld);
    }
  }

  // Every existing meld must survive intact (all its tiles together) inside one
  // resulting meld — it may have gained tiles, but never lost or split any.
  for (const meld of startBoard) {
    const survives = proposedBoard.some((candidate) => {
      const ids = new Set(candidate.tiles.map((tile) => tile.id));
      return meld.tiles.every((tile) => ids.has(tile.id));
    });
    if (!survives) {
      return { ok: false, error: rearrangeError };
    }
  }

  if (!placedPureNewMeld || newPoints < INITIAL_MELD_MIN_POINTS) {
    return {
      ok: false,
      error:
        `Zum ersten Auslegen brauchst du mindestens ${INITIAL_MELD_MIN_POINTS} ` +
        'Punkte aus komplett neuen, eigenen Kombinationen (ohne Anlegen).',
    };
  }

  return { ok: true, error: null };
}

/** Recomputes a single meld's point value via the validator. */
function meldPoints(meld) {
  return analyzeBoard([meld]).points;
}
