/**
 * @file game-controller.js
 * @description Orchestrates a single game session on the client: it owns the
 * realtime subscription, the local working copy (board + own hand), rendering,
 * the live board preview, the shared pause feature, the win/loss tally and all
 * user actions (drag & drop, draw, end turn, sort, reset).
 *
 * Realtime preview: while a player rearranges the board, every change is
 * published (throttled) to the game document's `livePreview` field, so the
 * opponent watches the experimenting live. Only the board is published — the
 * player's hand never leaves the device until a turn is committed.
 *
 * Pause: either player may request a pause; the opponent gets a popup to
 * accept or decline. While paused the clock is frozen and all interaction is
 * blocked. The game resumes only after BOTH players consent.
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
import {
  commitTurn,
  drawTile,
  pauseOf,
  requestPause,
  respondToPause,
  voteResume,
} from '../game/game-engine.js';
import {
  subscribeToGame,
  saveGame,
  fetchGame,
  updateGameFields,
} from '../firebase/game-repository.js';
import { recordResult, subscribeStats } from '../firebase/stats-repository.js';
import {
  GAME_STATUS,
  PAUSE_STATE,
  TURN_DURATION_MS,
} from '../game/constants.js';

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

/**
 * Debounce for publishing the live board preview. Coalesces rapid consecutive
 * drops into one write while still feeling instant to the opponent.
 */
const PREVIEW_DEBOUNCE_MS = 250;

