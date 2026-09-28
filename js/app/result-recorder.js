/**
 * @file result-recorder.js
 * @description Adds a finished game's outcome to this device's win/loss tally
 * ("Statistik") exactly once — no matter whether the end was witnessed live in
 * the game or only discovered later in "Meine letzten Spiele".
 */

import { recordResult } from '../firebase/stats-repository.js';
import { GAME_RESULT } from '../game/constants.js';

/** localStorage key prefix marking a game whose result was already counted. */
const RECORDED_FLAG_PREFIX = 'rummikub.recorded.';

/** In-memory guard, so a disabled localStorage can never cause double counting. */
const recordedThisSession = new Set();

/**
 * Records a win or loss for this device once per game. Draws are not tallied.
 *
 * @param {string} roomCode
 * @param {string} deviceId
 * @param {?string} result One of GAME_RESULT.
 */
export function recordResultOnce(roomCode, deviceId, result) {
  if (result !== GAME_RESULT.WON && result !== GAME_RESULT.LOST) return;
  if (recordedThisSession.has(roomCode)) return;
  recordedThisSession.add(roomCode);

  const flag = RECORDED_FLAG_PREFIX + roomCode;
  try {
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, '1');
  } catch {
    // Storage unavailable — the in-memory guard above still prevents repeats.
  }

  recordResult(deviceId, result === GAME_RESULT.WON).catch(() => {
    /* a missed stat update is not worth interrupting anything */
  });
}
