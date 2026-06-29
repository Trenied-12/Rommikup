/**
 * @file engine.test.js
 * @description Unit tests for the turn engine: drawing, initial-meld rules,
 * tile conservation, joker handling and winning.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialGameState,
} from '../js/models/game-state.js';
import {
  joinGame,
  drawTile,
  commitTurn,
} from '../js/game/game-engine.js';
import { createNumberTile, createJokerTile } from '../js/models/tile.js';
import { COLORS, SEAT, GAME_STATUS } from '../js/game/constants.js';

let counter = 0;
const num = (color, number) => createNumberTile(`x${counter++}`, color, number);
const joker = () => createJokerTile(`jk${counter++}`);

/** Builds an in-progress game whose host hand we fully control. */
function gameWithHostHand(hostHand) {
  const base = createInitialGameState({ roomCode: 'TEST1', hostId: 'host-uid' });
  const started = joinGame(base, 'guest-uid');
  return {
    ...started,
    hands: { ...started.hands, host: hostHand },
  };
}

test('drawing moves a tile from pool to hand and passes the turn', () => {
  const game = joinGame(
    createInitialGameState({ roomCode: 'R', hostId: 'h' }),
    'g',
  );
  const poolBefore = game.pool.length;
  const handBefore = game.hands.host.length;

  const result = drawTile(game, SEAT.HOST);
  assert.equal(result.ok, true);
  assert.equal(result.state.pool.length, poolBefore - 1);
  assert.equal(result.state.hands.host.length, handBefore + 1);
  assert.equal(result.state.currentTurn, SEAT.GUEST);
});

test('cannot act when it is not your turn', () => {
  const game = joinGame(
    createInitialGameState({ roomCode: 'R', hostId: 'h' }),
    'g',
  );
  const result = drawTile(game, SEAT.GUEST);
  assert.equal(result.ok, false);
});

test('initial meld below 30 points is rejected', () => {
  const hand = [num(COLORS.RED, 1), num(COLORS.RED, 2), num(COLORS.RED, 3)];
  const game = gameWithHostHand([...hand, num(COLORS.BLUE, 9)]);

  const proposedBoard = [{ id: 'm1', tiles: hand }];
  const proposedHand = [num(COLORS.BLUE, 9)];
  // Reuse the same blue 9 id present in hand so conservation holds:
  proposedHand[0] = game.hands.host[3];

  const result = commitTurn(game, SEAT.HOST, {
    board: proposedBoard,
    hand: proposedHand,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /30 Punkte/);
});

test('initial meld of exactly 30 points is accepted', () => {
  const a = num(COLORS.RED, 10);
  const b = num(COLORS.BLUE, 10);
  const c = num(COLORS.BLACK, 10);
  const spare = num(COLORS.YELLOW, 5);
  const game = gameWithHostHand([a, b, c, spare]);

  const result = commitTurn(game, SEAT.HOST, {
    board: [{ id: 'm1', tiles: [a, b, c] }],
    hand: [spare],
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.hasMadeInitialMeld.host, true);
  assert.equal(result.state.currentTurn, SEAT.GUEST);
});

test('a turn that invents a tile is rejected (conservation)', () => {
  const a = num(COLORS.RED, 10);
  const b = num(COLORS.BLUE, 10);
  const c = num(COLORS.BLACK, 10);
  const game = gameWithHostHand([a, b, c]);

  const ghost = num(COLORS.YELLOW, 10); // never was in the hand
  const result = commitTurn(game, SEAT.HOST, {
    board: [{ id: 'm1', tiles: [a, b, c, ghost] }],
    hand: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gehören/);
});

test('emptying the hand wins the game', () => {
  const a = num(COLORS.RED, 11);
  const b = num(COLORS.BLUE, 11);
  const c = num(COLORS.BLACK, 11);
  const game = gameWithHostHand([a, b, c]);

  const result = commitTurn(game, SEAT.HOST, {
    board: [{ id: 'm1', tiles: [a, b, c] }],
    hand: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.status, GAME_STATUS.FINISHED);
  assert.equal(result.state.winner, SEAT.HOST);
});

test('a joker on the board may not be carried back to the rack', () => {
  // Host has already melded; board holds a run with a joker.
  const r5 = num(COLORS.RED, 5);
  const jok = joker();
  const r7 = num(COLORS.RED, 7);
  const handTile = num(COLORS.BLUE, 3);

  let game = gameWithHostHand([handTile]);
  game = {
    ...game,
    board: [{ id: 'm1', tiles: [r5, jok, r7] }],
    hasMadeInitialMeld: { host: true, guest: false },
  };

  // Player tries to pocket the joker and dump a useless tile on the board.
  const result = commitTurn(game, SEAT.HOST, {
    board: [{ id: 'm1', tiles: [r5, handTile, r7] }],
    hand: [jok],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Joker/);
});
