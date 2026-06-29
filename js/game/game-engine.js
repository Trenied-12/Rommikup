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
 * @returns {import('../models/game-state.js').GameState}
 */
export function joinGame(state, guestId) {
  return {
    ...state,
    guestId,
    status: GAME_STATUS.IN_PROGRESS,
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
      updatedAt: Date.now(),
    },
  };
}

/**
 * Enforces the first-meld rules: existing melds must be untouched, and the
 * tiles newly added this turn must form their own melds worth >= 30 points.
 *
 * @param {import('../game/validation.js').Meld[]} startBoard
 * @param {import('../game/validation.js').Meld[]} proposedBoard
 * @returns {{ ok: boolean, error: ?string }}
 */
export function validateInitialMeld(startBoard, proposedBoard) {
  const oldTileIds = tileIdsOfBoard(startBoard);

  // Each resulting meld must be entirely old (untouched) or entirely new.
  // Mixing means the player extended/altered an existing meld, which is
  // forbidden before the first meld is made.
  let newPoints = 0;
  let placedAnyNew = false;

  for (const meld of proposedBoard) {
    const newTiles = meld.tiles.filter((tile) => !oldTileIds.has(tile.id));
    const oldTiles = meld.tiles.filter((tile) => oldTileIds.has(tile.id));

    if (newTiles.length > 0 && oldTiles.length > 0) {
      return {
        ok: false,
        error:
          'Beim ersten Auslegen dürfen vorhandene Kombinationen nicht ' +
          'verändert werden.',
      };
    }

    if (newTiles.length > 0) {
      placedAnyNew = true;
      // analyzeBoard already validated each meld; recompute its points here.
      newPoints += meldPoints(meld);
    }
  }

  // Existing melds must all still be present and unchanged in shape.
  if (!existingMeldsUnchanged(startBoard, proposedBoard)) {
    return {
      ok: false,
      error:
        'Beim ersten Auslegen dürfen vorhandene Kombinationen nicht ' +
        'verändert werden.',
    };
  }

  if (!placedAnyNew || newPoints < INITIAL_MELD_MIN_POINTS) {
    return {
      ok: false,
      error: `Zum ersten Auslegen brauchst du mindestens ${INITIAL_MELD_MIN_POINTS} Punkte aus eigenen Steinen.`,
    };
  }

  return { ok: true, error: null };
}

/** Recomputes a single meld's point value via the validator. */
function meldPoints(meld) {
  // Local import avoided to keep the module graph simple; analyzeBoard reuse.
  return analyzeBoard([meld]).points;
}

/**
 * Confirms that every meld present at the start of the turn still exists with
 * exactly the same set of tile ids (order may differ but contents may not).
 *
 * @param {import('../game/validation.js').Meld[]} startBoard
 * @param {import('../game/validation.js').Meld[]} proposedBoard
 * @returns {boolean}
 */
function existingMeldsUnchanged(startBoard, proposedBoard) {
  const proposedSignatures = proposedBoard.map((meld) =>
    meld.tiles
      .map((tile) => tile.id)
      .sort()
      .join('|'),
  );

  for (const meld of startBoard) {
    const signature = meld.tiles
      .map((tile) => tile.id)
      .sort()
      .join('|');
    const matchIndex = proposedSignatures.indexOf(signature);
    if (matchIndex === -1) return false;
    // Consume the match so two identical melds both need a counterpart.
    proposedSignatures.splice(matchIndex, 1);
  }

  return true;
}
