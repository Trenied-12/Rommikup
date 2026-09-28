/**
 * @file history-repository.js
 * @description Persistence of the turn-by-turn game history. Every entry lives
 * in its own document at `games/{ROOMCODE}/history/{0000..}` — deliberately a
 * sub-collection and not a field of the game document, so the live game
 * document (which both players receive on every change) stays small no matter
 * how long a game runs.
 */

import {
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from './firebase-init.js';
import { historyEntryId } from '../game/history.js';

/** Parent collection of all games. */
const GAMES_COLLECTION = 'games';

/** Sub-collection holding a game's history entries. */
const HISTORY_COLLECTION = 'history';

/**
 * Document reference for one history entry.
 *
 * @param {string} roomCode
 * @param {number} index History position (0 = initial deal).
 */
export function historyRef(roomCode, index) {
  return doc(db, GAMES_COLLECTION, roomCode, HISTORY_COLLECTION, historyEntryId(index));
}

/**
 * Writes a single history entry on its own (used for the initial deal; turns
 * are written atomically together with the game state by the game repository).
 *
 * @param {string} roomCode
 * @param {import('../game/history.js').HistorySnapshot} snapshot
 * @returns {Promise<void>}
 */
export async function saveHistoryEntry(roomCode, snapshot) {
  await setDoc(historyRef(roomCode, snapshot.index), snapshot);
}

/**
 * Loads a game's complete history in turn order.
 *
 * @param {string} roomCode
 * @returns {Promise<import('../game/history.js').HistorySnapshot[]>}
 */
export async function fetchHistory(roomCode) {
  const entries = query(
    collection(db, GAMES_COLLECTION, roomCode, HISTORY_COLLECTION),
    orderBy('index'),
  );
  const snapshot = await getDocs(entries);
  return snapshot.docs.map((entry) => entry.data());
}
