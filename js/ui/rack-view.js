/**
 * @file rack-view.js
 * @description Renders the current player's own rack of tiles, plus helpers to
 * sort the rack for readability. Sorting is purely cosmetic and never changes
 * which tiles a player holds.
 */

import { clearElement } from './dom.js';
import { renderTile } from './tile-view.js';
import { COLOR_LIST } from '../game/constants.js';

/**
 * Renders the player's hand into the rack container.
 *
 * @param {HTMLElement} container
 * @param {import('../models/tile.js').Tile[]} hand
 * @param {{ locked: boolean }} options
 */
export function renderRack(container, hand, { locked }) {
  clearElement(container);
  container.classList.toggle('rack--locked', locked);
  for (const tile of hand) {
    container.append(renderTile(tile));
  }
}

/** Numeric rank of a colour, for stable sorting. */
function colorRank(tile) {
  return tile.isJoker ? COLOR_LIST.length : COLOR_LIST.indexOf(tile.color);
}

/**
 * Returns a new hand sorted by colour, then number. Jokers go last.
 *
 * @param {import('../models/tile.js').Tile[]} hand
 * @returns {import('../models/tile.js').Tile[]}
 */
export function sortByColor(hand) {
  return [...hand].sort((a, b) => {
    if (a.isJoker || b.isJoker) return colorRank(a) - colorRank(b);
    if (a.color !== b.color) return colorRank(a) - colorRank(b);
    return a.number - b.number;
  });
}

/**
 * Returns a new hand sorted by number, then colour. Jokers go last.
 *
 * @param {import('../models/tile.js').Tile[]} hand
 * @returns {import('../models/tile.js').Tile[]}
 */
export function sortByNumber(hand) {
  return [...hand].sort((a, b) => {
    if (a.isJoker || b.isJoker) return colorRank(a) - colorRank(b);
    if (a.number !== b.number) return a.number - b.number;
    return colorRank(a) - colorRank(b);
  });
}
