/**
 * @file format.js
 * @description German-locale formatting of dates, times and durations for the
 * game list and the replay.
 */

/** Locale used for every user-facing date and time. */
const LOCALE = 'de-DE';

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;

const DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const TIME = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * "28.09.2026, 14:32"
 *
 * @param {?number} ms Epoch millis.
 * @returns {string}
 */
export function formatDateTime(ms) {
  return typeof ms === 'number' ? DATE_TIME.format(ms) : '–';
}

/**
 * "14:32:05"
 *
 * @param {?number} ms Epoch millis.
 * @returns {string}
 */
export function formatTime(ms) {
  return typeof ms === 'number' ? TIME.format(ms) : '';
}

/**
 * Compact duration: "< 1 Min", "18 Min", "1 Std 5 Min".
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const minutes = Math.floor(ms / MS_PER_MINUTE);
  if (minutes < 1) return '< 1 Min';
  if (minutes < MINUTES_PER_HOUR) return `${minutes} Min`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours} Std` : `${hours} Std ${rest} Min`;
}
