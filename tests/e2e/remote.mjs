// Run: node remote.mjs (needs puppeteer-core, ffmpeg and Chrome on Windows; npm run build first). Opens a visible
// Chrome window and presses a keyboard shortcut in it, so leave the keyboard alone for a minute.
// Real Chrome + the real extension + a fake anime site + a fake Jimaku + the real Horu service:
// remote start (the service presses Alt+Shift+H), recognition of show and episode, next episode, Back Tap mark.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = process.env.HORU_ROOT ?? path.resolve(import.meta.dirname, '../..');
const EXT = `${root}/extension/dist`;
const EXT_ID = 'mndgnojkakdnnkkjenpokckpjbpgdjpg';
const HORU = 7388, JIMAKU = 7387, SITE = 7386;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'horu-remote-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + extra}`);
  if (!ok) failed++;
};

// 50 seconds of tone: the extension only follows videos longer than 30 s.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=50', '-ar', '44100', path.join(tmp, 'tone.wav')]);

const SRT = ['1', '00:00:01,000 --> 00:00:03,000', 'こんにちは', '', '2', '00:00:04,000 --> 00:00:06,000', 'さようなら', ''].join('\n');
const jimaku = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/entries/search') {
    const q = (u.searchParams.get('query') ?? '').toLowerCase();
    const hit = q.includes('frieren') ? [{ id: 11, name: 'Sousou no Frieren', english_name: "Frieren: Beyond Journey's End", anilist_id: 154587 }] : [];
    return void res.setHeader('Content-Type', 'application/json').end(JSON.stringify(hit));
  }
  if (/^\/entries\/\d+\/files$/.test(u.pathname)) {
    return void res.setHeader('Content-Type', 'application/json').end(JSON.stringify([{ name: 'ep.srt', url: `http://127.0.0.1:${JIMAKU}/f.srt`, size: 10 }]));
  }
  res.end(SRT);
});
await new Promise((r) => jimaku.listen(JIMAKU, '127.0.0.1', r));

const page = (title, h1, next) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:sans-serif"><h1>${h1}</h1>
<video src="/tone.wav" autoplay loop controls style="width:640px;height:360px;background:#222"></video>
${next ? `<p><a id="next" href="${next}">Next episode</a></p>` : ''}</body>`;
const site = http.createServer((req, res) => {
  if (req.url === '/tone.wav') return void fs.createReadStream(path.join(tmp, 'tone.wav')).pipe(res.setHeader('Content-Type', 'audio/wav'));
  if (req.url.startsWith('/watch/frieren-beyond-journeys-end-episode-7'))
    return void res.setHeader('Content-Type', 'text/html').end(page("Watch Frieren Beyond Journey's End Episode 7 English Subbed - FakeSite", "Frieren Beyond Journey's End", '/watch/frieren-beyond-journeys-end-episode-8'));
  if (req.url.startsWith('/watch/frieren-beyond-journeys-end-episode-8'))
    return void res.setHeader('Content-Type', 'text/html').end(page("FakeSite | Frieren Beyond Journey's End - EP 8", "Frieren Beyond Journey's End"));
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => site.listen(SITE, '127.0.0.1', r));

const server = spawn(process.execPath, ['server/src/main.ts'], {
  cwd: root,
  env: { ...process.env, HORU_PORT: String(HORU), HORU_DATA: path.join(tmp, 'data'), HORU_JIMAKU_URL: `http://127.0.0.1:${JIMAKU}`, HORU_APP_URL: '', HORU_ANKI_URL: 'http://127.0.0.1:9' },
  stdio: 'ignore',
});
const api = (m, p, body) =>
  fetch(`http://127.0.0.1:${HORU}${p}`, { method: m, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
    const t = await r.text();
    try {
      return { status: r.status, json: JSON.parse(t) };
    } catch {
      return { status: r.status, json: t };
    }
  });
