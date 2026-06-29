/**
 * @file random.js
 * @description Small, dependency-free helpers for randomness: unique id
 * generation, room-code creation and an unbiased array shuffle.
 */

import { ROOM_CODE_LENGTH } from '../game/constants.js';

/** Characters allowed in a room code. Visually ambiguous ones (0/O, 1/I) removed. */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Returns a cryptographically-strong random integer in the range [0, max).
 * Falls back to Math.random where the Web Crypto API is unavailable.
 *
 * @param {number} max Exclusive upper bound.
 * @returns {number}
 */
function randomInt(max) {
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] % max;
  }
  return Math.floor(Math.random() * max);
}

/**
 * Generates a unique identifier suitable for tiles, melds and similar entities.
 * Prefers the native randomUUID, otherwise composes a sufficiently unique value.
 *
 * @returns {string}
 */
export function generateId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${randomInt(1e9).toString(36)}`;
}

/**
 * Generates a short, human-readable room code (e.g. "K7QW2").
 *
 * @returns {string}
 */
export function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Returns a new array containing the input elements in random order using a
 * Fisher–Yates shuffle. The input array is not mutated.
 *
 * @template T
 * @param {readonly T[]} items
 * @returns {T[]}
 */
export function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
