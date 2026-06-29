/**
 * @file validation.test.js
 * @description Unit tests for meld and board validation. Run with `npm test`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeMeld,
  analyzeAsRun,
  analyzeAsGroup,
  analyzeBoard,
} from '../js/game/validation.js';
import { createNumberTile, createJokerTile } from '../js/models/tile.js';
import { COLORS } from '../js/game/constants.js';

let counter = 0;
/** Tiny helpers to build tiles with unique ids for each test. */
const num = (color, number) => createNumberTile(`t${counter++}`, color, number);
const joker = () => createJokerTile(`j${counter++}`);

test('valid run of three same-colour consecutive tiles', () => {
  const result = analyzeAsRun([
    num(COLORS.RED, 5),
    num(COLORS.RED, 6),
    num(COLORS.RED, 7),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.points, 18);
});

test('run rejects a gap in the sequence', () => {
  const result = analyzeAsRun([
    num(COLORS.RED, 5),
    num(COLORS.RED, 6),
    num(COLORS.RED, 8),
  ]);
  assert.equal(result.valid, false);
});

test('run rejects mixed colours', () => {
  const result = analyzeAsRun([
    num(COLORS.RED, 5),
    num(COLORS.BLUE, 6),
    num(COLORS.RED, 7),
  ]);
  assert.equal(result.valid, false);
});

test('run with a joker filling a gap is valid and scored correctly', () => {
  const result = analyzeAsRun([
    num(COLORS.BLUE, 9),
    joker(), // stands for blue 10
    num(COLORS.BLUE, 11),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.points, 30); // 9 + 10 + 11
});

test('run cannot exceed 13', () => {
  const result = analyzeAsRun([
    num(COLORS.BLACK, 12),
    num(COLORS.BLACK, 13),
    joker(),
  ]);
  assert.equal(result.valid, false);
});

test('valid group of three distinct colours', () => {
  const result = analyzeAsGroup([
    num(COLORS.RED, 8),
    num(COLORS.BLUE, 8),
    num(COLORS.BLACK, 8),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.points, 24);
});

test('group rejects duplicate colour', () => {
  const result = analyzeAsGroup([
    num(COLORS.RED, 8),
    num(COLORS.RED, 8),
    num(COLORS.BLUE, 8),
  ]);
  assert.equal(result.valid, false);
});

test('group rejects more than four tiles', () => {
  const result = analyzeAsGroup([
    num(COLORS.RED, 8),
    num(COLORS.BLUE, 8),
    num(COLORS.BLACK, 8),
    num(COLORS.YELLOW, 8),
    joker(),
  ]);
  assert.equal(result.valid, false);
});

test('group with a joker filling a colour is valid', () => {
  const result = analyzeAsGroup([
    num(COLORS.RED, 12),
    num(COLORS.BLUE, 12),
    joker(),
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.points, 36);
});

test('analyzeMeld accepts an ambiguous joker meld as a run', () => {
  const result = analyzeMeld([num(COLORS.RED, 5), joker(), joker()]);
  assert.equal(result.valid, true);
});

test('analyzeBoard flags the invalid meld and sums the rest', () => {
  const goodRun = {
    id: 'm1',
    tiles: [num(COLORS.RED, 1), num(COLORS.RED, 2), num(COLORS.RED, 3)],
  };
  const badMeld = {
    id: 'm2',
    tiles: [num(COLORS.RED, 1), num(COLORS.RED, 2)],
  };
  const result = analyzeBoard([goodRun, badMeld]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidMeldIds, ['m2']);
});
