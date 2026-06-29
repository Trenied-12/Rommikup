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
  MIN_NUMBER,
  MAX_NUMBER,
} from './constants.js';

/** @returns {MeldAnalysis} A failed analysis carrying an explanation. */
function invalid(reason) {
  return { valid: false, type: null, points: 0, reason };
}

/**
 * Attempts to read the tiles as a run: 3+ consecutive numbers, one colour,
 * with jokers filling gaps.
 *
 * @param {import('../models/tile.js').Tile[]} tiles Ordered tiles.
 * @returns {MeldAnalysis}
 */
export function analyzeAsRun(tiles) {
  if (tiles.length < MIN_MELD_SIZE) {
    return invalid(`Eine Reihe braucht mindestens ${MIN_MELD_SIZE} Steine.`);
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

  // Derive the value the first slot must hold; every real tile must agree.
  const startValue = numbered[0].tile.number - numbered[0].index;
  for (const { tile, index } of numbered) {
    if (tile.number - index !== startValue) {
      return invalid('Die Zahlen einer Reihe müssen lückenlos aufsteigen.');
    }
  }

  const endValue = startValue + tiles.length - 1;
  if (startValue < MIN_NUMBER || endValue > MAX_NUMBER) {
    return invalid(
      `Eine Reihe muss innerhalb von ${MIN_NUMBER}–${MAX_NUMBER} liegen.`,
    );
  }

  // Sum of an arithmetic sequence; jokers contribute their derived value.
  let points = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    points += startValue + i;
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
