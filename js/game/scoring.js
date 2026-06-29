/**
 * @file scoring.js
 * @description End-of-game scoring. When the pool is empty and the active
 * player cannot (or chooses not to) move, the game ends and the player with the
 * lower remaining hand value wins. Jokers count as a fixed penalty.
 */

import { JOKER_PENALTY_POINTS } from './constants.js';

/**
 * Sums the penalty value of the tiles still on a player's rack.
 *
 * @param {import('../models/tile.js').Tile[]} hand
 * @returns {number}
 */
export function handPenalty(hand) {
  return hand.reduce(
    (sum, tile) => sum + (tile.isJoker ? JOKER_PENALTY_POINTS : tile.number),
    0,
  );
}

/**
 * Decides the winner from two final hands. Lower penalty wins; equal is a draw.
 *
 * @param {import('../models/tile.js').Tile[]} hostHand
 * @param {import('../models/tile.js').Tile[]} guestHand
 * @returns {{ hostPenalty: number, guestPenalty: number, winner: ?string }}
 *          winner is one of SEAT, or null on a draw.
 */
export function scoreEndgame(hostHand, guestHand) {
  const hostPenalty = handPenalty(hostHand);
  const guestPenalty = handPenalty(guestHand);

  let winner = null;
  if (hostPenalty < guestPenalty) winner = 'host';
  else if (guestPenalty < hostPenalty) winner = 'guest';

  return { hostPenalty, guestPenalty, winner };
}
