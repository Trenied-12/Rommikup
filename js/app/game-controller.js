/**
 * @file game-controller.js
 * @description Orchestrates a single game session on the client: it owns the
 * realtime subscription, the local working copy (board + own hand), rendering,
 * the opponent-move highlights, the win/loss tally and all user actions (drag &
 * drop, draw, end turn, sort, reset).
 *
 * The own hand can be re-ordered at any time — even when it is not the player's
 * turn — while the board can only be edited on the player's own turn.
 */

import { byId } from '../ui/dom.js';
import { renderBoard } from '../ui/board-view.js';
import { renderRack, sortByColor, sortByNumber } from '../ui/rack-view.js';
import { renderStatusBar } from '../ui/status-bar.js';
import { toast, toastError, toastSuccess } from '../ui/notifications.js';
import { createDragController } from '../dnd/drag-drop.js';

import {
  createWorkingTurn,
  applyDrop,
  withSortedHand,
} from '../models/working-turn.js';
import { seatForUid, otherSeat } from '../models/game-state.js';
import { commitTurn, drawTile } from '../game/game-engine.js';
import { computeBoardDiff, isEmptyDiff } from '../game/board-diff.js';
import { subscribeToGame, saveGame, fetchGame } from '../firebase/game-repository.js';
import { recordResult, subscribeStats } from '../firebase/stats-repository.js';
import { GAME_STATUS, TURN_DURATION_MS } from '../game/constants.js';

/** How often the countdown display refreshes, in milliseconds. */
const TIMER_TICK_MS = 250;

/** Below this many milliseconds the timer turns red and pulses. */
const TIMER_URGENT_MS = 30 * 1000;

/**
 * Extra grace after the deadline before the *waiting* player enforces the
 * timeout on behalf of an opponent who has disconnected, so the game can never
 * stall on a closed tab. The active player themselves enforces immediately.
 */
const TIMER_ENFORCE_GRACE_MS = 5 * 1000;

