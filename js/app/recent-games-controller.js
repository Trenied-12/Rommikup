/**
 * @file recent-games-controller.js
 * @description Loads and manages the "Meine letzten Spiele" list in the lobby.
 *
 * Summaries are cheap to load, but one may be outdated when a game ended while
 * this device was away. For every game that is not finished yet, the live game
 * document is consulted once and the stored summary is repaired — which also
 * lets this device count a result it never saw happen.
 */

import { byId } from '../ui/dom.js';
import { toastError } from '../ui/notifications.js';
import { renderRecentGames, renderRecentGamesMessage } from '../ui/recent-games-view.js';
import { fetchGame } from '../firebase/game-repository.js';
import {
  fetchRecentSummaries,
  saveSummary,
  deleteSummary,
} from '../firebase/summary-repository.js';
import { buildSummary } from '../game/history.js';
import { seatForUid } from '../models/game-state.js';
import { GAME_STATUS } from '../game/constants.js';
import { recordResultOnce } from './result-recorder.js';

export class RecentGamesController {
  /**
   * @param {{
   *   uid: string,
   *   deviceId: string,
   *   onViewHistory: (roomCode: string, seat: string) => void,
   *   onResume: (roomCode: string) => void,
   * }} deps
   */
  constructor({ uid, deviceId, onViewHistory, onResume }) {
    this.uid = uid;
    this.deviceId = deviceId;
    this.onViewHistory = onViewHistory;
    this.onResume = onResume;

    /** @type {import('../game/history.js').GameSummary[]} */
    this.summaries = [];
    /** Increments per load, so a slow older load can never overwrite a newer one. */
    this.loadToken = 0;
  }

  /** (Re)loads the list from Firestore and renders it. */
  async refresh() {
    const token = ++this.loadToken;
    const listEl = byId('recent-list');
    const tallyEl = byId('recent-tally');

    if (this.summaries.length === 0) {
      renderRecentGamesMessage(listEl, tallyEl, 'Lade deine Spiele …');
    }

    try {
      const stored = await fetchRecentSummaries(this.uid);
      const current = await Promise.all(stored.map((entry) => this.#repairIfOpen(entry)));
      if (token !== this.loadToken) return;
      this.summaries = current;
      this.#render();
    } catch {
      if (token !== this.loadToken) return;
      renderRecentGamesMessage(
        listEl,
        tallyEl,
        'Deine Spiele konnten nicht geladen werden. ' +
          '(Sind die neuen Firestore-Regeln veröffentlicht?)',
      );
    }
  }

  /**
   * Brings an unfinished summary up to date from the live game document.
   *
   * @param {import('../game/history.js').GameSummary} summary
   * @returns {Promise<import('../game/history.js').GameSummary>}
   */
  async #repairIfOpen(summary) {
    if (summary.status === GAME_STATUS.FINISHED) return summary;
    try {
      const game = await fetchGame(summary.roomCode);
      if (!game) return summary;

      const seat = seatForUid(game, this.uid) ?? summary.seat;
      const current = buildSummary(game, seat);
      if (current.status !== summary.status || current.turns !== summary.turns) {
        saveSummary(this.uid, current).catch(() => {});
      }
      if (current.status === GAME_STATUS.FINISHED) {
        recordResultOnce(current.roomCode, this.deviceId, current.result);
      }
      return current;
    } catch {
      return summary;
    }
  }

  /** Renders the current list with its action handlers. */
  #render() {
    renderRecentGames(byId('recent-list'), byId('recent-tally'), this.summaries, {
      onViewHistory: (summary) => this.onViewHistory(summary.roomCode, summary.seat),
      onResume: (summary) => this.onResume(summary.roomCode),
      onRemove: (summary) => this.#remove(summary),
    });
  }

  /** Removes a game from the list after confirmation (the game itself stays). */
  async #remove(summary) {
    const confirmed = window.confirm(
      `Spiel ${summary.roomCode} aus deiner Liste entfernen?\n` +
        '(Das Spiel und sein Verlauf bleiben gespeichert.)',
    );
    if (!confirmed) return;

    this.summaries = this.summaries.filter((entry) => entry.roomCode !== summary.roomCode);
    this.#render();
    try {
      await deleteSummary(this.uid, summary.roomCode);
    } catch {
      toastError('Das Spiel konnte nicht entfernt werden.');
      this.refresh();
    }
  }
}
