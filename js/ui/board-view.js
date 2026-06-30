/**
 * @file board-view.js
 * @description Renders the shared board (a list of melds) into the DOM. It
 * highlights melds that are currently invalid (live feedback while editing) and
 * can additionally overlay a "what the opponent just did" diff: green for new
 * melds, red for melds that lost tiles, yellow for individual added tiles.
 */

import { createElement, clearElement } from './dom.js';
import { renderTile } from './tile-view.js';
import { analyzeMeld } from '../game/validation.js';

/** An empty diff, so callers can omit highlighting. */
const NO_HIGHLIGHTS = {
  newMeldIds: new Set(),
  reducedMeldIds: new Set(),
  addedTileIds: new Set(),
};

/**
 * Renders the board.
 *
 * @param {HTMLElement} container The board element.
 * @param {import('../game/validation.js').Meld[]} board
 * @param {{ locked: boolean, highlights?: import('../game/board-diff.js').BoardDiff }} options
 */
export function renderBoard(container, board, { locked, highlights }) {
  const diff = highlights ?? NO_HIGHLIGHTS;
  clearElement(container);
  container.classList.toggle('board--locked', locked);

  if (board.length === 0) {
    container.append(
      createElement('p', {
        class: 'board__placeholder',
        text: locked
          ? 'Noch keine Steine ausgelegt.'
          : 'Ziehe Steine hierher, um Kombinationen zu bilden.',
      }),
    );
    return;
  }

  for (const meld of board) {
    const analysis = analyzeMeld(meld.tiles);
    const classes = ['meld'];
    if (!analysis.valid) classes.push('meld--invalid');
    if (diff.newMeldIds.has(meld.id)) classes.push('meld--new');
    if (diff.reducedMeldIds.has(meld.id)) classes.push('meld--reduced');

    const meldEl = createElement('div', {
      class: classes.join(' '),
      dataset: { dropzone: 'meld', meldId: meld.id },
      attrs: { title: analysis.valid ? null : analysis.reason },
    });

    for (const tile of meld.tiles) {
      const tileEl = renderTile(tile);
      if (diff.addedTileIds.has(tile.id)) tileEl.classList.add('tile--added');
      meldEl.append(tileEl);
    }
    container.append(meldEl);
  }
}
