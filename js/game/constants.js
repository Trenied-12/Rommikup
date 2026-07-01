/**
 * @file constants.js
 * @description Central place for every game-wide constant. No magic numbers are
 * allowed anywhere else in the codebase — if a number has meaning, it lives here.
 */

/** The four tile colours used by Rummikub number tiles. */
export const COLORS = Object.freeze({
  RED: 'red',
  BLUE: 'blue',
  YELLOW: 'yellow',
  BLACK: 'black',
});

/** Ordered list of the playable colours (used for grouping / iteration). */
export const COLOR_LIST = Object.freeze([
  COLORS.RED,
  COLORS.BLUE,
  COLORS.YELLOW,
  COLORS.BLACK,
]);

/** Lowest and highest number printed on a number tile. */
export const MIN_NUMBER = 1;
export const MAX_NUMBER = 13;

/** How many physical copies of every (colour, number) combination exist. */
export const COPIES_PER_TILE = 2;

/** Number of jokers in the box. */
export const JOKER_COUNT = 2;

/**
 * Total tiles in a full set.
 * 13 numbers * 4 colours * 2 copies + 2 jokers = 106.
 */
export const TOTAL_TILES =
  MAX_NUMBER * COLOR_LIST.length * COPIES_PER_TILE + JOKER_COUNT;

/** Tiles dealt to each player at the start of a game. */
export const STARTING_HAND_SIZE = 14;

/** Minimum point value a player must lay down on their very first meld(s). */
export const INITIAL_MELD_MIN_POINTS = 30;

/** Smallest number of tiles that can form a valid run or group. */
export const MIN_MELD_SIZE = 3;

/** Largest possible group: one tile of each colour. */
export const MAX_GROUP_SIZE = COLOR_LIST.length;

/** Distinguishes the two kinds of meld a player can build. */
export const MELD_TYPE = Object.freeze({
  RUN: 'run',
  GROUP: 'group',
});

/** A sentinel "number" used internally for jokers (they have no fixed value). */
export const JOKER_NUMBER = 0;

/**
 * Point value assigned to a joker when scoring a player's leftover rack at the
 * end of the game (standard Rummikub uses 30).
 */
export const JOKER_PENALTY_POINTS = 30;

/** The lifecycle states a game can be in. */
export const GAME_STATUS = Object.freeze({
  WAITING_FOR_OPPONENT: 'waiting',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished',
  ABANDONED: 'abandoned',
});

/** Identifies which of the two seats a player occupies. */
export const SEAT = Object.freeze({
  HOST: 'host',
  GUEST: 'guest',
});

/** Length of the human-friendly room code shown to players. */
export const ROOM_CODE_LENGTH = 5;

/**
 * Time limit for a single player's turn, in milliseconds (2 minutes). When it
 * runs out the active player's board edits are discarded and a tile is drawn
 * automatically.
 */
export const TURN_DURATION_MS = 2 * 60 * 1000;

/**
 * Lifecycle of the shared pause feature. A pause must be requested by one
 * player and accepted by the other; resuming requires both players' consent.
 */
export const PAUSE_STATE = Object.freeze({
  /** No pause and no open request. */
  IDLE: 'idle',
  /** One player asked for a pause; the opponent has not answered yet. */
  REQUESTED: 'requested',
  /** Both agreed — the clock is frozen and all interaction is blocked. */
  ACTIVE: 'active',
});
