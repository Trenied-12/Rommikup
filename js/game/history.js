/**
 * @file history.js
 * @description Pure helpers for the game history ("Spielverlauf"). After every
 * move a *snapshot* of the complete game is recorded — board, both hands, pool
 * size and what just happened — so a finished game can be replayed turn by turn
 * from either player's point of view. This module also derives the per-player
 * summaries shown in "Meine letzten Spiele".
 *
 * No DOM, no Firebase: everything here is a pure function of its inputs.
 *
 * @typedef {import('../models/game-state.js').GameState} GameState
 *
 * @typedef {Object} HistorySnapshot
 * @property {number} index            0 = initial deal, then one entry per move.
 * @property {number} turnNumber       State turn number after the move.
 * @property {number} at               Epoch millis the entry was recorded.
 * @property {?string} actor           Seat that moved (null for the deal).
 * @property {string} action           One of HISTORY_ACTION.
 * @property {number} tilesPlayed      Tiles laid down in this move.
 * @property {boolean} timedOut        True when the move was forced by the timer.
 * @property {import('./validation.js').Meld[]} board
 * @property {{ host: import('../models/tile.js').Tile[], guest: import('../models/tile.js').Tile[] }} hands
 * @property {number} poolCount
 * @property {{ host: boolean, guest: boolean }} hasMadeInitialMeld
 * @property {string} currentTurn      Seat to move next.
 * @property {string} status           One of GAME_STATUS.
 * @property {?string} winner          One of SEAT, or null.
 *
 * @typedef {Object} GameSummary
 * @property {string} roomCode
 * @property {string} seat             The owner's seat in that game.
 * @property {string} status           One of GAME_STATUS.
 * @property {?string} result          One of GAME_RESULT (null while running).
 * @property {number} createdAt
 * @property {?number} startedAt
 * @property {?number} finishedAt
 * @property {number} turns            Completed moves.
 * @property {number} myTilesLeft
 * @property {number} opponentTilesLeft
 * @property {?number} myPenalty       Remaining points at the end (finished only).
 * @property {?number} opponentPenalty
 * @property {number} updatedAt
 */

import {
  GAME_STATUS,
  GAME_RESULT,
  HISTORY_ACTION,
  HISTORY_ID_DIGITS,
  STARTING_HAND_SIZE,
} from './constants.js';
import { otherSeat } from '../models/game-state.js';
import { handPenalty } from './scoring.js';

/**
 * The history position a state belongs to: 0 for the initial deal (turn 1),
 * then one higher for every completed move.
 *
 * @param {GameState} state
 * @returns {number}
 */
export function historyIndexOf(state) {
  return state.turnNumber - 1;
}

/**
 * Firestore document id for a history position, zero-padded so ids sort in
 * turn order ("0000", "0001", …).
 *
 * @param {number} index
 * @returns {string}
 */
export function historyEntryId(index) {
  return String(index).padStart(HISTORY_ID_DIGITS, '0');
}

/**
 * Records the complete state right after a move (or the initial deal).
 *
 * @param {GameState} state The state *after* the move.
 * @param {{ actor?: ?string, timedOut?: boolean }} [meta]
 *        actor: the seat that just moved (omit for the initial deal).
 * @returns {HistorySnapshot}
 */
export function buildSnapshot(state, { actor = null, timedOut = false } = {}) {
  const move = actor ? state.lastMoves?.[actor] ?? null : null;
  return {
    index: historyIndexOf(state),
    turnNumber: state.turnNumber,
    at: Date.now(),
    actor,
    action: actor ? move?.type ?? HISTORY_ACTION.DRAW : HISTORY_ACTION.START,
    tilesPlayed: move?.tilesPlayed ?? 0,
    timedOut: Boolean(timedOut),
    board: state.board,
    hands: state.hands,
    poolCount: state.pool.length,
    hasMadeInitialMeld: state.hasMadeInitialMeld,
    currentTurn: state.currentTurn,
    status: state.status,
    winner: state.winner ?? null,
  };
}

/**
 * Tiles that lie on the board in `current` but did not in `previous` — i.e.
 * the tiles freshly played in that move. Used to highlight them in the replay.
 *
 * @param {?HistorySnapshot} previous
 * @param {?HistorySnapshot} current
 * @returns {Set<string>}
 */
export function freshTileIds(previous, current) {
  const fresh = new Set();
  if (!previous || !current) return fresh;

  const before = new Set();
  for (const meld of previous.board) {
    for (const tile of meld.tiles) before.add(tile.id);
  }
  for (const meld of current.board) {
    for (const tile of meld.tiles) {
      if (!before.has(tile.id)) fresh.add(tile.id);
    }
  }
  return fresh;
}

