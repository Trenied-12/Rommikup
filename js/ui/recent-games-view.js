/**
 * @file recent-games-view.js
 * @description Renders the "Meine letzten Spiele" list in the lobby: one card
 * per game with date, result badge, a short preview line (turns, duration,
 * remaining points) and the fitting actions (view history / resume / remove).
 * Pure view code — data loading lives in the RecentGamesController.
 */

import { createElement, clearElement } from './dom.js';
import { resultBadge } from './result-badge.js';
import { formatDateTime, formatDuration } from '../utils/format.js';
import { GAME_STATUS, GAME_RESULT } from '../game/constants.js';

/** The most meaningful timestamp of a game for display. */
function displayDate(summary) {
  return summary.finishedAt ?? summary.startedAt ?? summary.createdAt;
}

/**
 * Joins preview parts; spaces inside a part become non-breaking, so a line only
 * ever wraps between parts (never inside "Restpunkte 0 : 23").
 */
function joinParts(parts) {
  return parts.map((part) => part.replace(/ /g, ' ')).join(' · ');
}

/** "24 Züge · 18 Min · Restpunkte 0 : 23" style preview line. */
function previewLine(summary) {
  const parts = [`Raum ${summary.roomCode}`];

  if (summary.status === GAME_STATUS.WAITING_FOR_OPPONENT) {
    parts.push('Wartet auf Gegner');
    return joinParts(parts);
  }

  parts.push(`${summary.turns} ${summary.turns === 1 ? 'Zug' : 'Züge'}`);

  if (summary.status === GAME_STATUS.FINISHED) {
    if (summary.startedAt && summary.finishedAt) {
      parts.push(formatDuration(summary.finishedAt - summary.startedAt));
    }
    if (summary.myPenalty != null && summary.opponentPenalty != null) {
      parts.push(`Restpunkte ${summary.myPenalty} : ${summary.opponentPenalty}`);
    }
  } else {
    parts.push(`Steine ${summary.myTilesLeft} : ${summary.opponentTilesLeft}`);
  }
  return joinParts(parts);
}

/** Builds one list entry. */
function renderEntry(summary, { onViewHistory, onResume, onRemove }) {
  const badge = resultBadge(summary);
  const finished = summary.status === GAME_STATUS.FINISHED;

  const actions = createElement('div', { class: 'recent-item__actions' });
  if (finished) {
    const viewBtn = createElement('button', {
      class: 'btn btn--small btn--secondary',
      text: 'Verlauf',
      attrs: { type: 'button', title: 'Spielverlauf ansehen' },
    });
    viewBtn.addEventListener('click', () => onViewHistory(summary));
    actions.append(viewBtn);
  } else {
    const resumeBtn = createElement('button', {
      class: 'btn btn--small btn--primary',
      text: 'Fortsetzen',
      attrs: { type: 'button', title: 'Zurück in dieses Spiel' },
    });
    resumeBtn.addEventListener('click', () => onResume(summary));
    actions.append(resumeBtn);
  }

  const removeBtn = createElement('button', {
    class: 'btn btn--small btn--ghost recent-item__remove',
    text: '✕',
    attrs: {
      type: 'button',
      title: 'Aus der Liste entfernen',
      'aria-label': `Spiel ${summary.roomCode} aus der Liste entfernen`,
    },
  });
  removeBtn.addEventListener('click', () => onRemove(summary));
  actions.append(removeBtn);

  return createElement(
    'li',
    { class: `recent-item recent-item--${badge.variant}` },
    [
      createElement('div', { class: 'recent-item__info' }, [
        createElement('div', { class: 'recent-item__top' }, [
          createElement('span', {
            class: `result-badge result-badge--${badge.variant}`,
            text: badge.label,
          }),
          createElement('span', {
            class: 'recent-item__date',
            text: formatDateTime(displayDate(summary)),
          }),
        ]),
        createElement('div', { class: 'recent-item__meta', text: previewLine(summary) }),
      ]),
      actions,
    ],
  );
}

/** "Siege 3 · Niederlagen 1 · Unentschieden 1" over the listed games. */
function tallyLine(summaries) {
  const count = (result) => summaries.filter((s) => s.result === result).length;
  const won = count(GAME_RESULT.WON);
  const lost = count(GAME_RESULT.LOST);
  const draws = count(GAME_RESULT.DRAW);
  if (won + lost + draws === 0) return '';
  const parts = [`Siege ${won}`, `Niederlagen ${lost}`];
  if (draws > 0) parts.push(`Unentschieden ${draws}`);
  return parts.join(' · ');
}

/**
 * Renders the list of recent games.
 *
 * @param {HTMLElement} listEl   The <ul> receiving the entries.
 * @param {HTMLElement} tallyEl  Small header text with the win/loss tally.
 * @param {import('../game/history.js').GameSummary[]} summaries
 * @param {{ onViewHistory: Function, onResume: Function, onRemove: Function }} handlers
 */
export function renderRecentGames(listEl, tallyEl, summaries, handlers) {
  clearElement(listEl);
  tallyEl.textContent = tallyLine(summaries);

  if (summaries.length === 0) {
    listEl.append(
      createElement('li', {
        class: 'recent__message',
        text: 'Noch keine Spiele in deinem Verlauf.',
      }),
    );
    return;
  }

  for (const summary of summaries) {
    listEl.append(renderEntry(summary, handlers));
  }
}

/**
 * Replaces the list with a single status line (loading / error).
 *
 * @param {HTMLElement} listEl
 * @param {HTMLElement} tallyEl
 * @param {string} text
 */
export function renderRecentGamesMessage(listEl, tallyEl, text) {
  clearElement(listEl);
  tallyEl.textContent = '';
  listEl.append(createElement('li', { class: 'recent__message', text }));
}
