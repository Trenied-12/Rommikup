/**
 * @file drag-drop.js
 * @description Pointer-based drag & drop. Built on Pointer Events so the exact
 * same code path works for mouse (desktop) and touch (tablet) — HTML5 native
 * drag is deliberately avoided because it is unreliable on touch devices.
 *
 * This module is intentionally "dumb" about game rules. When a tile is dropped
 * it computes a *semantic target* — a rack position, a position inside a meld,
 * or a brand-new meld — and hands it to a callback. The controller owns the
 * model and decides what the move means.
 *
 * Drop zones are declared in the DOM via data attributes:
 *   data-dropzone="rack"      → the player's rack
 *   data-dropzone="meld"      → an existing meld (also carries data-meld-id)
 *   data-dropzone="new-meld"  → the board background; a drop here starts a meld
 */

/**
 * @typedef {Object} DropTarget
 * @property {'rack'|'meld'|'new'} zone
 * @property {?string} meldId  Present when zone === 'meld'.
 * @property {number} index    Insertion index within the zone (ignored for 'new').
 */

/** Distance in px the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

/**
 * Wires up drag & drop on a root element.
 *
 * @param {{
 *   root: HTMLElement,
 *   isEnabled: () => boolean,
 *   onDrop: (tileId: string, target: DropTarget) => void
 * }} config
 * @returns {{ destroy: () => void }}
 */
export function createDragController({ root, isEnabled, onDrop }) {
  /** @type {?HTMLElement} The original tile element being dragged. */
  let sourceEl = null;
  /** @type {?HTMLElement} The floating clone that follows the pointer. */
  let ghostEl = null;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let offsetY = 0;
  let activated = false;
  let pointerId = null;

  /** Finds the nearest ancestor (or self) that is a declared drop zone. */
  function findDropZone(element) {
    let node = element;
    while (node && node !== root) {
      if (node.dataset && node.dataset.dropzone) return node;
      node = node.parentElement;
    }
    return node && node.dataset?.dropzone ? node : null;
  }

  /**
   * Computes where, within a container, a drop at (x, y) should insert — by
   * counting tiles that lie before the pointer in reading order (row, then x).
   */
  function computeInsertIndex(container, x, y) {
    const tiles = [...container.querySelectorAll('.tile:not(.tile--dragging)')];
    let index = 0;
    for (const tile of tiles) {
      const rect = tile.getBoundingClientRect();
      const sameRow = y >= rect.top && y <= rect.bottom;
      if (rect.bottom < y) {
        index += 1; // tile is on a row entirely above the pointer
      } else if (sameRow && rect.left + rect.width / 2 < x) {
        index += 1; // same row, pointer is to the right of this tile
      }
    }
    return index;
  }

  /** Highlights the drop zone currently under the pointer. */
  function updateHighlight(x, y) {
    clearHighlights();
    const under = document.elementFromPoint(x, y);
    const zone = under ? findDropZone(under) : null;
    if (!zone) return;

    if (zone.dataset.dropzone === 'meld') zone.classList.add('meld--droptarget');
    else if (zone.dataset.dropzone === 'rack') zone.classList.add('rack--droptarget');
    else if (zone.dataset.dropzone === 'new-meld') zone.classList.add('board--droptarget');
  }

  function clearHighlights() {
    for (const el of root.querySelectorAll(
      '.meld--droptarget, .rack--droptarget, .board--droptarget',
    )) {
      el.classList.remove('meld--droptarget', 'rack--droptarget', 'board--droptarget');
    }
  }

  /** Builds the floating ghost element from the source tile. */
  function createGhost(rect) {
    const ghost = sourceEl.cloneNode(true);
    ghost.classList.add('tile--ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.append(ghost);
    return ghost;
  }

  function moveGhost(x, y) {
    if (!ghostEl) return;
    ghostEl.style.left = `${x - offsetX}px`;
    ghostEl.style.top = `${y - offsetY}px`;
  }

  function onPointerDown(event) {
    if (!isEnabled()) return;
    const tile = event.target.closest('.tile');
    if (!tile || !tile.dataset.tileId) return;
    // Ignore drags that start in a locked container.
    if (tile.closest('.rack--locked, .board--locked')) return;

    sourceEl = tile;
    pointerId = event.pointerId;
    const rect = tile.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    activated = false;
  }

  function onPointerMove(event) {
    if (!sourceEl || event.pointerId !== pointerId) return;

    if (!activated) {
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (moved < DRAG_THRESHOLD) return;
      // Promote to an actual drag.
      activated = true;
      sourceEl.classList.add('tile--dragging');
      ghostEl = createGhost(sourceEl.getBoundingClientRect());
    }

    event.preventDefault();
    moveGhost(event.clientX, event.clientY);
    updateHighlight(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    if (!sourceEl || event.pointerId !== pointerId) return;

    const tileId = sourceEl.dataset.tileId;
    const wasDragging = activated;
    const { clientX: x, clientY: y } = event;

    finishDrag();

    if (!wasDragging) return; // a tap, not a drag

    const under = document.elementFromPoint(x, y);
    const zone = under ? findDropZone(under) : null;
    if (!zone) return; // dropped outside any zone → no-op

    const kind = zone.dataset.dropzone;
    if (kind === 'meld') {
      onDrop(tileId, {
        zone: 'meld',
        meldId: zone.dataset.meldId,
        index: computeInsertIndex(zone, x, y),
      });
    } else if (kind === 'rack') {
      onDrop(tileId, { zone: 'rack', meldId: null, index: computeInsertIndex(zone, x, y) });
    } else if (kind === 'new-meld') {
      onDrop(tileId, { zone: 'new', meldId: null, index: 0 });
    }
  }

  /** Tears down the transient drag state (ghost, highlights, flags). */
  function finishDrag() {
    if (ghostEl) ghostEl.remove();
    if (sourceEl) sourceEl.classList.remove('tile--dragging');
    clearHighlights();
    ghostEl = null;
    sourceEl = null;
    activated = false;
    pointerId = null;
  }

  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', finishDrag);

  return {
    destroy() {
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', finishDrag);
      finishDrag();
    },
  };
}
