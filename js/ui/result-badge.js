/**
 * @file result-badge.js
 * @description Label and colour variant of the small "Gewonnen / Verloren /
 * Unentschieden / Läuft / Wartet" badge. Shared by the recent-games list and
 * the history screen so the wording is defined exactly once.
 */

import { GAME_STATUS, GAME_RESULT } from '../game/constants.js';

/** Badge per finished result. */
const RESULT_BADGES = Object.freeze({
  [GAME_RESULT.WON]: { label: 'Gewonnen', variant: 'won' },
  [GAME_RESULT.LOST]: { label: 'Verloren', variant: 'lost' },
  [GAME_RESULT.DRAW]: { label: 'Unentschieden', variant: 'draw' },
});

/** Badges for games that are not finished yet. */
const OPEN_BADGES = Object.freeze({
  running: { label: 'Läuft', variant: 'open' },
  waiting: { label: 'Wartet', variant: 'open' },
});

/**
 * Chooses the badge for a game.
 *
 * @param {{ status: string, result: ?string }} game
 * @returns {{ label: string, variant: string }}
 */
export function resultBadge({ status, result }) {
  if (status === GAME_STATUS.FINISHED) {
    return RESULT_BADGES[result] ?? RESULT_BADGES[GAME_RESULT.DRAW];
  }
  return status === GAME_STATUS.WAITING_FOR_OPPONENT
    ? OPEN_BADGES.waiting
    : OPEN_BADGES.running;
}

/**
 * Applies a badge to an existing element (text + `result-badge--*` class).
 *
 * @param {HTMLElement} element
 * @param {{ status: string, result: ?string }} game
 */
export function applyResultBadge(element, game) {
  const badge = resultBadge(game);
  element.textContent = badge.label;
  element.className = `result-badge result-badge--${badge.variant}`;
}
