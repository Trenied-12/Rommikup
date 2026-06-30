/**
 * @file status-bar.js
 * @description Updates the top information bar: whose turn it is, tiles left in
 * the pool, the opponent's tile count, the win/loss tally for both players and
 * a description of the opponent's most recent move.
 */

import { byId } from './dom.js';
import { GAME_STATUS } from '../game/constants.js';
import { otherSeat } from '../models/game-state.js';

/**
 * Turns a per-seat last-move record into German text.
 *
 * @param {?import('../models/game-state.js').LastMove} move
 * @returns {string}
 */
function describeMove(move) {
  if (!move) return 'Noch kein Zug';
  if (move.type === 'draw') return 'Stein gezogen';
  const n = move.tilesPlayed;
  return `${n} ${n === 1 ? 'Stein' : 'Steine'} gespielt`;
}

/** Formats a stats record as "wins - losses", e.g. "2 - 1". */
function formatScore(stats) {
  if (!stats) return '–';
  return `${stats.wins} - ${stats.losses}`;
}

/**
 * Renders the status bar.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @param {string} mySeat One of SEAT.
 * @param {{ you: ?{wins:number,losses:number}, opp: ?{wins:number,losses:number} }} stats
 */
export function renderStatusBar(state, mySeat, stats) {
  const isMyTurn = state.currentTurn === mySeat;
  const finished = state.status === GAME_STATUS.FINISHED;

  const turnEl = byId('status-turn');
  turnEl.textContent = finished ? 'Ende' : isMyTurn ? 'Du' : 'Gegner';
  turnEl.classList.toggle('status-bar__value--you', isMyTurn && !finished);

  byId('status-pool').textContent = String(state.pool.length);

  const opponentSeat = otherSeat(mySeat);
  byId('status-opponent').textContent = String(
    state.hands[opponentSeat]?.length ?? 0,
  );

  byId('status-score-you').textContent = formatScore(stats?.you);
  byId('status-score-opp').textContent = formatScore(stats?.opp);

  // Always show the opponent's latest action, whoever's turn it is now.
  const opponentMove = state.lastMoves?.[opponentSeat] ?? null;
  byId('status-state').textContent = describeMove(opponentMove);
}
