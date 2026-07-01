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
  PAUSE_STATE,
} from './constants.js';
import { analyzeBoard } from './validation.js';
import { otherSeat, handOf, createIdlePause } from '../models/game-state.js';
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
    turnStartedAt: Date.now(), // the host's first turn clock starts now
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

  // Pool empty: there is nothing to draw, so the player simply passes. Drawing
  // never wins the game. Only when BOTH players pass in a row (neither can or
  // wants to play and the pool is gone) does the game end by point-scoring.
  if (pool.length === 0) {
    const passes = (state.consecutivePasses ?? 0) + 1;
    if (passes >= 2) {
      return endGameByExhaustion(state);
    }
    return {
      ok: true,
      error: null,
      state: {
        ...state,
        currentTurn: otherSeat(seat),
        turnNumber: state.turnNumber + 1,
        turnStartedAt: Date.now(),
        consecutivePasses: passes,
        lastAction: 'Gegner musste aussetzen (Stapel leer).',
        lastMoves: { ...state.lastMoves, [seat]: { type: 'pass', tilesPlayed: 0 } },
        livePreview: null,
        updatedAt: Date.now(),
      },
    };
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
      turnStartedAt: Date.now(),
      consecutivePasses: 0,
      lastAction: 'Gegner hat einen Stein gezogen.',
      lastMoves: { ...state.lastMoves, [seat]: { type: 'draw', tilesPlayed: 0 } },
      livePreview: null,
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
      livePreview: null,
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
      consecutivePasses: 0,
      turnNumber: state.turnNumber + 1,
      turnStartedAt: Date.now(),
      lastAction: playerIsOut
        ? 'Gegner hat alle Steine abgelegt.'
        : 'Gegner hat Steine ausgelegt.',
      lastMoves: { ...state.lastMoves, [seat]: { type: 'meld', tilesPlayed } },
      livePreview: null,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Enforces the first-meld rule (house variant):
 *
 * The only requirement is that, at the end of the turn, the player's own
 * brand-new melds — combinations made entirely of tiles they just played, with
 * nothing from the board mixed in — are worth at least 30 points and stand on
 * their own. Because the whole board is validated separately, the player is
 * otherwise free to rearrange, split, merge or extend everything else (their
 * own extra tiles and the opponent's existing melds included).
 *
 * Checking the *final* board guarantees those 30-point melds were actually laid
 * down and remain in place as standalone melds.
 *
 * @param {import('../game/validation.js').Meld[]} startBoard
 * @param {import('../game/validation.js').Meld[]} proposedBoard
 * @returns {{ ok: boolean, error: ?string }}
 */
export function validateInitialMeld(startBoard, proposedBoard) {
  const oldTileIds = tileIdsOfBoard(startBoard);

  // Sum the points of every meld built purely from freshly-played tiles.
  let newPoints = 0;
  for (const meld of proposedBoard) {
    const isPureNew = meld.tiles.every((tile) => !oldTileIds.has(tile.id));
    if (isPureNew) newPoints += meldPoints(meld);
  }

  if (newPoints < INITIAL_MELD_MIN_POINTS) {
    return {
      ok: false,
      error:
        `Zum ersten Auslegen brauchst du mindestens ${INITIAL_MELD_MIN_POINTS} ` +
        'Punkte aus eigenen, eigenständigen Kombinationen (ohne Anlegen an ' +
        'Vorhandenes).',
    };
  }

  return { ok: true, error: null };
}

/** Recomputes a single meld's point value via the validator. */
function meldPoints(meld) {
  return analyzeBoard([meld]).points;
}

// --------------------------------------------------------------------- pause

/**
 * Pause transitions return *partial field updates* instead of a whole state:
 * the caller persists exactly these fields (Firestore `updateDoc`), so a pause
 * action can never overwrite a turn that is being committed at the same moment.
 *
 * @typedef {Object} PauseResult
 * @property {boolean} ok
 * @property {?string} error   Human-readable reason when ok === false.
 * @property {?Object} fields  Partial GameState fields to persist when ok.
 */

/** Reads the pause record, tolerating documents from before the feature. */
export function pauseOf(state) {
  return state.pause ?? createIdlePause();
}

/**
 * One player asks to pause the game.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @param {string} seat Requesting seat (one of SEAT).
 * @returns {PauseResult}
 */
export function requestPause(state, seat) {
  if (state.status !== GAME_STATUS.IN_PROGRESS) {
    return { ok: false, error: 'Das Spiel läuft nicht.', fields: null };
  }
  if (pauseOf(state).state !== PAUSE_STATE.IDLE) {
    return { ok: false, error: 'Es läuft bereits eine Pause-Anfrage.', fields: null };
  }
  return {
    ok: true,
    error: null,
    fields: {
      pause: {
        state: PAUSE_STATE.REQUESTED,
        requestedBy: seat,
        resumeVotes: { host: false, guest: false },
        pausedAt: null,
      },
    },
  };
}

/**
 * The opponent answers an open pause request. Accepting freezes the clock.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @param {string} seat Answering seat — must not be the requester.
 * @param {boolean} accept
 * @returns {PauseResult}
 */
export function respondToPause(state, seat, accept) {
  const pause = pauseOf(state);
  if (pause.state !== PAUSE_STATE.REQUESTED || pause.requestedBy === seat) {
    return { ok: false, error: 'Keine offene Pause-Anfrage.', fields: null };
  }
  if (!accept) {
    return { ok: true, error: null, fields: { pause: createIdlePause() } };
  }
  return {
    ok: true,
    error: null,
    fields: {
      pause: {
        state: PAUSE_STATE.ACTIVE,
        requestedBy: pause.requestedBy,
        resumeVotes: { host: false, guest: false },
        pausedAt: Date.now(),
      },
    },
  };
}

/**
 * A player consents to resuming. Only when both seats have voted does the game
 * continue; the turn clock is shifted by the pause duration so no turn time is
 * lost.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @param {string} seat Voting seat.
 * @returns {PauseResult}
 */
export function voteResume(state, seat) {
  const pause = pauseOf(state);
  if (pause.state !== PAUSE_STATE.ACTIVE) {
    return { ok: false, error: 'Das Spiel ist nicht pausiert.', fields: null };
  }

  const resumeVotes = { ...pause.resumeVotes, [seat]: true };
  if (!resumeVotes.host || !resumeVotes.guest) {
    return {
      ok: true,
      error: null,
      fields: { pause: { ...pause, resumeVotes } },
    };
  }

  const pausedForMs = Math.max(0, Date.now() - (pause.pausedAt ?? Date.now()));
  return {
    ok: true,
    error: null,
    fields: {
      pause: createIdlePause(),
      turnStartedAt: state.turnStartedAt + pausedForMs,
    },
  };
}
