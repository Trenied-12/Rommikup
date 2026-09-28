/**
 * @file version.js
 * @description Knows which build of the app is running and notices when a newer
 * one has been deployed.
 *
 * Background: GitHub Pages and (especially) Safari cache JavaScript modules
 * aggressively, so two devices could run different versions of the game. The
 * build step (`tools/build.mjs`) stamps a content hash into index.html — both
 * as `<meta name="app-version">` and as `?v=` on every script and stylesheet
 * (via an import map). Here we compare the running version with the deployed
 * one and ask the player to reload when they differ.
 */

/** Selector of the meta tag carrying the build version. */
const VERSION_META_SELECTOR = 'meta[name="app-version"]';

/** Extracts the version from raw index.html markup. */
const VERSION_META_PATTERN = /<meta\s+name="app-version"\s+content="([^"]*)"/i;

/** How often a long-running tab checks for a new deployment. */
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The version of the code running in this tab.
 *
 * @returns {string}
 */
export function getAppVersion() {
  return document.querySelector(VERSION_META_SELECTOR)?.content || 'dev';
}

/**
 * Fetches the currently deployed index.html (bypassing every cache) and reads
 * its version.
 *
 * @returns {Promise<?string>}
 */
async function fetchDeployedVersion() {
  const response = await fetch(window.location.pathname, { cache: 'no-store' });
  if (!response.ok) return null;
  const match = (await response.text()).match(VERSION_META_PATTERN);
  return match ? match[1] : null;
}

/**
 * Checks for a newer deployment now, whenever the tab becomes visible again and
 * periodically, calling `onUpdateAvailable` once when one is found.
 *
 * @param {(deployedVersion: string) => void} onUpdateAvailable
 */
export function watchForUpdates(onUpdateAvailable) {
  const running = getAppVersion();
  let notified = false;

  const check = async () => {
    if (notified) return;
    try {
      const deployed = await fetchDeployedVersion();
      if (deployed && deployed !== running) {
        notified = true;
        onUpdateAvailable(deployed);
      }
    } catch {
      // Offline or blocked — simply try again on the next occasion.
    }
  };

  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