/**
 * Outcome of a game for one seat, or null while it is still running.
 *
 * @param {{ status: string, winner: ?string }} state
 * @param {string} seat
 * @returns {?string} One of GAME_RESULT.
 */
export function resultForSeat(state, seat) {
  if (state.status !== GAME_STATUS.FINISHED) return null;
  if (!state.winner) return GAME_RESULT.DRAW;
  return state.winner === seat ? GAME_RESULT.WON : GAME_RESULT.LOST;
}

/**
 * Remaining penalty points per seat (value of the tiles still on each rack).
 *
 * @param {{ hands: { host: Array, guest: Array } }} state
 * @returns {{ host: number, guest: number }}
 */
export function finalPenalties(state) {
  return {
    host: handPenalty(state.hands.host),
    guest: handPenalty(state.hands.guest),
  };
}

/**
 * True when a finished game ended because the winner laid down all tiles (as
 * opposed to point-scoring after the pool ran out).
 *
 * @param {{ status: string, winner: ?string, hands: Object }} state
 * @returns {boolean}
 */
export function endedByGoingOut(state) {
  return (
    state.status === GAME_STATUS.FINISHED &&
    Boolean(state.winner) &&
    state.hands?.[state.winner]?.length === 0
  );
}

/**
 * Builds the small per-player record shown in "Meine letzten Spiele".
 *
 * @param {GameState} state
 * @param {string} seat The owner's seat.
 * @returns {GameSummary}
 */
export function buildSummary(state, seat) {
  const opponent = otherSeat(seat);
  const finished = state.status === GAME_STATUS.FINISHED;
  const penalties = finished ? finalPenalties(state) : null;

  return {
    roomCode: state.roomCode,
    seat,
    status: state.status,
    result: resultForSeat(state, seat),
    createdAt: state.createdAt ?? Date.now(),
    startedAt: state.startedAt ?? null,
    finishedAt: state.finishedAt ?? null,
    turns: Math.max(0, (state.turnNumber ?? 1) - 1),
    myTilesLeft: state.hands?.[seat]?.length ?? 0,
    opponentTilesLeft: state.hands?.[opponent]?.length ?? 0,
    myPenalty: penalties ? penalties[seat] : null,
    opponentPenalty: penalties ? penalties[opponent] : null,
    updatedAt: Date.now(),
  };
}

/** "3 Steine" / "1 Stein". */
function tileCount(count) {
  return `${count} ${count === 1 ? 'Stein' : 'Steine'}`;
}

/**
 * Human-readable description of a history entry from one player's point of
 * view ("Du hast 3 Steine gespielt", "Gegner hat einen Stein gezogen", …).
 *
 * @param {HistorySnapshot} snapshot
 * @param {string} viewerSeat Whose wording ("Du" vs. "Gegner") to use.
 * @returns {{ title: string, detail: ?string }}
 */
export function describeSnapshot(snapshot, viewerSeat) {
  if (!snapshot.actor || snapshot.action === HISTORY_ACTION.START) {
    return {
      title: 'Spielbeginn',
      detail: `Jeder Spieler hat ${STARTING_HAND_SIZE} Steine erhalten.`,
    };
  }

  const mine = snapshot.actor === viewerSeat;
  const who = mine ? 'Du' : 'Gegner';
  const has = mine ? 'hast' : 'hat';

  let title;
  if (snapshot.action === HISTORY_ACTION.MELD) {
    title = `${who} ${has} ${tileCount(snapshot.tilesPlayed)} gespielt`;
  } else if (snapshot.action === HISTORY_ACTION.PASS) {
    title = `${who} ${has} ausgesetzt (Stapel leer)`;
  } else {
    title = `${who} ${has} einen Stein gezogen`;
  }
  if (snapshot.timedOut) title += ' – Zeit abgelaufen';

  let detail = null;
  if (snapshot.status === GAME_STATUS.FINISHED) {
    const outcome = !snapshot.winner
      ? 'Unentschieden'
      : snapshot.winner === viewerSeat
        ? 'Du hast gewonnen'
        : 'Dein Gegner hat gewonnen';
    detail = endedByGoingOut(snapshot)
      ? `Alle Steine abgelegt – ${outcome}!`
      : `Stapel leer, Endwertung – ${outcome}.`;
  }

  return { title, detail };
}
