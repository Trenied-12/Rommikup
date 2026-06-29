/**
 * @file tile-factory.js
 * @description Builds a complete, freshly-shuffled set of tiles and deals the
 * starting hands. Pure functions only — no DOM, no Firebase.
 */

import {
  COLOR_LIST,
  MIN_NUMBER,
  MAX_NUMBER,
  COPIES_PER_TILE,
  JOKER_COUNT,
  STARTING_HAND_SIZE,
} from './constants.js';
import { createNumberTile, createJokerTile } from '../models/tile.js';
import { generateId, shuffle } from '../utils/random.js';

/**
 * Builds the full, unshuffled set of 106 tiles.
 *
 * @returns {import('../models/tile.js').Tile[]}
 */
export function buildFullTileSet() {
  const tiles = [];

  for (const color of COLOR_LIST) {
    for (let number = MIN_NUMBER; number <= MAX_NUMBER; number += 1) {
      for (let copy = 0; copy < COPIES_PER_TILE; copy += 1) {
        tiles.push(createNumberTile(generateId(), color, number));
      }
    }
  }

  for (let i = 0; i < JOKER_COUNT; i += 1) {
    tiles.push(createJokerTile(generateId()));
  }

  return tiles;
}

/**
 * Creates a new shuffled pool and deals the two starting hands from it.
 *
 * @returns {{
 *   hostHand: import('../models/tile.js').Tile[],
 *   guestHand: import('../models/tile.js').Tile[],
 *   pool: import('../models/tile.js').Tile[]
 * }} The two hands and the remaining draw pool (top of pool = last element).
 */
export function dealNewGame() {
  const shuffled = shuffle(buildFullTileSet());

  const hostHand = shuffled.slice(0, STARTING_HAND_SIZE);
  const guestHand = shuffled.slice(STARTING_HAND_SIZE, STARTING_HAND_SIZE * 2);
  const pool = shuffled.slice(STARTING_HAND_SIZE * 2);

  return { hostHand, guestHand, pool };
}