/** Formats a millisecond duration as "m:ss". */
function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Compact fingerprint of a board used to skip redundant preview writes. */
function boardSignature(board) {
  return board
    .map((meld) => `${meld.id}:${meld.tiles.map((tile) => tile.id).join(',')}`)
    .join('|');
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
    /** @type {?import('../models/working-turn.js').WorkingTurn} */
    this.working = null;
    /** The turn for which the local board edits are valid. */
    this.editingTurn = null;
    /** Preferred order of the player's own tiles, as a list of tile ids. */
    this.handOrder = [];

    /** Live win/loss tallies for both players. */
    this.stats = { you: null, opp: null };
    this.statsUnsub = { you: null, opp: null };
    this.subscribedDevices = { you: null, opp: null };

    /** Last seen pause state, to toast on remote transitions. */
    this.lastPause = { state: PAUSE_STATE.IDLE, requestedBy: null };

    /** Debounce handle + change detection for live preview publishing. */
    this.previewTimer = null;
    this.previewSignature = null;

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
    clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.previewSignature = null;
    this.state = null;
    this.working = null;
    this.editingTurn = null;
    this.handOrder = [];
    this.stats = { you: null, opp: null };
    this.lastPause = { state: PAUSE_STATE.IDLE, requestedBy: null };
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

  /** The current pause record (tolerates pre-feature documents). */
  #pause() {
    return this.state ? pauseOf(this.state) : { state: PAUSE_STATE.IDLE };
  }

  /** True while the shared pause is active (all interaction blocked). */
  #isPaused() {
    return this.#pause().state === PAUSE_STATE.ACTIVE;
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
    this.state = state;
    this.mySeat = seatForUid(state, this.uid);

    this.#updateScreens();
    this.#ensureStatsSubscriptions();
    this.#handlePauseTransitions();

    const myTurn = this.#isMyTurn();
    const keepEdits = myTurn && this.editingTurn === state.turnNumber;

    if (!keepEdits) {
      // Rebuild the working copy from authoritative data, keeping the player's
      // preferred hand order. Any pending preview write is now stale.
      clearTimeout(this.previewTimer);
      this.previewSignature = null;
      const myHand = state.hands[this.mySeat] ?? [];
      this.working = createWorkingTurn(state.board, this.#orderedHand(myHand));
      if (myTurn) this.editingTurn = state.turnNumber;
    }

    this.#render();
    this.#recordResultOnce();
    this.#maybeShowGameOver();
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

  /**
   * Picks the board to show: my own working copy during my turn, otherwise the
   * opponent's live preview (when one exists for the current turn), falling
   * back to the authoritative board.
   */
  #boardToRender(myTurn) {
    if (myTurn) return this.working.board;

    const preview = this.state.livePreview;
    const previewIsCurrent =
      preview &&
      Array.isArray(preview.board) &&
      preview.seat === this.state.currentTurn &&
      preview.turnNumber === this.state.turnNumber;

    return previewIsCurrent ? preview.board : this.working.board;
  }

  /** Renders board, rack, status bar and control availability. */
  #render() {
    if (!this.state || this.state.status === GAME_STATUS.WAITING_FOR_OPPONENT) {
      return;
    }

    const myTurn = this.#isMyTurn();
    const paused = this.#isPaused();

    renderBoard(byId('board'), this.#boardToRender(myTurn), { locked: !myTurn || paused });
    // The rack is reorderable at any time — except while the game is paused.
    renderRack(byId('rack'), this.working.hand, { locked: paused });
    this.#renderStatus();
    this.#renderPauseOverlay();

    const running = this.state.status === GAME_STATUS.IN_PROGRESS;
    byId('end-turn-btn').disabled = !myTurn || paused;
    byId('draw-btn').disabled = !myTurn || paused;
    byId('reset-turn-btn').disabled = !myTurn || paused;
    byId('sort-color-btn').disabled = !running || paused;
    byId('sort-number-btn').disabled = !running || paused;
    byId('pause-btn').disabled = !running || this.#pause().state !== PAUSE_STATE.IDLE;
  }

  /** Renders just the status bar (used on stats updates too). */
  #renderStatus() {
    if (this.state && this.mySeat) {
      renderStatusBar(this.state, this.mySeat, this.stats);
    }
  }

  // --------------------------------------------------------------- live preview

  /**
   * Publishes the current working board as the opponent's live preview,
   * debounced and skipped when the board did not actually change (e.g. a pure
   * rack reorder).
   */
  #publishPreviewSoon() {
    if (!this.#isMyTurn()) return;

    const signature = boardSignature(this.working.board);
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;

    const turnNumber = this.state.turnNumber;
    const board = this.working.board.map((meld) => ({
      id: meld.id,
      tiles: [...meld.tiles],
    }));

    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      // The turn may have ended while the debounce was pending.
      if (!this.#isMyTurn() || this.state.turnNumber !== turnNumber) return;
      updateGameFields(this.roomCode, {
        livePreview: { seat: this.mySeat, turnNumber, board },
      }).catch(() => {
        /* a lost preview frame is harmless — the next drop republishes */
      });
    }, PREVIEW_DEBOUNCE_MS);
  }

  // --------------------------------------------------------------------- pause

  /** Applies partial fields optimistically and persists exactly those fields. */
  async #applyFields(fields) {
    this.#onState({ ...this.state, ...fields });
    try {
      await updateGameFields(this.roomCode, fields);
    } catch (error) {
      toastError(`Aktion fehlgeschlagen: ${error.message}`);
    }
  }

  /** "Pause anfragen" button. */
  async #requestPause() {
    const result = requestPause(this.state, this.mySeat);
    if (!result.ok) {
      toastError(result.error);
      return;
    }
    toast('Pause angefragt – warte auf deinen Gegner.');
    await this.#applyFields(result.fields);
  }

  /** Opponent answers the pause popup. */
  async #respondToPause(accept) {
    const result = respondToPause(this.state, this.mySeat, accept);
    if (!result.ok) return;
    await this.#applyFields(result.fields);
  }

  /** "Weiter spielen" vote during an active pause. */
  async #voteResume() {
    const result = voteResume(this.state, this.mySeat);
    if (!result.ok) return;
    await this.#applyFields(result.fields);
  }

  /** Toasts remote pause transitions (decline, resume). */
  #handlePauseTransitions() {
    if (!this.mySeat) return;
    const current = this.#pause();
    const previous = this.lastPause;

    const declinedMyRequest =
      previous.state === PAUSE_STATE.REQUESTED &&
      previous.requestedBy === this.mySeat &&
      current.state === PAUSE_STATE.IDLE;
    if (declinedMyRequest) {
      toast('Dein Gegner hat die Pause abgelehnt.');
    }

    const resumed =
      previous.state === PAUSE_STATE.ACTIVE && current.state === PAUSE_STATE.IDLE;
    if (resumed) {
      toastSuccess('Das Spiel geht weiter!');
    }

    this.lastPause = {
      state: current.state,
      requestedBy: current.requestedBy ?? null,
    };
  }

  /**
   * Shows/hides the pause overlay and adapts its text and buttons to the pause
   * state and this player's role in it.
   */
  #renderPauseOverlay() {
    const overlay = byId('pause-overlay');
    const pause = this.#pause();
    const running = this.state.status === GAME_STATUS.IN_PROGRESS;

    const acceptBtn = byId('pause-accept-btn');
    const declineBtn = byId('pause-decline-btn');
    const resumeBtn = byId('pause-resume-btn');

    // The requester keeps playing while waiting for an answer, so the popup is
    // only shown to the opponent — and to both once the pause is active.
    const showForRequest =
      pause.state === PAUSE_STATE.REQUESTED && pause.requestedBy !== this.mySeat;
    const showForActive = pause.state === PAUSE_STATE.ACTIVE;

    if (!running || !this.mySeat || !(showForRequest || showForActive)) {
      overlay.hidden = true;
      return;
    }

    if (showForRequest) {
      byId('pause-title').textContent = 'Pause angefragt';
      byId('pause-text').textContent =
        'Dein Gegenspieler möchte die Zeit pausieren.';
      acceptBtn.hidden = false;
      declineBtn.hidden = false;
      resumeBtn.hidden = true;
    } else {
      const myVote = pause.resumeVotes?.[this.mySeat] === true;
      byId('pause-title').textContent = 'Spiel pausiert';
      byId('pause-text').textContent = myVote
        ? 'Warte auf deinen Gegner, um fortzusetzen …'
        : 'Die Zeit ist angehalten. Das Spiel geht weiter, sobald beide fortsetzen möchten.';
      acceptBtn.hidden = true;
      declineBtn.hidden = true;
      resumeBtn.hidden = false;
      resumeBtn.disabled = myVote;
    }

    overlay.hidden = false;
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

  /** Wires up the control-bar and overlay buttons. */
  #bindControls() {
    byId('end-turn-btn').addEventListener('click', () => this.#endTurn());
    byId('draw-btn').addEventListener('click', () => this.#draw());
    byId('reset-turn-btn').addEventListener('click', () => this.#resetTurn());
    byId('sort-color-btn').addEventListener('click', () => this.#sortHand(sortByColor));
    byId('sort-number-btn').addEventListener('click', () => this.#sortHand(sortByNumber));
    byId('pause-btn').addEventListener('click', () => this.#requestPause());
    byId('pause-accept-btn').addEventListener('click', () => this.#respondToPause(true));
    byId('pause-decline-btn').addEventListener('click', () => this.#respondToPause(false));
    byId('pause-resume-btn').addEventListener('click', () => this.#voteResume());
    byId('play-again-btn').addEventListener('click', () => {
      byId('gameover-overlay').hidden = true;
      this.stop();
      this.onExit();
    });
  }

  /**
   * On mobile the realtime socket is suspended while a tab is backgrounded;
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
   * both players see the same clock). While a pause is active the clock is
   * frozen at the moment the pause began. For the active player, automatically
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

    const pause = this.#pause();
    const paused = pause.state === PAUSE_STATE.ACTIVE;
    const now = paused ? pause.pausedAt ?? Date.now() : Date.now();
    const raw = TURN_DURATION_MS - (now - this.state.turnStartedAt);
    const remaining = Math.max(0, raw);

    timerEl.textContent = `${paused ? '⏸ ' : ''}${formatClock(remaining)}`;
    timerEl.classList.toggle(
      'status-bar__timer--urgent',
      !paused && remaining <= TIMER_URGENT_MS,
    );

    // Never enforce the deadline while the game is paused.
    if (paused) return;

    // Enforce once per turn. The active player acts immediately; the waiting
    // player only steps in after a grace period (disconnect safety).
    if (this.timedOutTurn === this.state.turnNumber) return;
    const enforce = this.#isMyTurn() ? raw <= 0 : raw <= -TIMER_ENFORCE_GRACE_MS;
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
    }

    const result = drawTile(this.state, activeSeat);
    if (!result.ok) return; // turn already changed / game ended in the meantime
    if (mine) toast('Zeit abgelaufen – Zug wurde automatisch beendet.');
    await this.#persist(result.state);
  }

  // --------------------------------------------------------------- game moves

  /** Creates the drag controller bound to the game screen. */
  #setupDragAndDrop() {
    this.dragController = createDragController({
      root: byId('game-screen'),
      isEnabled: () =>
        this.state?.status === GAME_STATUS.IN_PROGRESS &&
        this.mySeat != null &&
        !this.#isPaused(),
      onDrop: (tileId, target) => {
        const myTurn = this.#isMyTurn();
        // When it is not our turn we may only reorder our own rack.
        if (!myTurn && target.zone !== 'rack') return;

        this.working = applyDrop(this.working, tileId, target);
        this.#syncHandOrder();
        this.#render();
        this.#publishPreviewSoon();
      },
    });
  }

  /** Validates and submits the current working turn. */
  async #endTurn() {
    if (!this.#isMyTurn() || this.#isPaused()) return;
    const result = commitTurn(this.state, this.mySeat, {
      board: this.working.board,
      hand: this.working.hand,
    });

    if (!result.ok) {
      toastError(result.error);
      return;
    }

    toastSuccess('Zug gespeichert.');
    await this.#persist(result.state);
  }

  /** Draws a tile and ends the turn. Discards any pending board edits. */
  async #draw() {
    if (!this.#isMyTurn() || this.#isPaused()) return;
    const poolEmpty = this.state.pool.length === 0;
    const result = drawTile(this.state, this.mySeat);
    if (!result.ok) {
      toastError(result.error);
      return;
    }
    toast(poolEmpty ? 'Nachziehstapel leer – du setzt aus.' : 'Stein gezogen.');
    await this.#persist(result.state);
  }

  /** Discards local board edits and restores the authoritative board + hand. */
  #resetTurn() {
    if (!this.#isMyTurn() || this.#isPaused()) return;
    this.working = createWorkingTurn(
      this.state.board,
      this.#orderedHand(this.state.hands[this.mySeat]),
    );
    this.#render();
    // Let the opponent's live view snap back too.
    this.#publishPreviewSoon();
  }

  /** Sorts the working hand using the supplied comparator-producer. */
  #sortHand(sorter) {
    if (this.state?.status !== GAME_STATUS.IN_PROGRESS || !this.working) return;
    if (this.#isPaused()) return;
    this.working = withSortedHand(this.working, sorter(this.working.hand));
    this.#syncHandOrder();
    this.#render();
  }

  /**
   * Optimistically applies the new state locally for instant feedback, then
   * persists it to Firestore.
   */
  async #persist(newState) {
    // Any queued preview write belongs to the turn that just ended.
    clearTimeout(this.previewTimer);
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
    byId('pause-overlay').hidden = true;

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
