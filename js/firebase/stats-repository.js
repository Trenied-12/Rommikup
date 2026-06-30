/**
 * @file stats-repository.js
 * @description Persists and reads per-device win/loss tallies in Firestore.
 * Each device has one document at `stats/{deviceId}` holding `{ wins, losses }`.
 * Kept separate from the game repository because it is a different concern with
 * its own collection and lifecycle.
 */

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from './firebase-init.js';

/** Firestore collection for per-device statistics. */
const STATS_COLLECTION = 'stats';

/** A zeroed record, used when a device has no stored stats yet. */
const EMPTY_STATS = Object.freeze({ wins: 0, losses: 0 });

/** Document reference for a device's stats. */
function statsRef(deviceId) {
  return doc(db, STATS_COLLECTION, deviceId);
}

/**
 * Atomically records the outcome of a finished game for one device.
 *
 * @param {string} deviceId
 * @param {boolean} didWin True to add a win, false to add a loss.
 * @returns {Promise<void>}
 */
export async function recordResult(deviceId, didWin) {
  if (!deviceId) return;
  await setDoc(
    statsRef(deviceId),
    {
      wins: increment(didWin ? 1 : 0),
      losses: increment(didWin ? 0 : 1),
    },
    { merge: true },
  );
}

/**
 * Reads a device's stats once, returning zeros when none exist.
 *
 * @param {string} deviceId
 * @returns {Promise<{ wins: number, losses: number }>}
 */
export async function fetchStats(deviceId) {
  if (!deviceId) return { ...EMPTY_STATS };
  const snapshot = await getDoc(statsRef(deviceId));
  return snapshot.exists()
    ? { ...EMPTY_STATS, ...snapshot.data() }
    : { ...EMPTY_STATS };
}

/**
 * Subscribes to live updates of a device's stats.
 *
 * @param {string} deviceId
 * @param {(stats: { wins: number, losses: number }) => void} onChange
 * @returns {() => void} Unsubscribe function (a no-op when deviceId is missing).
 */
export function subscribeStats(deviceId, onChange) {
  if (!deviceId) return () => {};
  return onSnapshot(statsRef(deviceId), (snapshot) => {
    onChange(snapshot.exists() ? { ...EMPTY_STATS, ...snapshot.data() } : { ...EMPTY_STATS });
  });
}
