/**
 * @file main.js
 * @description Application entry point. Handles first-time setup checks, signs
 * the player in, drives the lobby (create / join), supports invite links and
 * hands control to the GameController once a room is chosen.
 */

import { byId } from './ui/dom.js';
import { toast, toastError } from './ui/notifications.js';
import { isFirebaseConfigured } from './firebase/firebase-config.js';
import { ensureSignedIn } from './firebase/auth.js';
import { createGame, joinGameByCode } from './firebase/game-repository.js';
import { GameController } from './app/game-controller.js';
import { ROOM_CODE_LENGTH } from './game/constants.js';

/** Query-string key carrying a room code in an invite link. */
const ROOM_PARAM = 'room';

/** @type {?GameController} */
let controller = null;
let uid = null;

/** Shows only the lobby screen and resets transient UI. */
function showLobby() {
  byId('lobby-screen').hidden = false;
  byId('waiting-screen').hidden = true;
  byId('game-screen').hidden = true;
  byId('gameover-overlay').hidden = true;
  byId('lobby-message').textContent = '';
}

/** Reads a room code from the current URL, if present. */
function roomCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get(ROOM_PARAM);
  return code ? code.trim().toUpperCase() : null;
}

/** Reflects the active room in the URL so it can be copied/shared. */
function setUrlRoom(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set(ROOM_PARAM, roomCode);
  window.history.replaceState({}, '', url);
}

/** Clears the room from the URL when returning to the lobby. */
function clearUrlRoom() {
  const url = new URL(window.location.href);
  url.searchParams.delete(ROOM_PARAM);
  window.history.replaceState({}, '', url);
}

/** Lazily creates the single GameController instance. */
function getController() {
  if (!controller) {
    controller = new GameController({
      uid,
      onExit: () => {
        clearUrlRoom();
        showLobby();
      },
    });
  }
  return controller;
}

/** Enters a room: updates URL, wires the copy-link button, starts the game. */
function enterRoom(roomCode) {
  setUrlRoom(roomCode);
  byId('waiting-code').textContent = roomCode;
  getController().start(roomCode);
}

/** Handles the "create game" action. */
async function handleCreate() {
  byId('lobby-message').textContent = '';
  try {
    const { roomCode } = await createGame(uid);
    enterRoom(roomCode);
  } catch (error) {
    byId('lobby-message').textContent = error.message;
  }
}

/**
 * Handles a join attempt from the form or an invite link.
 *
 * @param {string} rawCode
 */
async function handleJoin(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) {
    byId('lobby-message').textContent = `Ein Raumcode hat ${ROOM_CODE_LENGTH} Zeichen.`;
    return;
  }

  byId('lobby-message').textContent = '';
  try {
    await joinGameByCode(code, uid);
    enterRoom(code);
  } catch (error) {
    byId('lobby-message').textContent = error.message;
  }
}

/** Copies an invite link for the current room to the clipboard. */
async function handleCopyLink() {
  const code = byId('waiting-code').textContent;
  const url = new URL(window.location.href);
  url.searchParams.set(ROOM_PARAM, code);
  try {
    await navigator.clipboard.writeText(url.toString());
    toast('Einladungslink kopiert.');
  } catch {
    // Clipboard may be blocked; show the link so it can be copied manually.
    toast(url.toString());
  }
}

/** Wires up the lobby and waiting-screen controls. */
function bindLobby() {
  byId('create-game-btn').addEventListener('click', handleCreate);
  byId('join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    handleJoin(byId('join-code-input').value);
  });
  byId('copy-link-btn').addEventListener('click', handleCopyLink);
}

/** Renders a fatal configuration error in place of the lobby. */
function showConfigError() {
  byId('lobby-screen').hidden = false;
  byId('lobby-message').innerHTML =
    'Firebase ist noch nicht konfiguriert. Trage deine Projektdaten in ' +
    '<code>js/firebase/firebase-config.js</code> ein (siehe README).';
  byId('create-game-btn').disabled = true;
  byId('join-form').querySelector('button').disabled = true;
}

/** Boots the application. */
async function bootstrap() {
  bindLobby();

  if (!isFirebaseConfigured()) {
    showConfigError();
    return;
  }

  try {
    uid = await ensureSignedIn();
  } catch (error) {
    showLobby();
    toastError(`Anmeldung fehlgeschlagen: ${error.message}`);
    return;
  }

  const invitedCode = roomCodeFromUrl();
  if (invitedCode) {
    // Arriving via an invite link: jump straight into joining.
    showLobby();
    byId('join-code-input').value = invitedCode;
    await handleJoin(invitedCode);
  } else {
    showLobby();
  }
}

bootstrap();
