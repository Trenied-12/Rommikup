/**
 * @file firebase-init.js
 * @description Initialises the Firebase app and exposes singleton handles to the
 * Auth and Firestore services. We load the SDK from Google's CDN as ES modules
 * so the project needs no bundler and deploys to GitHub Pages unchanged.
 *
 * Pin the SDK version here in one place so upgrades are a single-line change.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);

/** Shared Firebase Authentication instance. */
export const auth = getAuth(app);

/**
 * Shared Cloud Firestore instance.
 *
 * `experimentalAutoDetectLongPolling` lets the SDK fall back from WebSockets to
 * long-polling on networks/devices (mobile data, strict proxies, some tablets)
 * where the realtime stream would otherwise stall — this is the fix for "the
 * opponent's move only appears after a manual refresh".
 */
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
