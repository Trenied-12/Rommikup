/**
 * @file status-bar.js
 * @description Updates the top information bar: whose turn it is, tiles left in
 * the pool, the opponent's tile count and a human-readable game status.
 */

import { byId } from './dom.js';
import { GAME_STATUS, SEAT } from '../game/constants.js';
import { otherSeat } from '../models/game-state.js';

/** Maps a game status to a short German label. */
function statusLabel(state, mySeat) {
  switch (state.status) {
    case GAME_STATUS.WAITING_FOR_OPPONENT:
      return 'Warten auf Gegner';
    case GAME_STATUS.FINISHED:
      if (!state.winner) return 'Unentschieden';
      return state.winner === mySeat ? 'Du hast gewonnen! 🎉' : 'Du hast verloren';
    case GAME_STATUS.ABANDONED:
      return 'Abgebrochen';
    case GAME_STATUS.IN_PROGRESS:
    default:
      return state.currentTurn === mySeat ? 'Dein Zug' : 'Gegner ist am Zug';
  }
}

/**
 * Renders the status bar from the authoritative state.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @param {string} mySeat One of SEAT.
 */
export function renderStatusBar(state, mySeat) {
  const isMyTurn = state.currentTurn === mySeat;

  const turnEl = byId('status-turn');
  turnEl.textContent = isMyTurn ? 'Du' : 'Gegner';
  turnEl.classList.toggle('status-bar__value--you', isMyTurn);

  byId('status-pool').textContent = String(state.pool.length);

  const opponentSeat = otherSeat(mySeat);
  byId('status-opponent').textContent = String(
    state.hands[opponentSeat]?.length ?? 0,
  );

  byId('status-state').textContent = statusLabel(state, mySeat);
}
