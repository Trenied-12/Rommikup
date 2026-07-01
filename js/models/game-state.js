/**
 * @file game-state.js
 * @description The canonical, serialisable game-state object plus small pure
 * accessors. This object is exactly what is stored in a Firestore document, so
 * it must contain only JSON-friendly values (no class instances, no undefined).
 *
 * @typedef {import('../game/validation.js').Meld} Meld
 * @typedef {import('./tile.js').Tile} Tile
 *
 * @typedef {Object} GameState
 * @property {string} roomCode
 * @property {string} status                       One of GAME_STATUS.
 * @property {string} hostId                        Auth uid of the host.
 * @property {?string} guestId                      Auth uid of the guest.
 * @property {string} currentTurn                   One of SEAT.
 * @property {Meld[]} board                         Shared, public melds.
 * @property {Tile[]} pool                          Face-down draw pile.
 * @property {{ host: Tile[], guest: Tile[] }} hands
 * @property {{ host: boolean, guest: boolean }} hasMadeInitialMeld
 * @property {?string} winner                       One of SEAT, or null.
 * @property {number} turnNumber
 * @property {number} turnStartedAt                 Epoch millis the current turn began.
 * @property {number} consecutivePasses             Passes in a row on an empty pool.
 * @property {?string} lastAction                   Short note for the opponent.
 * @property {{ host: ?LastMove, guest: ?LastMove }} lastMoves  Most recent move per seat.
 * @property {{ host: ?string, guest: ?string }} devices  Stable device id per seat.
 * @property {?LivePreview} livePreview             The active player's in-progress board.
 * @property {Pause} pause                          Shared pause state.
 * @property {number} createdAt                     Epoch millis.
 * @property {number} updatedAt                     Epoch millis.
 *
 * @typedef {Object} LastMove
 * @property {'draw'|'meld'|'pass'} type  Drew a tile, played tiles, or passed (empty pool).
 * @property {number} tilesPlayed         How many tiles were laid down (0 for a draw/pass).
 *
 * @typedef {Object} LivePreview
 * @property {string} seat        Seat currently experimenting (one of SEAT).
 * @property {number} turnNumber  Turn the preview belongs to (stale ones are ignored).
 * @property {import('../game/validation.js').Meld[]} board  The in-progress board.
 *
 * @typedef {Object} Pause
 * @property {string} state                        One of PAUSE_STATE.
 * @property {?string} requestedBy                 Seat that asked for the pause.
 * @property {{ host: boolean, guest: boolean }} resumeVotes  Consent to resume.
 * @property {?number} pausedAt                    Epoch millis the pause began.
 */

import { GAME_STATUS, SEAT, PAUSE_STATE } from '../game/constants.js';
import { dealNewGame } from '../game/tile-factory.js';

/**
 * Builds the neutral pause record (no pause, no open request).
 *
 * @returns {Pause}
 */
export function createIdlePause() {
  return {
    state: PAUSE_STATE.IDLE,
    requestedBy: null,
    resumeVotes: { host: false, guest: false },
    pausedAt: null,
  };
}

/**
 * Builds a fresh game state with both hands already dealt. The game waits for a
 * guest before play begins.
 *
 * @param {{ roomCode: string, hostId: string, hostDeviceId?: ?string }} params
 * @returns {GameState}
 */
export function createInitialGameState({ roomCode, hostId, hostDeviceId = null }) {
  const { hostHand, guestHand, pool } = dealNewGame();
  const now = Date.now();

  return {
    roomCode,
    status: GAME_STATUS.WAITING_FOR_OPPONENT,
    hostId,
    guestId: null,
    currentTurn: SEAT.HOST,
    board: [],
    pool,
    hands: { host: hostHand, guest: guestHand },
    hasMadeInitialMeld: { host: false, guest: false },
    winner: null,
    turnNumber: 1,
    turnStartedAt: now,
    consecutivePasses: 0,
    lastAction: null,
    lastMoves: { host: null, guest: null },
    devices: { host: hostDeviceId, guest: null },
    livePreview: null,
    pause: createIdlePause(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The seat opposite the one given.
 *
 * @param {string} seat One of SEAT.
 * @returns {string}
 */
export function otherSeat(seat) {
  return seat === SEAT.HOST ? SEAT.GUEST : SEAT.HOST;
}

/**
 * Resolves which seat a given auth uid occupies, or null if they are a
 * spectator / not part of the game.
 *
 * @param {GameState} state
 * @param {string} uid
 * @returns {?string} One of SEAT or null.
 */
export function seatForUid(state, uid) {
  if (state.hostId === uid) return SEAT.HOST;
  if (state.guestId === uid) return SEAT.GUEST;
  return null;
}

/**
 * Returns the hand belonging to a seat.
 *
 * @param {GameState} state
 * @param {string} seat
 * @returns {Tile[]}
 */
export function handOf(state, seat) {
  return state.hands[seat];
}
