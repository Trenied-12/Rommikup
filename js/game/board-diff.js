/**
 * @file board-diff.js
 * @description Computes what changed on the board between two snapshots, so the
 * UI can highlight the opponent's most recent move:
 *
 *   - GREEN  → a brand-new meld (every tile freshly placed).
 *   - YELLOW → individual tiles added onto a meld that already existed.
 *   - RED    → a meld from which tiles were removed, or that was split/merged.
 *
 * Pure function; returns plain id collections so the view can stay dumb.
 *
 * @typedef {Object} BoardDiff
 * @property {Set<string>} newMeldIds      Meld ids to outline green.
 * @property {Set<string>} reducedMeldIds  Meld ids to outline red.
 * @property {Set<string>} addedTileIds    Tile ids to outline yellow.
 */

/** Maps every tile id on a board to the id of the meld that holds it. */
function meldOfTile(board) {
  const map = new Map();
  for (const meld of board) {
    for (const tile of meld.tiles) map.set(tile.id, meld.id);
  }
  return map;
}

/**
 * Diffs two boards (the one before the opponent's turn and the one after).
 *
 * @param {import('./validation.js').Meld[]} oldBoard
 * @param {import('./validation.js').Meld[]} newBoard
 * @returns {BoardDiff}
 */
export function computeBoardDiff(oldBoard, newBoard) {
  const newMeldIds = new Set();
  const reducedMeldIds = new Set();
  const addedTileIds = new Set();

  const oldMeldOf = meldOfTile(oldBoard);

  for (const meld of newBoard) {
    const oldTiles = meld.tiles.filter((tile) => oldMeldOf.has(tile.id));
    const freshTiles = meld.tiles.filter((tile) => !oldMeldOf.has(tile.id));

    if (oldTiles.length === 0) {
      // No previously-seen tile → this meld is entirely new.
      newMeldIds.add(meld.id);
      continue;
    }

    // Which existing melds contributed tiles to this one?
    const sourceMeldIds = new Set(oldTiles.map((tile) => oldMeldOf.get(tile.id)));

    // A clean extension: tiles come from exactly one old meld, that old meld is
    // fully present here, and nothing else from it ended up elsewhere.
    const singleSource = sourceMeldIds.size === 1;
    const sourceId = singleSource ? [...sourceMeldIds][0] : null;
    const sourceMeld = singleSource
      ? oldBoard.find((entry) => entry.id === sourceId)
      : null;
    const sourceFullyHere =
      sourceMeld != null &&
      sourceMeld.tiles.every((tile) =>
        meld.tiles.some((other) => other.id === tile.id),
      );

    if (singleSource && sourceFullyHere) {
      // Pure extension: just mark the newly attached tiles.
      for (const tile of freshTiles) addedTileIds.add(tile.id);
    } else {
      // Tiles were removed from / merged across existing melds → flag red, and
      // still mark any genuinely new tiles that were mixed in.
      reducedMeldIds.add(meld.id);
      for (const tile of freshTiles) addedTileIds.add(tile.id);
    }
  }

  return { newMeldIds, reducedMeldIds, addedTileIds };
}

/** True when a diff carries no highlights at all (e.g. opponent only drew). */
export function isEmptyDiff(diff) {
  return (
    diff.newMeldIds.size === 0 &&
    diff.reducedMeldIds.size === 0 &&
    diff.addedTileIds.size === 0
  );
}
