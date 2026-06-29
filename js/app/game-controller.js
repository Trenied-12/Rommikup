/**
 * @file game-controller.js
 * @description Orchestrates a single game session on the client: it owns the
 * realtime subscription, the local working-turn copy, rendering and all user
 * actions (drag & drop, draw, end turn, sort, reset). It is the glue between
 * the pure engine, the Firebase repository and the DOM views.
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
import { seatForUid } from '../models/game-state.js';
import { commitTurn, drawTile } from '../game/game-engine.js';
import { subscribeToGame, saveGame } from '../firebase/game-repository.js';
import { GAME_STATUS } from '../game/constants.js';

export class GameController {
  /**
   * @param {{ uid: string, onExit: () => void }} deps
   */
  constructor({ uid, onExit }) {
    this.uid = uid;
    this.onExit = onExit;

    /** @type {?import('../models/game-state.js').GameState} */
    this.state = null;
    /** @type {?import('../models/working-turn.js').WorkingTurn} */
    this.working = null;
    /** The turn number the working copy was initialised from. */
    this.syncedTurn = null;

    this.roomCode = null;
    this.mySeat = null;
    this.unsubscribe = null;
    this.dragController = null;
    this.gameOverShown = false;

    this.#bindControls();
    this.#setupDragAndDrop();
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
    this.state = null;
    this.working = null;
    this.syncedTurn = null;
    this.gameOverShown = false;
  }

  // ----------------------------------------------------------------- private

  /** True when it is this player's turn and the game is running. */
  #isMyTurn() {
    return (
      this.state?.status === GAME_STATUS.IN_PROGRESS &&
      this.state.currentTurn === this.mySeat
    );
  }

  /** Handles a fresh authoritative state from Firestore. */
  #onState(state) {
    this.state = state;
    this.mySeat = seatForUid(state, this.uid);

    this.#updateScreens();

    if (this.#isMyTurn()) {
      // (Re)initialise the working copy at the start of each of our turns.
      if (!this.working || this.syncedTurn !== state.turnNumber) {
        this.working = createWorkingTurn(state.board, state.hands[this.mySeat]);
        this.syncedTurn = state.turnNumber;
      }
    } else {
      this.working = null;
    }

    this.#render();
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

  /** Renders board, rack, status bar and control availability. */
  #render() {
    if (!this.state || this.state.status === GAME_STATUS.WAITING_FOR_OPPONENT) {
      return;
    }

    const myTurn = this.#isMyTurn();
    const board = myTurn ? this.working.board : this.state.board;
    const hand = myTurn ? this.working.hand : this.state.hands[this.mySeat] ?? [];

    renderBoard(byId('board'), board, { locked: !myTurn });
    renderRack(byId('rack'), hand, { locked: !myTurn });
    renderStatusBar(this.state, this.mySeat);

    const running = this.state.status === GAME_STATUS.IN_PROGRESS;
    byId('end-turn-btn').disabled = !myTurn;
    byId('draw-btn').disabled = !myTurn;
    byId('reset-turn-btn').disabled = !myTurn;
    byId('sort-color-btn').disabled = !myTurn;
    byId('sort-number-btn').disabled = !myTurn;
    byId('controls').style.opacity = running ? '1' : '0.5';
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

  /** Wires up the control-bar buttons. */
  #bindControls() {
    byId('end-turn-btn').addEventListener('click', () => this.#endTurn());
    byId('draw-btn').addEventListener('click', () => this.#draw());
    byId('reset-turn-btn').addEventListener('click', () => this.#resetTurn());
    byId('sort-color-btn').addEventListener('click', () =>
      this.#sortHand(sortByColor),
    );
    byId('sort-number-btn').addEventListener('click', () =>
      this.#sortHand(sortByNumber),
    );
    byId('play-again-btn').addEventListener('click', () => {
      byId('gameover-overlay').hidden = true;
      this.stop();
      this.onExit();
    });
  }

  /** Creates the drag controller bound to the game screen. */
  #setupDragAndDrop() {
    this.dragController = createDragController({
      root: byId('game-screen'),
      isEnabled: () => this.#isMyTurn() && this.working != null,
      onDrop: (tileId, target) => {
        this.working = applyDrop(this.working, tileId, target);
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

    toastSuccess('Zug gespeichert.');
    await this.#persist(result.state);
  }

  /** Draws a tile and ends the turn. Discards any pending board edits. */
  async #draw() {
    if (!this.#isMyTurn()) return;
    const result = drawTile(this.state, this.mySeat);
    if (!result.ok) {
      toastError(result.error);
      return;
    }
    toast('Stein gezogen.');
    await this.#persist(result.state);
  }

  /** Discards local edits and restores the authoritative board + hand. */
  #resetTurn() {
    if (!this.#isMyTurn()) return;
    this.working = createWorkingTurn(this.state.board, this.state.hands[this.mySeat]);
    this.#render();
  }

  /** Sorts the working hand using the supplied comparator-producer. */
  #sortHand(sorter) {
    if (!this.#isMyTurn()) return;
    this.working = withSortedHand(this.working, sorter(this.working.hand));
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
}
