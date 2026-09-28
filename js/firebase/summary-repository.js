/**
 * @file summary-repository.js
 * @description Persistence of each player's personal game list ("Meine letzten
 * Spiele"). Every player owns the documents at `users/{uid}/games/{ROOMCODE}` —
 * a few hundred bytes per game — so the lobby can list recent games without
 * downloading the large game documents themselves.
 */

import {
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from './firebase-init.js';
import { RECENT_GAMES_LIMIT } from '../game/constants.js';

/** Top-level collection of per-player data. */
const USERS_COLLECTION = 'users';

/** Per-player sub-collection of game summaries. */
const USER_GAMES_COLLECTION = 'games';

/** Document reference for one of a player's game summaries. */
function summaryRef(uid, roomCode) {
  return doc(db, USERS_COLLECTION, uid, USER_GAMES_COLLECTION, roomCode);
}

/**
 * Creates or updates a game summary for a player.
 *
 * @param {string} uid Owner of the list.
 * @param {import('../game/history.js').GameSummary} summary
 * @returns {Promise<void>}
 */
export async function saveSummary(uid, summary) {
  await setDoc(summaryRef(uid, summary.roomCode), summary, { merge: true });
}

/**
 * Loads a player's most recently created games, newest first.
 *
 * @param {string} uid
 * @param {number} [max]
 * @returns {Promise<import('../game/history.js').GameSummary[]>}
 */
export async function fetchRecentSummaries(uid, max = RECENT_GAMES_LIMIT) {
  const recent = query(
    collection(db, USERS_COLLECTION, uid, USER_GAMES_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  const snapshot = await getDocs(recent);
  return snapshot.docs.map((entry) => entry.data());
}

/**
 * Removes a game from a player's list (the game and its history stay intact).
 *
 * @param {string} uid
 * @param {string} roomCode
 * @returns {Promise<void>}
 */
export async function deleteSummary(uid, roomCode) {
  await deleteDoc(summaryRef(uid, roomCode));
}
