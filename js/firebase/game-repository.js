/**
 * @file game-repository.js
 * @description The only module that talks to Firestore. It maps between the
 * pure {@link GameState} object and a Firestore document, and exposes realtime
 * subscriptions. Everything here is about *persistence and transport* — no game
 * rules live in this file (those belong to the engine).
 *
 * Document model: one document per game at `games/{ROOMCODE}`. The room code
 * doubles as the document id so a player can join purely from the code.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from './firebase-init.js';
import { createInitialGameState, seatForUid } from '../models/game-state.js';
import { joinGame } from '../game/game-engine.js';
import { generateRoomCode } from '../utils/random.js';
import { GAME_STATUS } from '../game/constants.js';

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

    // Use a transaction so two simultaneous creates can't claim one code.
    const created = await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists()) return false;

      const state = createInitialGameState({ roomCode, hostId, hostDeviceId });
      transaction.set(ref, toDocument(state));
      return true;
    });

    if (created) return { roomCode };
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
 * Persists a full game state (e.g. after a committed turn). The whole document
 * is replaced, which keeps the engine the single source of truth — Firestore
 * never holds a partially-applied turn.
 *
 * @param {string} roomCode
 * @param {import('../models/game-state.js').GameState} state
 * @returns {Promise<void>}
 */
export async function saveGame(roomCode, state) {
  await setDoc(gameRef(roomCode), toDocument(state));
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
