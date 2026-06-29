/**
 * @file notifications.js
 * @description Lightweight toast notifications. Stateless and self-contained:
 * call toast()/toastError()/toastSuccess() from anywhere.
 */

import { byId, createElement } from './dom.js';

/** How long a toast stays on screen, in milliseconds. */
const TOAST_LIFETIME_MS = 3200;

/**
 * Shows a transient message.
 *
 * @param {string} message
 * @param {'info'|'error'|'success'} [variant='info']
 */
export function toast(message, variant = 'info') {
  const container = byId('toast-container');
  const node = createElement('div', {
    class: `toast toast--${variant}`,
    text: message,
  });

  container.append(node);

  setTimeout(() => {
    node.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, TOAST_LIFETIME_MS);
}

export const toastError = (message) => toast(message, 'error');
export const toastSuccess = (message) => toast(message, 'success');
