/**
 * @file auth.js
 * @description Thin wrapper around Firebase Authentication. The game only needs
 * to tell two anonymous players apart, so anonymous sign-in is sufficient and
 * requires no login UI.
 */

import {
  signInAnonymously,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import { auth } from './firebase-init.js';

/**
 * Ensures the current visitor is signed in (anonymously) and resolves with
 * their stable auth uid. Safe to call repeatedly — Firebase reuses the session.
 *
 * @returns {Promise<string>} The authenticated user's uid.
 */
export function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        unsubscribe();
        if (user) {
          resolve(user.uid);
          return;
        }
        try {
          const credential = await signInAnonymously(auth);
          resolve(credential.user.uid);
        } catch (error) {
          reject(error);
        }
      },
      reject,
    );
  });
}

/**
 * The uid of the currently signed-in user, or null if not signed in yet.
 *
 * @returns {?string}
 */
export function currentUid() {
  return auth.currentUser?.uid ?? null;
}
