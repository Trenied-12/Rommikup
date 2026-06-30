/**
 * @file validation.js
 * @description Pure rule-checking for Rummikub melds and boards. Knows nothing
 * about players, turns, Firebase or the DOM — it only answers the question
 * "is this arrangement of tiles legal?".
 *
 * A *meld* is an ordered list of tiles. Order is significant for runs (the
 * sequence is read left to right) and irrelevant for groups.
 *
 * @typedef {Object} Meld
 * @property {string} id
 * @property {import('../models/tile.js').Tile[]} tiles
 *
 * @typedef {Object} MeldAnalysis
 * @property {boolean} valid
 * @property {?string} type    One of MELD_TYPE, when valid.
 * @property {number} points   Total point value of the meld (0 when invalid).
 * @property {?string} reason  Human-readable explanation when invalid.
 */

import {
  MELD_TYPE,
  MIN_MELD_SIZE,
  MAX_GROUP_SIZE,
  MAX_NUMBER,
} from './constants.js';

/** @returns {MeldAnalysis} A failed analysis carrying an explanation. */
function invalid(reason) {
  return { valid: false, type: null, points: 0, reason };
}

/**
 * The number that appears at a given offset of a run starting at `startValue`,
 * wrapping around so that 13 is followed by 1 (house rule). Always returns a
 * value in the range [MIN_NUMBER, MAX_NUMBER].
 *
 * @param {number} startValue Number at offset 0 (1..13).
 * @param {number} offset Position within the run.
 * @returns {number}
 */
function runNumberAt(startValue, offset) {
  const span = MAX_NUMBER; // 13 distinct numbers on the cycle
  return (((startValue - 1 + offset) % span) + span) % span + 1;
}

/**
 * Attempts to read the tiles as a run: 3+ consecutive numbers of one colour,
 * with jokers filling gaps. Runs wrap around: after 13 comes 1 again (so
 * 12-13-1 or 8-9-10-11-12-13-1 are valid). A run can hold at most 13 tiles,
 * since a 14th would repeat a number.
 *
 * @param {import('../models/tile.js').Tile[]} tiles Ordered tiles.
 * @returns {MeldAnalysis}
 */
export function analyzeAsRun(tiles) {
  if (tiles.length < MIN_MELD_SIZE) {
    return invalid(`Eine Reihe braucht mindestens ${MIN_MELD_SIZE} Steine.`);
  }
  if (tiles.length > MAX_NUMBER) {
    return invalid(`Eine Reihe darf höchstens ${MAX_NUMBER} Steine haben.`);
  }

  const numbered = tiles
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => !tile.isJoker);

  if (numbered.length === 0) {
    return invalid('Eine Reihe muss mindestens einen echten Stein enthalten.');
  }

  // All real tiles must share a single colour.
  const color = numbered[0].tile.color;
  if (numbered.some(({ tile }) => tile.color !== color)) {
    return invalid('Eine Reihe darf nur eine Farbe enthalten.');
  }

  // Derive the value the first slot must hold (mod 13), then check every real
  // tile sits exactly where this cyclic sequence expects it.
  const first = numbered[0];
  const startValue = runNumberAt(first.tile.number, -first.index);
  for (const { tile, index } of numbered) {
    if (tile.number !== runNumberAt(startValue, index)) {
      return invalid('Die Zahlen einer Reihe müssen lückenlos aufsteigen.');
    }
  }

  // Jokers contribute the value of the slot they fill.
  let points = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    points += runNumberAt(startValue, i);
  }

  return { valid: true, type: MELD_TYPE.RUN, points, reason: null };
}

/**
 * Attempts to read the tiles as a group: 3–4 tiles sharing one number with
 * distinct colours, jokers filling the missing colours.
 *
 * @param {import('../models/tile.js').Tile[]} tiles
 * @returns {MeldAnalysis}
 */
export function analyzeAsGroup(tiles) {
  if (tiles.length < MIN_MELD_SIZE) {
    return invalid(`Eine Gruppe braucht mindestens ${MIN_MELD_SIZE} Steine.`);
  }
  if (tiles.length > MAX_GROUP_SIZE) {
    return invalid(`Eine Gruppe darf höchstens ${MAX_GROUP_SIZE} Steine haben.`);
  }

  const numbered = tiles.filter((tile) => !tile.isJoker);
  if (numbered.length === 0) {
    return invalid('Eine Gruppe muss mindestens einen echten Stein enthalten.');
  }

  const number = numbered[0].number;
  if (numbered.some((tile) => tile.number !== number)) {
    return invalid('Eine Gruppe muss aus gleichen Zahlen bestehen.');
  }

  const seenColors = new Set();
  for (const tile of numbered) {
    if (seenColors.has(tile.color)) {
      return invalid('In einer Gruppe darf jede Farbe nur einmal vorkommen.');
    }
    seenColors.add(tile.color);
  }

  const points = number * tiles.length;
  return { valid: true, type: MELD_TYPE.GROUP, points, reason: null };
}

/**
 * Analyses a meld, accepting it if it forms a valid run OR a valid group.
 * (With few real tiles a meld can be legal as either; we accept the first
 * interpretation that works.)
 *
 * @param {import('../models/tile.js').Tile[]} tiles
 * @returns {MeldAnalysis}
 */
export function analyzeMeld(tiles) {
  const asRun = analyzeAsRun(tiles);
  if (asRun.valid) return asRun;

  const asGroup = analyzeAsGroup(tiles);
  if (asGroup.valid) return asGroup;

  // Surface the more relevant message: if all real tiles share a colour the
  // player was probably attempting a run; otherwise a group.
  const realTiles = tiles.filter((tile) => !tile.isJoker);
  const oneColor =
    realTiles.length > 0 &&
    realTiles.every((tile) => tile.color === realTiles[0].color);
  return oneColor ? asRun : asGroup;
}

/**
 * Validates an entire board (collection of melds).
 *
 * @param {Meld[]} melds
 * @returns {{ valid: boolean, points: number, invalidMeldIds: string[], reason: ?string }}
 */
export function analyzeBoard(melds) {
  let totalPoints = 0;
  const invalidMeldIds = [];
  let firstReason = null;

  for (const meld of melds) {
    const analysis = analyzeMeld(meld.tiles);
    if (analysis.valid) {
      totalPoints += analysis.points;
    } else {
      invalidMeldIds.push(meld.id);
      if (!firstReason) firstReason = analysis.reason;
    }
  }

  return {
    valid: invalidMeldIds.length === 0,
    points: totalPoints,
    invalidMeldIds,
    reason: firstReason,
  };
}
