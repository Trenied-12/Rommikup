/**
 * @file dom.js
 * @description Minimal DOM helpers so the rest of the UI code stays declarative
 * and free of repetitive document.createElement boilerplate.
 */

/**
 * Creates an element with optional class names, attributes and children.
 *
 * @param {string} tag
 * @param {{ class?: string, text?: string, html?: string, attrs?: Object,
 *           dataset?: Object }} [options]
 * @param {(Node|string)[]} [children]
 * @returns {HTMLElement}
 */
export function createElement(tag, options = {}, children = []) {
  const element = document.createElement(tag);

  if (options.class) element.className = options.class;
  if (options.text != null) element.textContent = options.text;
  if (options.html != null) element.innerHTML = options.html;

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value != null) element.setAttribute(key, value);
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      if (value != null) element.dataset[key] = value;
    }
  }

  for (const child of children) {
    element.append(child);
  }
  return element;
}

/** Removes every child node from an element. */
export function clearElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/** Shorthand for document.getElementById with a helpful error if missing. */
export function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element #${id} nicht gefunden.`);
  return element;
}

/** Shows exactly one of the given screen elements, hiding the others. */
export function showOnly(screenToShow, allScreens) {
  for (const screen of allScreens) {
    screen.hidden = screen !== screenToShow;
  }
}
