/**
 * @file history-controller.js
 * @description Drives the history ("Spielverlauf") screen: loads a game's
 * recorded moves and lets the player jump to any moment — via timeline slider,
 * step buttons, the turn list or the keyboard — watch the game replay itself
 * (autoplay with three speeds), and switch between their own and the
 * opponent's perspective (optionally revealing the other hand).
 */

import { byId, showScreen, createElement } from '../ui/dom.js';
import {
  renderHistoryFrame,
  renderTurnList,
  renderHistoryMessage,
} from '../ui/history-view.js';
import { applyResultBadge } from '../ui/result-badge.js';
import { fetchGame } from '../firebase/game-repository.js';
import { fetchHistory } from '../firebase/history-repository.js';
import { resultForSeat } from '../game/history.js';
import { seatForUid, otherSeat } from '../models/game-state.js';
import { SEAT } from '../game/constants.js';
import { formatDateTime } from '../utils/format.js';

/** Autoplay speeds offered to the player. */
const PLAYBACK_SPEEDS = Object.freeze([
  { label: '0,5×', intervalMs: 2000 },
  { label: '1×', intervalMs: 1000 },
  { label: '2×', intervalMs: 500 },
]);

/** Speed selected when the screen opens (1×). */
const DEFAULT_SPEED_INDEX = 1;

/** Focused elements that use every key themselves (slider, speed select …). */
const OWNS_ALL_KEYS_SELECTOR = 'select, textarea, input:not([type="checkbox"])';

/** Focused elements that use the space bar themselves (to activate). */
const OWNS_SPACE_SELECTOR = 'button, summary, input[type="checkbox"]';

export class HistoryController {
  /**
   * @param {{
   *   uid: string,
   *   onClose: () => void,
   *   loadGame?: (roomCode: string) => Promise<?Object>,
   *   loadHistory?: (roomCode: string) => Promise<Object[]>,
   * }} deps  The loaders default to Firestore; they can be swapped for tests.
   */
  constructor({ uid, onClose, loadGame = fetchGame, loadHistory = fetchHistory }) {
    this.uid = uid;
    this.onClose = onClose;
    this.loadGame = loadGame;
    this.loadHistory = loadHistory;

    /** @type {import('../game/history.js').HistorySnapshot[]} */
    this.snapshots = [];
    this.position = 0;
    this.viewerSeat = SEAT.HOST;
    this.perspective = SEAT.HOST;
    this.revealOther = false;

    this.playTimer = null;
    this.speedIndex = DEFAULT_SPEED_INDEX;
    /** Increments per open(), so a slow older load can never win. */
    this.loadToken = 0;

    this.#populateSpeeds();
    this.#bindControls();
    this.#bindKeyboard();
  }

  /**
   * Opens the history of a game.
   *
   * @param {string} roomCode
   * @param {{ seat?: ?string }} [options] The viewer's seat, if already known.
   */
  async open(roomCode, { seat = null } = {}) {
    const token = ++this.loadToken;
    this.#stopPlayback();
    this.snapshots = [];

    showScreen('history-screen');
    byId('history-meta').textContent = `Raum ${roomCode}`;
    byId('history-result').hidden = true;
    renderHistoryMessage('Spielverlauf wird geladen …');

    try {
      const [game, snapshots] = await Promise.all([
        this.loadGame(roomCode),
        this.loadHistory(roomCode),
      ]);
      if (token !== this.loadToken) return;

      this.viewerSeat = seat ?? (game ? seatForUid(game, this.uid) : null) ?? SEAT.HOST;
      this.perspective = this.viewerSeat;
      this.revealOther = false;
      byId('history-reveal').checked = false;
      this.#renderHeader(roomCode, game);

      if (snapshots.length === 0) {
        renderHistoryMessage(
          'Für dieses Spiel wurde kein Verlauf gespeichert. ' +
            '(Spiele von vor dem Update haben noch keinen Verlauf.)',
        );
        return;
      }

      this.snapshots = snapshots;
      renderHistoryMessage(null);
      renderTurnList(snapshots, this.viewerSeat, (position) => this.#userGoTo(position));
      // Start on the final position: the game as it ended.
      this.#goTo(snapshots.length - 1);
    } catch {
      if (token !== this.loadToken) return;
      renderHistoryMessage(
        'Der Spielverlauf konnte nicht geladen werden. ' +
          '(Sind die neuen Firestore-Regeln veröffentlicht?)',
      );
    }
  }

  /** Leaves the history screen. */
  close() {
    this.loadToken += 1;
    this.#stopPlayback();
    this.snapshots = [];
    this.onClose();
  }

  // ----------------------------------------------------------------- private

  /** Room, date and the viewer's result in the header bar. */
  #renderHeader(roomCode, game) {
    if (!game) return;
    const when = game.finishedAt ?? game.startedAt ?? game.createdAt;
    byId('history-meta').textContent = `Raum ${roomCode} · ${formatDateTime(when)}`;

    const badge = byId('history-result');
    applyResultBadge(badge, {
      status: game.status,
      result: resultForSeat(game, this.viewerSeat),
    });
    badge.hidden = false;
  }