/** Formats a millisecond duration as "m:ss". */
function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export class GameController {
  /**
   * @param {{ uid: string, deviceId: string, onExit: () => void }} deps
   */
  constructor({ uid, deviceId, onExit }) {
    this.uid = uid;
    this.deviceId = deviceId;
    this.onExit = onExit;

    /** @type {?import('../models/game-state.js').GameState} */
    this.state = null;
    /** @type {?import('../models/game-state.js').GameState} */
    this.prevState = null;
    /** @type {?import('../models/working-turn.js').WorkingTurn} */
    this.working = null;
    /** The turn number our current board edits belong to. */
    this.editingTurn = null;
    /** Preferred order of the player's own tiles, as a list of tile ids. */
    this.handOrder = [];
    /** @type {?import('../game/board-diff.js').BoardDiff} */
    this.highlights = null;

    /** Live win/loss tallies for both players. */
    this.stats = { you: null, opp: null };
    this.statsUnsub = { you: null, opp: null };
    this.subscribedDevices = { you: null, opp: null };

    this.roomCode = null;
    this.mySeat = null;
    this.unsubscribe = null;
    this.dragController = null;
    this.gameOverShown = false;
    this.resultRecorded = false;

    /** The turn for which we already auto-ended on timeout (avoids re-firing). */
    this.timedOutTurn = null;
    this.timerInterval = null;

    this.#bindControls();
    this.#setupDragAndDrop();
    this.#bindVisibilityRefresh();
    this.#bindHighlightClearing();
    this.#startTimer();
  }

  /**
   * Begins observing a game and shows the appropriate screen.
   *
   * @param {string} roomCode
   */
  start(roomCode) {
    this.roomCode = roomCode;
    this.unsubscribe = subscribeToGame(
      roomCode,
      (state) => this.#onState(state),
      (error) => toastError(`Verbindungsfehler: ${error.message}`),
    );
  }

  /** Stops observing and tears down listeners. */
  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.statsUnsub.you?.();
    this.statsUnsub.opp?.();
    this.statsUnsub = { you: null, opp: null };
    this.subscribedDevices = { you: null, opp: null };
    this.state = null;
    this.prevState = null;
    this.working = null;
    this.editingTurn = null;
    this.highlights = null;
    this.handOrder = [];
    this.stats = { you: null, opp: null };
    this.gameOverShown = false;
    this.resultRecorded = false;
    this.timedOutTurn = null;
  }

  // ----------------------------------------------------------------- private

  /** True when it is this player's turn and the game is running. */
  #isMyTurn() {
    return (
      this.state?.status === GAME_STATUS.IN_PROGRESS &&
      this.state.currentTurn === this.mySeat
    );
  }

  /** Reorders a tile list to match the player's preferred hand order. */
  #orderedHand(tiles) {
    const position = new Map(this.handOrder.map((id, index) => [id, index]));
    return [...tiles]
      .map((tile, index) => ({ tile, index }))
      .sort((a, b) => {
        const pa = position.has(a.tile.id) ? position.get(a.tile.id) : Number.MAX_SAFE_INTEGER;
        const pb = position.has(b.tile.id) ? position.get(b.tile.id) : Number.MAX_SAFE_INTEGER;
        return pa - pb || a.index - b.index;
      })
      .map((entry) => entry.tile);
  }

  /** Remembers the current hand ordering for use across re-syncs. */
  #syncHandOrder() {
    this.handOrder = this.working.hand.map((tile) => tile.id);
  }

  /** Handles a fresh authoritative state from Firestore. */
  #onState(state) {
    this.prevState = this.state;
    this.state = state;
    this.mySeat = seatForUid(state, this.uid);

    this.#updateScreens();
    this.#ensureStatsSubscriptions();

    const myTurn = this.#isMyTurn();
    const keepEdits = myTurn && this.editingTurn === state.turnNumber;

    if (!keepEdits) {
      // Rebuild the working copy from authoritative data (reflecting the
      // opponent's board), keeping the player's preferred hand order.
      const myHand = state.hands[this.mySeat] ?? [];
      this.working = createWorkingTurn(state.board, this.#orderedHand(myHand));
      if (myTurn) this.editingTurn = state.turnNumber;
    }

    this.#updateHighlights(myTurn);
    this.#render();
    this.#recordResultOnce();
    this.#maybeShowGameOver();
  }

  /**
   * When a new turn hands control back to us, work out what the opponent changed
   * so the board can highlight it until we interact.
   */
  #updateHighlights(myTurn) {
    if (
      myTurn &&
      this.prevState &&
      this.state.turnNumber > this.prevState.turnNumber
    ) {
      const diff = computeBoardDiff(this.prevState.board, this.state.board);
      this.highlights = isEmptyDiff(diff) ? null : diff;
    }
  }

  /** Clears the opponent-move highlights once the player interacts. */
  #clearHighlights() {
    if (!this.highlights) return;
    this.highlights = null;
    this.#render();
  }

  /** Switches between waiting and game screens based on status. */
  #updateScreens() {
    const waiting = this.state.status === GAME_STATUS.WAITING_FOR_OPPONENT;
    byId('waiting-screen').hidden = !waiting;
    byId('game-screen').hidden = waiting;
    byId('lobby-screen').hidden = true;

    if (waiting) {
      byId('waiting-code').textContent = this.state.roomCode;
    }
  }

  /** Renders board, rack, status bar and control availability. */
  #render() {
    if (!this.state || this.state.status === GAME_STATUS.WAITING_FOR_OPPONENT) {
      return;
    }

    const myTurn = this.#isMyTurn();

    renderBoard(byId('board'), this.working.board, {
      locked: !myTurn,
      highlights: myTurn ? this.highlights : null,
    });
    // The rack is always reorderable, even when it is not our turn.
    renderRack(byId('rack'), this.working.hand, { locked: false });
    this.#renderStatus();

    const running = this.state.status === GAME_STATUS.IN_PROGRESS;
    byId('end-turn-btn').disabled = !myTurn;
    byId('draw-btn').disabled = !myTurn;
    byId('reset-turn-btn').disabled = !myTurn;
    byId('sort-color-btn').disabled = !running;
    byId('sort-number-btn').disabled = !running;
  }

  /** Renders just the status bar (used on stats updates too). */
  #renderStatus() {
    if (this.state && this.mySeat) {
      renderStatusBar(this.state, this.mySeat, this.stats);
    }
  }

  // --------------------------------------------------------------- stats

  /** Keeps live stats subscriptions in sync with the seats' device ids. */
  #ensureStatsSubscriptions() {
    if (!this.mySeat) return;
    const mine = this.state.devices?.[this.mySeat] ?? null;
    const theirs = this.state.devices?.[otherSeat(this.mySeat)] ?? null;

    if (mine !== this.subscribedDevices.you) {
      this.statsUnsub.you?.();
      this.subscribedDevices.you = mine;
      this.statsUnsub.you = subscribeStats(mine, (s) => {
        this.stats.you = s;
        this.#renderStatus();
      });
    }
    if (theirs !== this.subscribedDevices.opp) {
      this.statsUnsub.opp?.();
      this.subscribedDevices.opp = theirs;
      this.statsUnsub.opp = subscribeStats(theirs, (s) => {
        this.stats.opp = s;
        this.#renderStatus();
      });
    }
  }

  /** Records this device's win/loss exactly once per finished game. */
  #recordResultOnce() {
    if (this.state.status !== GAME_STATUS.FINISHED) return;
    if (this.resultRecorded || !this.state.winner || !this.mySeat) return;

    const flag = `rummikub.recorded.${this.roomCode}`;
    try {
      if (localStorage.getItem(flag)) {
        this.resultRecorded = true;
        return;
      }
      localStorage.setItem(flag, '1');
    } catch {
      // Storage unavailable — fall back to the in-memory guard only.
    }

    this.resultRecorded = true;
    recordResult(this.deviceId, this.state.winner === this.mySeat).catch(() => {
      /* a missed stat update is not worth interrupting the game */
    });
  }

  // --------------------------------------------------------------- input

  /** Wires up the control-bar buttons. */
  #bindControls() {
    byId('end-turn-btn').addEventListener('click', () => this.#endTurn());
    byId('draw-btn').addEventListener('click', () => this.#draw());
    byId('reset-turn-btn').addEventListener('click', () => this.#resetTurn());
    byId('sort-color-btn').addEventListener('click', () => this.#sortHand(sortByColor));
    byId('sort-number-btn').addEventListener('click', () => this.#sortHand(sortByNumber));
    byId('play-again-btn').addEventListener('click', () => {
      byId('gameover-overlay').hidden = true;
      this.stop();
      this.onExit();
    });
  }

  /**
   * Clears highlights as soon as the player touches the board (clicking in or
   * picking up a tile) — one of the trigger conditions for removing them.
   */
  #bindHighlightClearing() {
    byId('board').addEventListener('pointerdown', () => this.#clearHighlights());
  }

  /**
   * On mobile the realtime socket is suspended while the tab is backgrounded;
   * pull the latest state once when the tab becomes visible again.
   */
  #bindVisibilityRefresh() {
    const refresh = () => {
      if (document.visibilityState === 'visible') this.#refreshNow();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
  }

  /** Fetches the authoritative state once and applies it. */
  async #refreshNow() {
    if (!this.roomCode) return;
    try {
      const latest = await fetchGame(this.roomCode);
      if (latest) this.#onState(latest);
    } catch {
      // A failed one-off refresh is harmless; the live listener stays active.
    }
  }

  // --------------------------------------------------------------- turn timer

  /** Starts the recurring countdown tick (runs for the controller's lifetime). */
  #startTimer() {
    this.timerInterval = setInterval(() => this.#tickTimer(), TIMER_TICK_MS);
  }

  /**
   * Updates the countdown display from the authoritative turn-start time (so
   * both players see the same clock) and, for the active player, automatically
   * ends the turn when time runs out.
   */
  #tickTimer() {
    const timerEl = byId('status-timer');
    const running =
      this.state?.status === GAME_STATUS.IN_PROGRESS &&
      this.state.turnStartedAt != null;

    if (!running) {
      timerEl.textContent = '';
      timerEl.classList.remove('status-bar__timer--urgent');
      return;
    }

    const raw = TURN_DURATION_MS - (Date.now() - this.state.turnStartedAt);
    const remaining = Math.max(0, raw);
    timerEl.textContent = formatClock(remaining);
    timerEl.classList.toggle('status-bar__timer--urgent', remaining <= TIMER_URGENT_MS);

    // Enforce the deadline once per turn. The active player acts immediately;
    // the waiting player only steps in after a grace period (disconnect safety).
    if (this.timedOutTurn === this.state.turnNumber) return;
    const enforce = this.#isMyTurn()
      ? raw <= 0
      : raw <= -TIMER_ENFORCE_GRACE_MS;
    if (enforce) {
      this.timedOutTurn = this.state.turnNumber;
      this.#handleTimeout();
    }
  }

  /**
   * On timeout: discard the active player's board edits and draw a tile (which
   * ends their turn). Works whether we are the timed-out player or are enforcing
   * the deadline for a disconnected opponent.
   */
  async #handleTimeout() {
    const activeSeat = this.state.currentTurn;
    const mine = activeSeat === this.mySeat;

    if (mine) {
      // Reset our own in-progress board changes back to the authoritative board.
      this.working = createWorkingTurn(
        this.state.board,
        this.#orderedHand(this.state.hands[this.mySeat]),
      );
      this.highlights = null;
    }

    const result = drawTile(this.state, activeSeat);
    if (!result.ok) return; // turn already changed / game ended in the meantime
    if (mine) toast('Zeit abgelaufen – Zug wurde automatisch beendet.');
    await this.#persist(result.state);
  }

  /** Creates the drag controller bound to the game screen. */
  #setupDragAndDrop() {
    this.dragController = createDragController({
      root: byId('game-screen'),
      isEnabled: () =>
        this.state?.status === GAME_STATUS.IN_PROGRESS && this.mySeat != null,
      onDrop: (tileId, target) => {
        const myTurn = this.#isMyTurn();
        // When it is not our turn we may only reorder our own rack.
        if (!myTurn && target.zone !== 'rack') return;
        if (target.zone !== 'rack') this.highlights = null; // board interaction

        this.working = applyDrop(this.working, tileId, target);
        this.#syncHandOrder();
        this.#render();
      },
    });
  }

  /** Validates and submits the current working turn. */
  async #endTurn() {
    if (!this.#isMyTurn()) return;
    const result = commitTurn(this.state, this.mySeat, {
      board: this.working.board,
      hand: this.working.hand,
    });

    if (!result.ok) {
      toastError(result.error);
      return;
    }

    this.highlights = null;
    toastSuccess('Zug gespeichert.');
    await this.#persist(result.state);
  }

  /** Draws a tile and ends the turn. Discards any pending board edits. */
  async #draw() {
    if (!this.#isMyTurn()) return;
    const poolEmpty = this.state.pool.length === 0;
    const result = drawTile(this.state, this.mySeat);
    if (!result.ok) {
      toastError(result.error);
      return;
    }
    this.highlights = null;
    toast(poolEmpty ? 'Nachziehstapel leer – du setzt aus.' : 'Stein gezogen.');
    await this.#persist(result.state);
  }

  /** Discards local board edits and restores the authoritative board + hand. */
  #resetTurn() {
    if (!this.#isMyTurn()) return;
    this.working = createWorkingTurn(
      this.state.board,
      this.#orderedHand(this.state.hands[this.mySeat]),
    );
    this.#render();
  }

  /** Sorts the working hand using the supplied comparator-producer. */
  #sortHand(sorter) {
    if (this.state?.status !== GAME_STATUS.IN_PROGRESS || !this.working) return;
    this.working = withSortedHand(this.working, sorter(this.working.hand));
    this.#syncHandOrder();
    this.#render();
  }

  /**
   * Optimistically applies the new state locally for instant feedback, then
   * persists it to Firestore.
   */
  async #persist(newState) {
    this.#onState(newState); // optimistic local update
    try {
      await saveGame(this.roomCode, newState);
    } catch (error) {
      toastError(`Speichern fehlgeschlagen: ${error.message}`);
    }
  }

  /** Shows the game-over overlay once, when the game finishes. */
  #maybeShowGameOver() {
    if (this.state.status !== GAME_STATUS.FINISHED || this.gameOverShown) return;
    this.gameOverShown = true;

    const won = this.state.winner === this.mySeat;
    const draw = this.state.winner == null;
    byId('gameover-title').textContent = draw
      ? 'Unentschieden'
      : won
        ? 'Du hast gewonnen! 🎉'
        : 'Du hast verloren';
    byId('gameover-text').textContent = draw
      ? 'Beide Spieler haben gleich viele Punkte.'
      : won
        ? 'Alle deine Steine sind abgelegt.'
        : 'Dein Gegner war zuerst fertig.';
    byId('gameover-overlay').hidden = false;
  }
}
