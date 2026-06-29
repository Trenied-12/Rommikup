/**
 * @file working-turn.js
 * @description The *working copy* a player edits during their turn. It mirrors
 * the shared board plus the player's own hand and is mutated freely (and
 * possibly into invalid intermediate states) via drag & drop. Only when the
 * player commits does the engine validate it.
 *
 * All functions are pure: they return a new working object and never mutate the
 * input, which makes "reset turn" and undo trivial.
 *
 * @typedef {Object} WorkingTurn
 * @property {import('../game/validation.js').Meld[]} board
 * @property {import('./tile.js').Tile[]} hand
 */

import { generateId } from '../utils/random.js';

/** Deep-clones a board so edits never leak into the authoritative state. */
function cloneBoard(board) {
  return board.map((meld) => ({ id: meld.id, tiles: [...meld.tiles] }));
}

/**
 * Builds a fresh working copy from the authoritative board and the player's hand.
 *
 * @param {import('../game/validation.js').Meld[]} board
 * @param {import('./tile.js').Tile[]} hand
 * @returns {WorkingTurn}
 */
export function createWorkingTurn(board, hand) {
  return { board: cloneBoard(board), hand: [...hand] };
}

/** Clamps an index into the inclusive range [0, length]. */
function clampIndex(index, length) {
  return Math.max(0, Math.min(index, length));
}

/**
 * Removes a tile (by id) from either the hand or any meld, mutating the given
 * arrays in place and returning the removed tile (or null if not found).
 */
function removeTileFrom(board, hand, tileId) {
  const handIndex = hand.findIndex((tile) => tile.id === tileId);
  if (handIndex !== -1) {
    return hand.splice(handIndex, 1)[0];
  }
  for (const meld of board) {
    const meldIndex = meld.tiles.findIndex((tile) => tile.id === tileId);
    if (meldIndex !== -1) {
      return meld.tiles.splice(meldIndex, 1)[0];
    }
  }
  return null;
}

/**
 * Applies a drag-and-drop move to the working turn and returns the new state.
 *
 * @param {WorkingTurn} working
 * @param {string} tileId
 * @param {import('../dnd/drag-drop.js').DropTarget} target
 * @returns {WorkingTurn}
 */
export function applyDrop(working, tileId, target) {
  const board = cloneBoard(working.board);
  const hand = [...working.hand];

  const tile = removeTileFrom(board, hand, tileId);
  if (!tile) return working; // unknown tile id — ignore

  if (target.zone === 'rack') {
    hand.splice(clampIndex(target.index, hand.length), 0, tile);
  } else if (target.zone === 'meld') {
    const meld = board.find((entry) => entry.id === target.meldId);
    if (meld) {
      meld.tiles.splice(clampIndex(target.index, meld.tiles.length), 0, tile);
    } else {
      hand.push(tile); // target meld disappeared; keep the tile safe
    }
  } else if (target.zone === 'new') {
    board.push({ id: generateId(), tiles: [tile] });
  }

  // Drop any melds that were emptied by removing their last tile.
  const cleanedBoard = board.filter((meld) => meld.tiles.length > 0);
  return { board: cleanedBoard, hand };
}

/**
 * Replaces the player's hand with a re-ordered version (cosmetic sort) while
 * keeping the board untouched.
 *
 * @param {WorkingTurn} working
 * @param {import('./tile.js').Tile[]} sortedHand
 * @returns {WorkingTurn}
 */
export function withSortedHand(working, sortedHand) {
  return { board: working.board, hand: sortedHand };
}