  /** True while the history screen is the visible one. */
  #isVisible() {
    return !byId('history-screen').hidden;
  }

  /** Jumps to a position and re-renders. */
  #goTo(position) {
    if (this.snapshots.length === 0) return;
    const last = this.snapshots.length - 1;
    this.position = Math.max(0, Math.min(position, last));
    this.#render();
  }

  /** A jump triggered by the player: stops autoplay first. */
  #userGoTo(position) {
    this.#stopPlayback();
    this.#goTo(position);
  }

  #render() {
    if (this.snapshots.length === 0) return;
    renderHistoryFrame({
      snapshot: this.snapshots[this.position],
      previous: this.snapshots[this.position - 1] ?? null,
      position: this.position,
      total: this.snapshots.length,
      lastIndex: this.snapshots[this.snapshots.length - 1].index,
      viewerSeat: this.viewerSeat,
      perspective: this.perspective,
      revealOther: this.revealOther,
      playing: this.playTimer != null,
    });
  }

  // --------------------------------------------------------------- playback

  #togglePlayback() {
    if (this.playTimer) this.#stopPlayback();
    else this.#startPlayback();
    this.#render();
  }

  #startPlayback() {
    if (this.snapshots.length < 2) return;
    // Pressing play at the very end replays the game from the start.
    if (this.position >= this.snapshots.length - 1) this.position = 0;

    this.playTimer = setInterval(() => {
      if (this.position >= this.snapshots.length - 1) {
        this.#stopPlayback();
        this.#render();
        return;
      }
      this.#goTo(this.position + 1);
    }, PLAYBACK_SPEEDS[this.speedIndex].intervalMs);
  }

  #stopPlayback() {
    clearInterval(this.playTimer);
    this.playTimer = null;
  }

  #setSpeed(index) {
    this.speedIndex = index;
    if (this.playTimer) {
      // Restart the interval with the new speed, keeping the position.
      this.#stopPlayback();
      this.#startPlayback();
    }
  }

  // ----------------------------------------------------------------- input

  /** Fills the speed selector from PLAYBACK_SPEEDS. */
  #populateSpeeds() {
    const select = byId('history-speed');
    PLAYBACK_SPEEDS.forEach((speed, index) => {
      select.append(
        createElement('option', {
          text: speed.label,
          attrs: { value: String(index), selected: index === DEFAULT_SPEED_INDEX ? '' : null },
        }),
      );
    });
  }

  #bindControls() {
    byId('history-back-btn').addEventListener('click', () => this.close());
    byId('history-first-btn').addEventListener('click', () => this.#userGoTo(0));
    byId('history-prev-btn').addEventListener('click', () => this.#userGoTo(this.position - 1));
    byId('history-next-btn').addEventListener('click', () => this.#userGoTo(this.position + 1));
    byId('history-last-btn').addEventListener('click', () =>
      this.#userGoTo(this.snapshots.length - 1),
    );
    byId('history-play-btn').addEventListener('click', () => this.#togglePlayback());
    byId('history-slider').addEventListener('input', (event) =>
      this.#userGoTo(Number(event.target.value)),
    );
    byId('history-speed').addEventListener('change', (event) =>
      this.#setSpeed(Number(event.target.value)),
    );

    byId('history-view-me').addEventListener('click', () => {
      this.perspective = this.viewerSeat;
      this.#render();
    });
    byId('history-view-opp').addEventListener('click', () => {
      this.perspective = otherSeat(this.viewerSeat);
      this.#render();
    });
    byId('history-reveal').addEventListener('change', (event) => {
      this.revealOther = event.target.checked;
      this.#render();
    });
  }

  /** ← → step, Pos1/Ende jump, Leertaste play/pause. */
  #bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      if (!this.#isVisible() || this.snapshots.length === 0) return;
      const focused = event.target instanceof Element ? event.target : null;
      if (focused?.closest(OWNS_ALL_KEYS_SELECTOR)) return;
      if (event.key === ' ' && focused?.closest(OWNS_SPACE_SELECTOR)) return;

      const actions = {
        ArrowLeft: () => this.#userGoTo(this.position - 1),
        ArrowRight: () => this.#userGoTo(this.position + 1),
        Home: () => this.#userGoTo(0),
        End: () => this.#userGoTo(this.snapshots.length - 1),
        ' ': () => this.#togglePlayback(),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
  }
}
