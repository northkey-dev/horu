import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initTheme } from './lib/theme.ts';
import './styles.css';

initTheme();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Plain http over Wi-Fi: no service worker, the app still works online.
  });
}

// An installed PWA stays suspended in memory for days. When it comes back to the foreground, reload it if a newer
// build is out (the hashed script name in index.html changes with every build).
if (import.meta.env.PROD) {
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/"]')?.getAttribute('src');
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !current) return;
    try {
      const html = await (await fetch('./', { cache: 'no-store' })).text();
      const latest = /src="([^"]*assets\/[^"]+\.js)"/.exec(html)?.[1];
      if (latest && latest !== current) location.reload();
    } catch {
      // offline: keep what is on screen
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
