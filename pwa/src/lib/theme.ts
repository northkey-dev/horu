// Appearance: dark, light, or follow the phone. Also tints the browser chrome to match the background.

export type ThemePref = 'system' | 'dark' | 'light';

const KEY = 'horu-theme';
const light = matchMedia('(prefers-color-scheme: light)');

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref) {
  const theme = pref === 'system' ? (light.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4efe6' : '#151311');
}

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // private mode
  }
  applyTheme(pref);
}

export function initTheme() {
  applyTheme(readTheme());
  light.addEventListener('change', () => readTheme() === 'system' && applyTheme('system'));
}
