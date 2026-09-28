/**
 * @file main.js
 * @description Application entry point. Handles first-time setup checks, signs
 * the player in, drives the lobby (create / join / "Meine letzten Spiele"),
 * supports invite and history links, and hands control to the game or the
 * history screen. Also announces newly deployed versions of the app.
 */

import { byId, showScreen } from './ui/dom.js';
import { toast, toastError } from './ui/notifications.js';
import { isFirebaseConfigured } from './firebase/firebase-config.js';
import { ensureSignedIn } from './firebase/auth.js';
import { createGame, joinGameByCode } from './firebase/game-repository.js';
import { GameController } from './app/game-controller.js';
import { HistoryController } from './app/history-controller.js';
import { RecentGamesController } from './app/recent-games-controller.js';
import { ROOM_CODE_LENGTH } from './game/constants.js';
import { getDeviceId } from './utils/device.js';
import { watchForUpdates } from './utils/version.js';

/** Query-string key carrying a room code in an invite link. */
const ROOM_PARAM = 'room';

/** Query-string key carrying the room whose history is open. */
const HISTORY_PARAM = 'history';

/** @type {?GameController} */
let gameController = null;
/** @type {?HistoryController} */
let historyController = null;
/** @type {?RecentGamesController} */
let recentGames = null;
let uid = null;
let deviceId = null;

/** Shows the lobby, resets transient UI and refreshes the game list. */
function showLobby() {
  showScreen('lobby-screen');
  byId('gameover-overlay').hidden = true;
  byId('pause-overlay').hidden = true;
  byId('lobby-message').textContent = '';
  recentGames?.refresh();
}

/** Upper-cases and trims a room code from user input or the URL. */
function normalizeCode(raw) {
  return raw ? raw.trim().toUpperCase() : null;
}

/**
 * Reflects the current view in the URL (so it survives a reload and can be
 * shared) — at most one of `room` / `history` is set at a time.
 *
 * @param {Object<string, string>} [params]
 */
function updateUrl(params = {}) {
  const url = new URL(window.location.href);
  url.searchParams.delete(ROOM_PARAM);
  url.searchParams.delete(HISTORY_PARAM);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  window.history.replaceState({}, '', url);
}

/** Lazily creates the single GameController instance. */
function getGameController() {
  if (!gameController) {
    gameController = new GameController({
      uid,
      deviceId,
      onExit: () => {
        updateUrl();
        showLobby();
      },
      onShowHistory: (roomCode, seat) => openHistory(roomCode, seat),
    });
  }
  return gameController;
}

/** Enters a room: updates the URL and starts observing the game. */
function enterRoom(roomCode) {
  updateUrl({ [ROOM_PARAM]: roomCode });
  byId('waiting-code').textContent = roomCode;
  getGameController().start(roomCode);
}

/**
 * Opens the history ("Spielverlauf") of a game.
 *
 * @param {string} roomCode
 * @param {?string} [seat] The viewer's seat, if already known.
 */
function openHistory(roomCode, seat = null) {
  updateUrl({ [HISTORY_PARAM]: roomCode });
  historyController.open(roomCode, { seat });
}

/** Handles the "create game" action. */
async function handleCreate() {
  byId('lobby-message').textContent = '';
  try {
    const { roomCode } = await createGame(uid, deviceId);
    enterRoom(roomCode);
  } catch (error) {
    byId('lobby-message').textContent = error.message;
  }
}

/**
 * Handles a join attempt from the form, an invite link or "Fortsetzen".
 *
 * @param {string} rawCode
 */
async function handleJoin(rawCode) {
  const code = normalizeCode(rawCode) ?? '';
  if (code.length !== ROOM_CODE_LENGTH) {
    byId('lobby-message').textContent = `Ein Raumcode hat ${ROOM_CODE_LENGTH} Zeichen.`;
    return;
  }

  byId('lobby-message').textContent = '';
  try {
    await joinGameByCode(code, uid, deviceId);
    enterRoom(code);
  } catch (error) {
    byId('lobby-message').textContent = error.message;
  }
}

/** Leaves the waiting room; the game stays open and can be resumed later. */
function leaveWaitingRoom() {
  gameController?.stop();
  updateUrl();
  showLobby();
}

/** Copies an invite link for the current room to the clipboard. */
async function handleCopyLink() {
  const code = byId('waiting-code').textContent;
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set(ROOM_PARAM, code);
  try {
    await navigator.clipboard.writeText(url.toString());
    toast('Einladungslink kopiert.');
  } catch {
    // Clipboard may be blocked; show the link so it can be copied manually.
    toast(url.toString());
  }
}

/** Wires up the lobby, waiting-room and update-banner controls. */
function bindLobby() {
  byId('create-game-btn').addEventListener('click', handleCreate);
  byId('join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    handleJoin(byId('join-code-input').value);
  });
  byId('copy-link-btn').addEventListener('click', handleCopyLink);
  byId('leave-waiting-btn').addEventListener('click', leaveWaitingRoom);
  byId('update-reload-btn').addEventListener('click', () => window.location.reload());
}

/** Renders a fatal configuration error in place of the lobby. */
function showConfigError() {
  showScreen('lobby-screen');
  byId('recent-section').hidden = true;
  byId('lobby-message').innerHTML =
    'Firebase ist noch nicht konfiguriert. Trage deine Projektdaten in ' +
    '<code>js/firebase/firebase-config.js</code> ein (siehe README).';
  byId('create-game-btn').disabled = true;
  byId('join-form').querySelector('button').disabled = true;
}

/** Boots the application. */
async function bootstrap() {
  bindLobby();
  watchForUpdates(() => {
    byId('update-banner').hidden = false;
  });

  if (!isFirebaseConfigured()) {
    showConfigError();
    return;
  }

  deviceId = getDeviceId();

  try {
    uid = await ensureSignedIn();
  } catch (error) {
    showScreen('lobby-screen');
    toastError(`Anmeldung fehlgeschlagen: ${error.message}`);
    return;
  }

  historyController = new HistoryController({
    uid,
    onClose: () => {
      updateUrl();
      showLobby();
    },
  });
  recentGames = new RecentGamesController({
    uid,
    deviceId,
    onViewHistory: (roomCode, seat) => openHistory(roomCode, seat),
    onResume: (roomCode) => handleJoin(roomCode),
  });

  const params = new URLSearchParams(window.location.search);
  const historyCode = normalizeCode(params.get(HISTORY_PARAM));
  const invitedCode = normalizeCode(params.get(ROOM_PARAM));

  if (historyCode) {
    openHistory(historyCode);
    return;
  }

  showLobby();
  if (invitedCode) {
    // Arriving via an invite link (or a reload inside a game): rejoin directly.
    byId('join-code-input').value = invitedCode;
    await handleJoin(invitedCode);
  }
}

bootstrap();
