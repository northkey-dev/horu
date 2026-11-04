import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { zipSync } from 'fflate';
import { ACCESS_TOKEN, PORT, PWA_DIST, ROOT_DIR, VERSION, getSettings } from './config.ts';
import { crossOrigin, hasToken, isTrustedNetwork, localOrToken, requireAccess } from './auth.ts';
import { attachExtension } from './extensionHub.ts';
import { ensureDictionary, lookupIndex } from './dict.ts';
import { ensureKanjidic } from './kanji.ts';
import { tokenizer } from './japanese.ts';
import { apiRouter, dictRouter, pairPage } from './routes.ts';
import { mangaRouter, startMangaWorker } from './manga/routes.ts';
import { insightsRouter } from './insights.ts';
import { analyticsRouter, snapshotVocab } from './analytics.ts';
import { backupRouter, startBackups } from './backup.ts';
import { pushRouter, startReminders } from './reminder.ts';
import { screenRouter } from './screen.ts';
import { textRouter } from './text.ts';
import { hookRouter } from './hook.ts';
import { startListSync } from './lists.ts';
import { log } from './log.ts';
import { flush, purgeOldMedia } from './store.ts';
import { refreshFromAnki, refreshServices } from './knownWords.ts';

const app = express();
app.disable('x-powered-by');

app.use(crossOrigin);
app.get('/pair', localOrToken, pairPage);

// The Chrome extension as a zip, for Horu in a container (no checkout to load it from).
app.get('/extension.zip', requireAccess, (_req, res) => {
  const dist = path.join(ROOT_DIR, 'extension', 'dist');
  if (!fs.existsSync(dist)) return void res.status(404).type('text').send('The extension is not built here (npm run build -w extension).');
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      else files[`${prefix}${e.name}`] = fs.readFileSync(path.join(dir, e.name));
    }
  };
  walk(dist, '');
  res.type('application/zip').setHeader('Content-Disposition', 'attachment; filename="horu-extension.zip"').send(Buffer.from(zipSync(files)));
});
app.use(requireAccess);
app.use('/api', apiRouter());
app.use('/api/manga', mangaRouter());
app.use('/api/insights', insightsRouter());
app.use('/api/analytics', analyticsRouter());
app.use('/api/screen', screenRouter());
app.use('/api/text', textRouter());
app.use('/api/hook', hookRouter());
app.use('/api/push', pushRouter());
app.use('/api/backup', backupRouter());
app.use('/dict', dictRouter());

// A phone on the home Wi-Fi (no Tailscale) opens the app from this laptop with the access token once. The home
// screen app has its own cookies on iOS, so its start address carries the token.
app.get('/manifest.webmanifest', (req, res, next) => {
  if (isTrustedNetwork(req)) return next();
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(PWA_DIST, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
    res.type('application/manifest+json').setHeader('Cache-Control', 'no-cache').send(JSON.stringify({ ...manifest, start_url: `./?t=${ACCESS_TOKEN}` }));
  } catch {
    next();
  }
});

// The PWA (built by `npm run build`). Hashed assets are cached forever, index.html never.
app.use(
  express.static(PWA_DIST, {
    setHeaders: (res, file) => {
      if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);
app.get('*', (_req, res) => {
  const index = path.join(PWA_DIST, 'index.html');
  if (fs.existsSync(index)) res.setHeader('Cache-Control', 'no-cache').sendFile(index);
  else res.status(503).type('text').send('PWA not built yet: run `npm run build`.');
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const ip = req.socket.remoteAddress ?? '';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const url = new URL(req.url ?? '/', 'http://horu');
  // The extension on this computer, or from another one (Horu on a Raspberry Pi) with the access token.
  if (url.pathname !== '/ws/ext' || !(local || hasToken({ headers: req.headers, query: Object.fromEntries(url.searchParams) }))) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => attachExtension(ws));
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.info(`Port ${PORT} in use – Horu is already running.`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  log.info(`Horu ${VERSION} listening on http://localhost:${PORT}`);
  void tokenizer();
  void ensureDictionary().then(() => lookupIndex()); // warm the laptop-side lookup the phone falls back on
  ensureKanjidic();
  const purge = () => {
    const n = purgeOldMedia(getSettings().keepDays);
    if (n) log.info(`Freed media of ${n} old moments`);
  };
  purge();
  setInterval(purge, 6 * 3_600_000).unref();
  // Vocabulary growth needs a data point per day even when Insights is never opened.
  const snapshot = () => void refreshFromAnki().catch(() => 0).then(() => refreshServices().catch((e: Error) => log.warn('Known-word services:', e.message))).then(snapshotVocab).catch((e) => log.warn('Vocab snapshot:', (e as Error).message));
  setTimeout(snapshot, 20_000).unref();
  setInterval(snapshot, 3 * 3_600_000).unref();
  startReminders();
  startBackups();
  startListSync();
  startMangaWorker();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    flush();
    process.exit(0);
  });
}
process.on('uncaughtException', (err) => log.error('Uncaught', err));
process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err));
