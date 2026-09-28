/**
 * @file history-view.js
 * @description Rendering of the history ("Spielverlauf") screen: the board at
 * the selected moment (freshly played tiles highlighted), the rack of the
 * chosen perspective, the other player's rack (face-down unless revealed), the
 * step description, the timeline controls and the clickable turn list.
 *
 * Pure view code — navigation state lives in the HistoryController.
 */

import { byId, clearElement, createElement } from './dom.js';
import { renderBoard } from './board-view.js';
import { renderRack, sortByColor } from './rack-view.js';
import { renderTileBack } from './tile-view.js';
import { describeSnapshot, freshTileIds } from '../game/history.js';
import { otherSeat } from '../models/game-state.js';
import { formatTime } from '../utils/format.js';

/**
 * @typedef {Object} HistoryFrame
 * @property {import('../game/history.js').HistorySnapshot} snapshot  Entry to show.
 * @property {?import('../game/history.js').HistorySnapshot} previous  Entry before it.
 * @property {number} position     Index within the loaded list.
 * @property {number} total        Number of loaded entries.
 * @property {number} lastIndex    History index of the final entry.
 * @property {string} viewerSeat   The seat of the person watching.
 * @property {string} perspective  Whose rack is shown at the bottom.
 * @property {boolean} revealOther Show the other rack face-up.
 * @property {boolean} playing     Autoplay running.
 */

/** Renders `count` face-down tiles. */
function renderHiddenRack(container, count) {
  clearElement(container);
  container.classList.add('rack--locked');
  for (let i = 0; i < count; i += 1) container.append(renderTileBack());
}

/** "Deine Steine · 12 · rausgekommen" */
function handLabel(seat, viewerSeat, snapshot) {
  const owner = seat === viewerSeat ? 'Deine Steine' : 'Steine des Gegners';
  const parts = [owner, String(snapshot.hands[seat]?.length ?? 0)];
  if (snapshot.hasMadeInitialMeld?.[seat]) parts.push('rausgekommen');
  return parts.join(' · ');
}

/** "Zug 12 von 40 · Stapel 38 · 14:32:05" */
function stepMeta(snapshot, lastIndex) {
  const where =
    snapshot.index === 0 ? 'Spielbeginn' : `Zug ${snapshot.index} von ${lastIndex}`;
  return [where, `Stapel ${snapshot.poolCount}`, formatTime(snapshot.at)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Renders the whole history screen for one moment of the game.
 *
 * @param {HistoryFrame} frame
 */
export function renderHistoryFrame(frame) {
  const { snapshot, previous, position, total, lastIndex, viewerSeat, perspective } = frame;
  const other = otherSeat(perspective);

  renderBoard(byId('history-board'), snapshot.board, {
    locked: true,
    highlightTileIds: freshTileIds(previous, snapshot),
  });

  renderRack(byId('history-bottom-rack'), sortByColor(snapshot.hands[perspective] ?? []), {
    locked: true,
  });
  byId('history-bottom-label').textContent = handLabel(perspective, viewerSeat, snapshot);

  const topRack = byId('history-top-rack');
  if (frame.revealOther) {
    renderRack(topRack, sortByColor(snapshot.hands[other] ?? []), { locked: true });
  } else {
    renderHiddenRack(topRack, snapshot.hands[other]?.length ?? 0);
  }
  byId('history-top-label').textContent = handLabel(other, viewerSeat, snapshot);

  const { title, detail } = describeSnapshot(snapshot, viewerSeat);
  byId('history-step-title').textContent = title;
  byId('history-step-detail').textContent = detail ?? '';
  byId('history-step-meta').textContent = stepMeta(snapshot, lastIndex);

  const slider = byId('history-slider');
  slider.max = String(Math.max(0, total - 1));
  slider.value = String(position);

  const atStart = position === 0;
  const atEnd = position >= total - 1;
  byId('history-first-btn').disabled = atStart;
  byId('history-prev-btn').disabled = atStart;
  byId('history-next-btn').disabled = atEnd;
  byId('history-last-btn').disabled = atEnd;
  byId('history-play-icon').textContent = frame.playing ? '⏸' : '▶';
  byId('history-play-label').textContent = frame.playing ? 'Pause' : 'Abspielen';

  const viewingMine = perspective === viewerSeat;
  byId('history-view-me').classList.toggle('segmented__btn--active', viewingMine);
  byId('history-view-opp').classList.toggle('segmented__btn--active', !viewingMine);
  byId('history-view-me').setAttribute('aria-pressed', String(viewingMine));
  byId('history-view-opp').setAttribute('aria-pressed', String(!viewingMine));

  highlightTurn(position);
}

/** Marks the current entry in the turn list and keeps it in view. */
function highlightTurn(position) {
  const list = byId('history-turn-list');
  for (const item of list.children) {
    item.classList.toggle(
      'history-turns__item--active',
      Number(item.dataset.position) === position,
    );
  }
  const details = list.closest('details');
  if (details?.open) {
    list.children[position]?.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Builds the clickable list of every recorded move.
 *
 * @param {import('../game/history.js').HistorySnapshot[]} snapshots
 * @param {string} viewerSeat
 * @param {(position: number) => void} onSelect
 */
export function renderTurnList(snapshots, viewerSeat, onSelect) {
  const list = byId('history-turn-list');
  clearElement(list);

  snapshots.forEach((snapshot, position) => {
    const { title } = describeSnapshot(snapshot, viewerSeat);
    const label = snapshot.index === 0 ? 'Start' : `#${snapshot.index}`;
    const button = createElement(
      'button',
      { class: 'history-turns__btn', attrs: { type: 'button' } },
      [
        createElement('span', { class: 'history-turns__index', text: label }),
        createElement('span', { class: 'history-turns__text', text: title }),
        createElement('span', { class: 'history-turns__time', text: formatTime(snapshot.at) }),
      ],
    );
    button.addEventListener('click', () => onSelect(position));
    list.append(
      createElement(
        'li',
        { class: 'history-turns__item', dataset: { position: String(position) } },
        [button],
      ),
    );
  });
}

/**
 * Shows a status message instead of the replay (loading, empty, error).
 *
 * @param {?string} text Message, or null to hide it and show the replay.
 */
export function renderHistoryMessage(text) {
  const message = byId('history-message');
  const hasMessage = Boolean(text);
  message.hidden = !hasMessage;
  message.textContent = text ?? '';
  byId('history-content').hidden = hasMessage;
  byId('history-controls').hidden = hasMessage;
  byId('history-toolbar').hidden = hasMessage;
  byId('history-turns').hidden = hasMessage;
}
