// Light/dark theme: persisted in localStorage, defaulting to the OS/browser
// preference (prefers-color-scheme) on first visit.
var STORAGE_KEY = 'm510e-connector-theme';

export function getStoredTheme() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return null; // localStorage can throw in some restricted/embedded browsers
  }
}

export function getPreferredTheme() {
  var stored = getStoredTheme();
  if (stored === 'light' || stored === 'dark') return stored;
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch (err) {
    // ignore — theme just won't persist across reloads on this browser
  }
}
