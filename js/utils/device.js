/**
 * @file device.js
 * @description Gives each browser/device a stable identifier the first time it
 * visits, persisted in localStorage. This id is used as the key for that
 * device's win/loss record in the backend, independent of any single game.
 */

import { generateId } from './random.js';

/** localStorage key under which the device id is stored. */
const DEVICE_ID_KEY = 'rummikub.deviceId';

/**
 * Returns this device's id, creating and persisting one on first use.
 *
 * @returns {string}
 */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage disabled: fall back to a per-session id.
    return generateId();
  }
}
