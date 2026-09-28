/**
 * @file game-repository.js
 * @description The only module that talks to Firestore. It maps between the
 * pure {@link GameState} object and a Firestore document, and exposes realtime
 * subscriptions. Everything here is about *persistence and transport* — no game
 * rules live in this file (those belong to the engine).
 *
 * Document model: one document per game at `games/{ROOMCODE}`. The room code
 * doubles as the document id so a player can join purely from the code. The
 * turn-by-turn history lives in the `history` sub-collection of that document.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from './firebase-init.js';
import { historyRef, saveHistoryEntry } from './history-repository.js';
import { createInitialGameState, seatForUid } from '../models/game-state.js';
import { joinGame } from '../game/game-engine.js';
import { buildSnapshot } from '../game/history.js';
import { generateRoomCode } from '../utils/random.js';
import { GAME_STATUS } from '../game/constants.js';

/** Firestore error code for a request rejected by the security rules. */
const PERMISSION_DENIED = 'permission-denied';

/** Firestore collection that holds all games. */
const GAMES_COLLECTION = 'games';

/** Maximum attempts to find a free room code before giving up. */
const MAX_CODE_ATTEMPTS = 8;

/** Returns the document reference for a given room code. */
function gameRef(roomCode) {
  return doc(db, GAMES_COLLECTION, roomCode);
}

/**
 * Strips fields that must not be persisted and stamps a server-side update
 * time, returning a plain object ready for Firestore.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @returns {Object}
 */
function toDocument(state) {
  return { ...state, updatedAt: serverTimestamp() };
}

/**
 * Like {@link toDocument}, but for completed turns: the `pause` record is left
 * out because it is owned by partial updates (either player may request a
 * pause at any moment), and a turn saved concurrently must never overwrite it.
 * Used together with `{ merge: true }`, so omitted fields keep their stored
 * value.
 *
 * @param {import('../models/game-state.js').GameState} state
 * @returns {Object}
 */
function toTurnDocument(state) {
  const { pause: _ownedByPartialUpdates, ...turnFields } = state;
  return { ...turnFields, updatedAt: serverTimestamp() };
}

/**
 * Creates a brand-new game with a unique room code.
 *
 * @param {string} hostId Auth uid of the creating player.
 * @param {?string} [hostDeviceId] Stable device id of the host.
 * @returns {Promise<{ roomCode: string }>}
 */
export async function createGame(hostId, hostDeviceId = null) {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const roomCode = generateRoomCode();
    const ref = gameRef(roomCode);
    let createdState = null;

    // Use a transaction so two simultaneous creates can't claim one code.
    const created = await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists()) return false;

      createdState = createInitialGameState({ roomCode, hostId, hostDeviceId });
      transaction.set(ref, toDocument(createdState));
      return true;
    });

    if (created) {
      // Record the initial deal as history entry 0. Best effort: a missing
      // history must never stop a game from being created.
      saveHistoryEntry(roomCode, buildSnapshot(createdState)).catch(() => {});
      return { roomCode };
    }
  }

  throw new Error('Konnte keinen freien Raumcode erzeugen. Bitte erneut versuchen.');
}

/**
 * Joins an existing game as the guest. Validated inside a transaction to avoid
 * two players grabbing the same seat.
 *
 * @param {string} roomCode
 * @param {string} guestId Auth uid of the joining player.
 * @param {?string} [guestDeviceId] Stable device id of the joining player.
 * @returns {Promise<{ roomCode: string }>}
 */
export async function joinGameByCode(roomCode, guestId, guestDeviceId = null) {
  const ref = gameRef(roomCode);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new Error('Es gibt kein Spiel mit diesem Code.');
    }

    const state = snapshot.data();

    // Allow rejoining your own game (e.g. after a refresh) without error.
    if (seatForUid(state, guestId)) return;

    if (state.hostId === guestId) return;
    if (state.guestId) {
      throw new Error('Dieses Spiel ist bereits voll.');
    }
    if (state.status !== GAME_STATUS.WAITING_FOR_OPPONENT) {
      throw new Error('Dieses Spiel kann nicht mehr betreten werden.');
    }

    transaction.set(ref, toDocument(joinGame(state, guestId, guestDeviceId)));
  });

  return { roomCode };
}

/**
 * Reads a game once (no live updates).
 *
 * @param {string} roomCode
 * @returns {Promise<?import('../models/game-state.js').GameState>}
 */
export async function fetchGame(roomCode) {
  const snapshot = await getDoc(gameRef(roomCode));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Persists a completed move: the new game state together with its history
 * entry, atomically in one batch — so Firestore never holds a turn without its
 * history entry (or the other way round).
 *
 * If the history is rejected by the security rules (e.g. the updated rules
 * have not been published yet), the turn itself is still saved: the game must
 * never get stuck because of the history.
 *
 * @param {string} roomCode
 * @param {import('../models/game-state.js').GameState} state
 * @param {import('../game/history.js').HistorySnapshot} snapshot
 * @returns {Promise<{ historySaved: boolean }>}
 */
export async function saveTurn(roomCode, state, snapshot) {
  const turnData = toTurnDocument(state);
  try {
    const batch = writeBatch(db);
    batch.set(gameRef(roomCode), turnData, { merge: true });
    batch.set(historyRef(roomCode, snapshot.index), snapshot);
    await batch.commit();
    return { historySaved: true };
  } catch (error) {
    if (error?.code !== PERMISSION_DENIED) throw error;
    await setDoc(gameRef(roomCode), turnData, { merge: true });
    return { historySaved: false };
  }
}

/**
 * Writes only the given fields of a game document, leaving everything else
 * untouched. Used for high-frequency or concurrent-safe updates (the live
 * board preview, pause transitions) that must never clobber a full turn
 * committed at the same moment.
 *
 * @param {string} roomCode
 * @param {Object} fields Partial GameState fields.
 * @returns {Promise<void>}
 */
export async function updateGameFields(roomCode, fields) {
  await updateDoc(gameRef(roomCode), { ...fields, updatedAt: serverTimestamp() });
}

/**
 * Subscribes to realtime updates for a game.
 *
 * @param {string} roomCode
 * @param {(state: import('../models/game-state.js').GameState) => void} onChange
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} Unsubscribe function — call it to stop listening.
 */
export function subscribeToGame(roomCode, onChange, onError) {
  return onSnapshot(
    gameRef(roomCode),
    (snapshot) => {
      if (snapshot.exists()) onChange(snapshot.data());
    },
    (error) => onError?.(error),
  );
}
