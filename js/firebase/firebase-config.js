/**
 * @file firebase-config.js
 * @description Your Firebase project's web configuration.
 *
 * HOW TO FILL THIS IN
 * -------------------
 * 1. Create a project at https://console.firebase.google.com
 * 2. Add a Web App (</>) to the project and copy the generated config object.
 * 3. Paste the values below.
 * 4. In the console enable: Authentication → Sign-in method → Anonymous,
 *    and Firestore Database → Create database.
 * 5. Publish the security rules from `firestore.rules` (see README).
 *
 * These values are NOT secrets — Firebase web config is meant to ship to the
 * browser. Access is protected by Firestore security rules, not by hiding keys.
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyAC7p6t-OaIhVCuRe227NSzQriFKYJgfkY',
  authDomain: 'rommikub-8c2bd.firebaseapp.com',
  projectId: 'rommikub-8c2bd',
  storageBucket: 'rommikub-8c2bd.firebasestorage.app',
  messagingSenderId: '193057369766',
  appId: '1:193057369766:web:d4910229cd97fed85b0e67',
};

/**
 * Returns true once the placeholder values above have been replaced, so the UI
 * can show a friendly "configure Firebase first" message instead of crashing.
 *
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return (
    !!firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith('YOUR_') &&
    !firebaseConfig.projectId.startsWith('YOUR_')
  );
}