for (let i = 0; i < 60; i++) {
  try {
    await api('GET', '/api/status');
    break;
  } catch {
    await wait(500);
  }
}
await api('PUT', '/api/settings', { jimakuApiKey: 'test' });

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: path.join(tmp, 'chrome'),
    headless: false,
    pipe: true,
    enableExtensions: [EXT],
    args: [`--allowlisted-extension-id=${EXT_ID}`, '--autoplay-policy=no-user-gesture-required', '--window-size=1100,800', '--no-first-run'],
  });
  const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(EXT_ID), { timeout: 20000 })).worker();
  await worker.evaluate((url) => chrome.storage.local.set({ server: url }), `http://127.0.0.1:${HORU}`);

  const tab = await browser.newPage();
  await tab.goto(`http://127.0.0.1:${SITE}/watch/frieren-beyond-journeys-end-episode-7`, { waitUntil: 'load' });
  await tab.bringToFront();
  await wait(1500);

  // Nothing is recording and nothing runs: a Back Tap does nothing.
  check('before: Back Tap refused', (await api('POST', '/api/mark/remote')).status === 409);

  // Remote start: the service presses Alt+Shift+H in the front Chrome window.
  const t0 = Date.now();
  const start = (await api('POST', '/api/recording/start')).json;
  console.log(`remote start answered after ${Date.now() - t0} ms:`, JSON.stringify(start));
  check('remote start: recording', start.recording === true && !start.error, JSON.stringify(start));
  check('remote start: the service sees the extension recording', (await api('GET', '/api/status')).json.extensionRecording === true);
  check('remote start twice does nothing wrong', (await api('POST', '/api/recording/start')).json.recording === true);

  // Recognition: the extension reads the page and the service starts the episode.
  let status;
  for (let i = 0; i < 40; i++) {
    status = (await api('GET', '/api/status')).json;
    if (status.session) break;
    await wait(500);
  }
  const s = status.session;
  console.log('session after start:', JSON.stringify(s && { title: s.title, episode: s.episode, detected: s.detected, auto: s.auto, cues: s.cueCount }));
  check('recognised the show', s?.title === "Frieren: Beyond Journey's End", JSON.stringify(s));
  check('recognised episode 7', s?.episode === 7, JSON.stringify(s));
  check('matched on Jimaku with subtitles', s?.detected === 'matched' && s?.cueCount === 2, JSON.stringify(s));

  // A chat or news tab in the background keeps changing its title: it must not hold up the recorded tab.
  const noisy = await browser.newPage();
  await noisy.goto(`http://127.0.0.1:${SITE}/watch/frieren-beyond-journeys-end-episode-8`, { waitUntil: 'load' });
  await noisy.evaluate(() => setInterval(() => (document.title = `(${Date.now()}) news`), 300));
  await tab.bringToFront();

  // Next episode on a differently written title: the session follows.
  await tab.click('#next');
  let next;
  for (let i = 0; i < 40; i++) {
    next = (await api('GET', '/api/status')).json.session;
    if (next?.episode === 8) break;
    await wait(500);
  }
  check('next episode recognised (other title format)', next?.episode === 8 && next?.title === "Frieren: Beyond Journey's End", JSON.stringify(next));
  check('still recording across the page change', (await api('GET', '/api/status')).json.extensionRecording === true);

  // Back Tap while recording: marked on the laptop.
  await wait(4000);
  const mark = await api('POST', '/api/mark/remote');
  check('Back Tap while recording marks', mark.status === 200 && /Marked/.test(String(mark.json)), JSON.stringify(mark));
  await wait(1500);
  const inbox = (await api('GET', '/api/inbox')).json;
  check('the mark is in the inbox with the episode', Array.isArray(inbox) && inbox.length === 1 && inbox[0].episode === 8, JSON.stringify(inbox).slice(0, 200));

  // Remote stop.
  const stop = (await api('POST', '/api/recording/stop')).json;
  check('remote stop', stop.recording === false && !stop.error, JSON.stringify(stop));
  await wait(500);
  check('after stop: Back Tap refused again', (await api('POST', '/api/mark/remote')).status === 409);
} catch (e) {
  failed++;
  console.log('ERROR', e.stack ?? e.message);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  jimaku.close();
  site.close();
  await wait(800);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // chrome may hold files for a moment
  }
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
