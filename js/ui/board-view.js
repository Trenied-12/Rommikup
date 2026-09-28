/**
 * @file board-view.js
 * @description Renders the shared board (a list of melds) into the DOM and
 * highlights any meld that is currently invalid, giving live feedback while a
 * player rearranges tiles. Thanks to the realtime board preview the opponent
 * watches those rearrangements as they happen, so no after-the-fact diff
 * highlighting is needed.
 */

import { createElement, clearElement } from './dom.js';
import { renderTile } from './tile-view.js';
import { analyzeMeld } from '../game/validation.js';

/**
 * Renders the board.
 *
 * @param {HTMLElement} container The board element.
 * @param {import('../game/validation.js').Meld[]} board
 * @param {{ locked: boolean, highlightTileIds?: Set<string> }} options
 *        locked: tiles are not interactive. highlightTileIds: tiles to mark as
 *        freshly played (used by the history replay).
 */
export function renderBoard(container, board, { locked, highlightTileIds = null }) {
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
    const meldEl = createElement('div', {
      class: `meld${analysis.valid ? '' : ' meld--invalid'}`,
      dataset: { dropzone: 'meld', meldId: meld.id },
      attrs: { title: analysis.valid ? null : analysis.reason },
    });

    for (const tile of meld.tiles) {
      const tileEl = renderTile(tile);
      if (highlightTileIds?.has(tile.id)) tileEl.classList.add('tile--fresh');
      meldEl.append(tileEl);
    }
    container.append(meldEl);
  }
}
