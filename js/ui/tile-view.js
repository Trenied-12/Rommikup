/**
 * @file tile-view.js
 * @description Renders a single tile model into a DOM element. Pure view layer:
 * it reads a Tile and produces a node; it does not know about drag & drop or
 * game rules. The tile id is stored as a data attribute so other layers (DnD)
 * can map an element back to its model.
 */

import { createElement } from './dom.js';

/** Unicode joker face. */
const JOKER_GLYPH = '☺';

/**
 * Builds a DOM element for a tile.
 *
 * @param {import('../../js/models/tile.js').Tile} tile
 * @returns {HTMLElement}
 */
export function renderTile(tile) {
  const colorClass = tile.isJoker ? 'tile--joker' : `tile--${tile.color}`;
  const label = tile.isJoker ? 'Joker' : `${tile.color} ${tile.number}`;

  return createElement(
    'div',
    {
      class: `tile ${colorClass}`,
      dataset: { tileId: tile.id },
      attrs: { role: 'img', 'aria-label': label, draggable: 'false' },
    },
    [
      createElement('span', {
        class: 'tile__value',
        text: tile.isJoker ? JOKER_GLYPH : String(tile.number),
      }),
    ],
  );
}

/**
 * Builds a face-down tile element used to represent an opponent's hidden tile.
 *
 * @returns {HTMLElement}
 */
export function renderTileBack() {
  return createElement('div', {
    class: 'tile tile--back',
    attrs: { 'aria-label': 'Verdeckter Stein' },
  });
}
