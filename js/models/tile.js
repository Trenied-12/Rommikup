/**
 * @file tile.js
 * @description The Tile model and helpers. A tile is a plain, serialisable data
 * object (so it can be stored in Firestore directly) plus a set of pure helper
 * functions that operate on it. We deliberately avoid class instances on the
 * wire — Firestore stores/loads plain objects.
 *
 * @typedef {Object} Tile
 * @property {string} id        Globally unique id for this physical tile.
 * @property {boolean} isJoker  True if this tile is a joker.
 * @property {?string} color    One of COLORS, or null for a joker.
 * @property {?number} number   1..13, or null for a joker.
 */

import { JOKER_NUMBER } from '../game/constants.js';

/**
 * Creates a numbered tile.
 *
 * @param {string} id
 * @param {string} color
 * @param {number} number
 * @returns {Tile}
 */
export function createNumberTile(id, color, number) {
  return { id, isJoker: false, color, number };
}

/**
 * Creates a joker tile.
 *
 * @param {string} id
 * @returns {Tile}
 */
export function createJokerTile(id) {
  return { id, isJoker: true, color: null, number: null };
}

/**
 * The point value a tile contributes. For a joker on the board this depends on
 * the role it currently fills, which the caller must resolve separately; on a
 * player's rack a joker is valued via JOKER_PENALTY_POINTS by the scorer.
 *
 * @param {Tile} tile
 * @returns {number}
 */
export function tileFaceValue(tile) {
  return tile.isJoker ? JOKER_NUMBER : tile.number;
}

/**
 * Human-readable label for logging/debugging (e.g. "red 7", "joker").
 *
 * @param {Tile} tile
 * @returns {string}
 */
export function tileLabel(tile) {
  return tile.isJoker ? 'joker' : `${tile.color} ${tile.number}`;
}
