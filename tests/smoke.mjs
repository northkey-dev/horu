// Smoke test: starts a throwaway server on its own port and data folder (data-smoke, never your real data/)
// and checks the main API contracts. Anki, Whisper, Claude and the phone are not needed.
//   npm run smoke
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import { zipSync } from 'fflate';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data-smoke');
const PORT = 7399;
const base = `http://127.0.0.1:${PORT}`;

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(path.join(dataDir, 'dict'), { recursive: true });
// The dictionary is a 26 MB download otherwise; reuse the real one read-only.
for (const f of fs.existsSync(path.join(root, 'data', 'dict')) ? fs.readdirSync(path.join(root, 'data', 'dict')) : []) {
  fs.copyFileSync(path.join(root, 'data', 'dict', f), path.join(dataDir, 'dict', f));
}

// A stand-in for jimaku.cc so page recognition can be checked without the internet or a key.
const JIMAKU_PORT = 7398;
const SRT = ['1', '00:00:01,000 --> 00:00:03,000', 'こんにちは', '', '2', '00:00:04,000 --> 00:00:06,000', 'さようなら', ''].join('\n');
const entries = [
  { id: 11, name: 'Sousou no Frieren', english_name: "Frieren: Beyond Journey's End", japanese_name: '葬送のフリーレン', anilist_id: 154587 },
  { id: 12, name: 'Kimetsu no Yaiba', english_name: 'Demon Slayer', anilist_id: 101922 },
];
const jimaku = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/entries/search') {
    const q = (u.searchParams.get('query') ?? '').toLowerCase();
    const hit = entries.filter((e) => [e.name, e.english_name].some((n) => n.toLowerCase().split(/\W+/).some((w) => w.length > 2 && q.includes(w))));
    return void res.setHeader('Content-Type', 'application/json').end(JSON.stringify(hit));
  }
  if (/^\/entries\/\d+\/files$/.test(u.pathname)) {
    return void res.setHeader('Content-Type', 'application/json').end(JSON.stringify([{ name: `ep${u.searchParams.get('episode')}.srt`, url: `http://127.0.0.1:${JIMAKU_PORT}/file.srt`, size: SRT.length }]));
  }
  res.end(SRT);
});
await new Promise((r) => jimaku.listen(JIMAKU_PORT, '127.0.0.1', r));

// Anki stand-in: refuses like a closed Anki, or hangs like one that is syncing.
const ANKI_PORT = 7397;
let ankiHangs = false;
const anki = http.createServer((req) => {
  if (!ankiHangs) req.socket.destroy();
});
await new Promise((r) => anki.listen(ANKI_PORT, '127.0.0.1', r));

const server = spawn(process.execPath, [path.join(root, 'server', 'src', 'main.ts')], {
  env: { ...process.env, HORU_PORT: String(PORT), HORU_DATA: 'data-smoke', HORU_ANKI_URL: `http://127.0.0.1:${ANKI_PORT}`, HORU_JIMAKU_URL: `http://127.0.0.1:${JIMAKU_PORT}` },
  stdio: 'ignore',
});
const stop = async () => {
  const exited = new Promise((r) => server.once('exit', r));
  server.kill();
  jimaku.close();
  anki.closeAllConnections();
  anki.close();
  await exited; // it may still be writing, the dictionary download for example
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
};

const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
};

/** fetch() may not set the Host header, the security checks need it. */
const raw = (method, url, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: url, headers }, (res) => {
      let body = '';
      res.setEncoding('latin1').on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`);
  }
}

try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(base + '/api/status')).ok) break;
    } catch {
      // not up yet
    }
    if (i > 60) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 500));
  }

  await check('status', async () => {
    const { status, json } = await call('GET', '/api/status');
    assert.equal(status, 200);
    assert.ok(json.version);
  });

  await check('analytics: shape, empty history, no streak', async () => {
    const { status, json: a } = await call('GET', '/api/analytics');
    assert.equal(status, 200);
    assert.ok(a.days.length > 300);
    assert.equal(a.days.at(-1).day, a.today);
    assert.deepEqual(a.streak, { current: 0, best: 0, activeToday: false });
    assert.equal(a.totals.xp, 0);
    assert.ok(Array.isArray(a.vocab) && Array.isArray(a.horu.watched));
  });

  await check('settings: round trip, wrong types and unknown keys are ignored', async () => {
    await call('PUT', '/api/settings', { dailyGoalXp: 55, reminderTime: '08:30', prepWordCount: 'lots', nonsense: 1 });
    const { json: s } = await call('GET', '/api/settings');
    assert.equal(s.dailyGoalXp, 55);
    assert.equal(s.reminderTime, '08:30');
    assert.equal(s.prepWordCount, 12);
    assert.equal(s.nonsense, undefined);
  });

  await check('push: key is served, bad subscriptions and empty test are rejected', async () => {
    const info = await call('GET', '/api/push');
    assert.ok(info.json.key.length > 50);
    assert.equal(info.json.devices, 0);
    assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'x' } })).status, 400);
    assert.equal((await call('POST', '/api/push/test')).status, 400);
  });

  await check('backup: writes a day, lists it, refuses bad restore targets', async () => {
    const made = await call('POST', '/api/backup');
    assert.equal(made.status, 200);
    const list = await call('GET', '/api/backup');
    assert.equal(list.json.days.length, 1);
    assert.equal((await call('POST', '/api/backup/restore', { day: '../../etc' })).status, 400);
    assert.equal((await call('POST', '/api/backup/restore', { day: '1999-01-01' })).status, 400);
  });

  await check('previews: cards need a word', async () => {
    assert.equal((await call('POST', '/api/insights/preview-cards', { cards: [] })).status, 400);
  });

  await check('known words: check and mark', async () => {
    await call('POST', '/api/insights/known', { word: '猫', known: true });
    const { json } = await call('POST', '/api/insights/known/check', { words: ['猫', 'zzzz'] });
    assert.equal(json['猫'], true);
    assert.equal(json.zzzz, false);
  });

  await check('Back Tap marks count only while watching', async () => {
    const remote = () => call('POST', '/api/mark/remote');
    // Nothing runs: a knock in the pocket leaves nothing behind.
    assert.equal((await remote()).status, 409);
    assert.deepEqual((await call('POST', '/api/mark/remote/take')).json.marks, [], 'rejected tap was queued');
    // The phone starts an episode: the tap is kept (the take above already renewed it, so end it first).
    await call('POST', '/api/mark/remote/watching', { on: false });
    assert.equal((await remote()).status, 409);
    await call('POST', '/api/mark/remote/watching', { on: true });
    assert.equal((await remote()).status, 200);
    const taken = (await call('POST', '/api/mark/remote/take')).json.marks;
    assert.equal(taken.length, 1);
    // The episode ends: taps are refused again.
    await call('POST', '/api/mark/remote/watching', { on: false });
    assert.equal((await remote()).status, 409);
  });

  await check('page recognition: show and episode from the page texts', async () => {
    await call('PUT', '/api/settings', { jimakuApiKey: 'test' });
    const texts = (t) => [{ text: t, weight: 2 }, { text: 'frieren-beyond-journeys-end episode 7', weight: 1 }];
    const first = (await call('POST', '/api/sessions/detect', { texts: [{ text: "Watch Frieren Beyond Journey's End Episode 7 English Subbed - SiteName", weight: 2 }] })).json;
    assert.equal(first.status, 'started');
    assert.equal(first.session.episode, 7);
    assert.equal(first.session.title, "Frieren: Beyond Journey's End");
    assert.equal(first.session.detected, 'matched');
    assert.equal(first.session.jimakuEntryId, 11);
    assert.equal(first.session.cueCount, 2);
    assert.equal((await call('POST', '/api/sessions/detect', { texts: texts("SiteName | Frieren Beyond Journey's End Episode 7") })).json.status, 'same');
    const next = (await call('POST', '/api/sessions/detect', { texts: [{ text: "Frieren Beyond Journey's End Episode 8 - SiteName", weight: 2 }] })).json;
    assert.equal(next.status, 'started', 'next episode');
    assert.equal(next.session.episode, 8);
  });

  await check('page recognition: a show Jimaku does not know, and a page without episode', async () => {
    const unknown = (await call('POST', '/api/sessions/detect', { texts: [{ text: 'Totally Unknown Show Episode 3 - SiteName', weight: 2 }] })).json;
    assert.equal(unknown.status, 'started');
    assert.equal(unknown.session.detected, 'guess');
    assert.equal(unknown.session.title, 'Totally Unknown Show');
    assert.equal(unknown.session.episode, 3);
    assert.equal(unknown.session.cueCount, 0);
    // An overview page changes nothing: not the running episode, not the progress behind Continue.
    await call('POST', '/api/sessions/end');
    await call('POST', '/api/sessions/detect', { texts: [{ text: "Frieren Beyond Journey's End Episode 9 - SiteName", weight: 2 }] });
    const overview = (await call('POST', '/api/sessions/detect', { texts: [{ text: "Frieren Beyond Journey's End - SiteName", weight: 2 }] })).json;
    assert.equal(overview.status, 'none');
    assert.equal((await call('GET', '/api/status')).json.session.episode, 9);
    assert.equal((await call('GET', '/api/sessions/recent')).json.find((s) => s.jimakuEntryId === 11).nextEpisode, 10);
    await call('POST', '/api/sessions/end');
    assert.equal((await call('POST', '/api/sessions/detect', { texts: [{ text: 'Top 10 Anime Rankings of the Year - Blog', weight: 2 }] })).json.status, 'none');
    assert.equal((await call('GET', '/api/status')).json.session, undefined);
    assert.equal((await call('POST', '/api/sessions/detect', { texts: [{ text: 'Watch Online Free', weight: 2 }] })).json.status, 'none');
  });

  await check('page recognition: an episode chosen by hand is not replaced', async () => {
    await call('POST', '/api/sessions', { title: 'Chosen by hand', episode: 2 });
    const kept = (await call('POST', '/api/sessions/detect', { texts: [{ text: 'Demon Slayer Episode 5', weight: 2 }] })).json;
    assert.equal(kept.status, 'manual');
    assert.equal(kept.session.title, 'Chosen by hand');
    await call('POST', '/api/sessions/end');
    assert.equal((await call('POST', '/api/sessions/detect', { texts: [{ text: 'Demon Slayer Episode 5', weight: 2 }] })).json.status, 'started');
  });

  await check('page recognition: a session made from the page subtitles is renamed, its lines stay', async () => {
    await call('POST', '/api/sessions/end');
    const cues = [{ start: 1, end: 2, text: '日本語の字幕です' }, { start: 3, end: 4, text: 'もう一行あります' }];
    await call('POST', '/api/sessions/site-subs', { cues, live: false, page: "Frieren Beyond Journey's End Episode 9 - SiteName" });
    const renamed = (await call('POST', '/api/sessions/detect', { texts: [{ text: "Frieren Beyond Journey's End Episode 9 - SiteName", weight: 2 }] })).json;
    assert.equal(renamed.status, 'updated');
    assert.equal(renamed.session.episode, 9);
    assert.equal(renamed.session.cueCount, 2);
    assert.equal(renamed.session.title, "Frieren: Beyond Journey's End");
  });

  await check('page recognition: the page you moved on to has the last word', async () => {
    await call('POST', '/api/sessions/end');
    const detect = (n) => call('POST', '/api/sessions/detect', { texts: [{ text: `Demon Slayer Episode ${n}`, weight: 2 }] });
    await Promise.all([detect(3), detect(4)]);
    assert.equal((await call('GET', '/api/status')).json.session.episode, 4);
    await call('POST', '/api/sessions/end');
  });

  await check('status does not wait for a busy Anki', async () => {
    ankiHangs = true;
    await new Promise((r) => setTimeout(r, 5200)); // the check after this one runs into the hanging Anki
    for (let i = 0; i < 3; i++) {
      const started = Date.now();
      assert.equal((await call('GET', '/api/status')).status, 200);
      assert.ok(Date.now() - started < 1000, `status took ${Date.now() - started} ms`);
    }
    ankiHangs = false;
    anki.closeAllConnections();
  });

  await check('the extension can upload from another computer with the token', async () => {
    const own = Object.values(os.networkInterfaces()).flat().find((a) => a.family === 'IPv4' && !a.internal);
    if (!own) return; // no network on this machine
    const token = fs.readFileSync(path.join(dataDir, 'token.txt'), 'utf8').trim();
    const upload = (headers) => fetch(`http://${own.address}:${PORT}/api/ext/moments/abc/audio`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', ...headers }, body: 'RIFF' }).then((r) => r.status);
    assert.equal(await upload({}), 401);
    assert.equal(await upload({ 'X-Horu-Token': token }), 200);
  });

  await check('security: only own server names are answered (DNS rebinding)', async () => {
    for (const host of ['evil.example', 'evil.example:7399', 'localhost.evil.example', '127.0.0.1.evil.example', 'evil.ts.net.example']) {
      assert.equal((await raw('GET', '/api/settings', { Host: host })).status, 403, host);
    }
    for (const host of ['localhost', '127.0.0.1:7399', '[::1]:7399', '192.168.1.5:7399', '100.101.102.103', 'horu.tail1234.ts.net', 'horu-pi', 'horu-pi.local:7399', 'laptop.fritz.box']) {
      assert.equal((await raw('GET', '/api/status', { Host: host })).status, 200, host);
    }
  });

  await check('security: no key leaves the laptop through the settings', async () => {
    const keys = { aiApiKey: 'sk-very-long-secret-1234', wanikaniToken: 'wk-very-long-secret-5678', anilistToken: 'short', playerToken: 'user:pass' };
    await call('PUT', '/api/settings', keys);
    const { json: s } = await call('GET', '/api/settings');
    assert.equal(s.aiApiKey, '••••1234');
    assert.equal(s.wanikaniToken, '••••5678');
    assert.equal(s.anilistToken, '••••', 'a short key shows nothing of itself');
    assert.equal(s.playerToken, '••••');
    assert.ok(!JSON.stringify(s).includes('secret'));
    // Sending back what the app was shown changes nothing; a new key does.
    await call('PUT', '/api/settings', s);
    assert.equal((await call('GET', '/api/settings')).json.aiApiKey, '••••1234');
    await call('PUT', '/api/settings', { aiApiKey: 'sk-another-long-secret-9999' });
    assert.equal((await call('GET', '/api/settings')).json.aiApiKey, '••••9999');
    await call('PUT', '/api/settings', { aiApiKey: '', wanikaniToken: '', anilistToken: '', playerToken: '' });
    assert.equal((await call('GET', '/api/settings')).json.aiApiKey, '');
  });

  await check('security: websites cannot act, the app and the extension can', async () => {
    const post = (origin) => raw('POST', '/api/sessions/end', origin ? { Origin: origin } : {});
    assert.equal((await post('https://evil.example')).status, 403);
    assert.equal((await post('null')).status, 403, 'sandboxed iframe');
    assert.equal((await post('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).status, 403, 'another extension');
    assert.equal((await post('chrome-extension://mndgnojkakdnnkkjenpokckpjbpgdjpg')).status, 200);
    assert.equal((await post(`http://127.0.0.1:${PORT}`)).status, 200, 'the app served by this laptop');
    assert.equal((await post()).status, 200, 'a Shortcut sends no origin');
    assert.equal((await raw('GET', '/api/status', { Origin: 'null' })).status, 200);
  });

  await check('security: the extension socket is for the extension', async () => {
    const open = (origin) =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/ext`, origin ? { headers: { Origin: origin } } : {});
        ws.on('open', () => (ws.close(), resolve(true)));
        ws.on('error', () => resolve(false));
      });
    assert.equal(await open('https://evil.example'), false);
    assert.equal(await open(undefined), false);
    assert.equal(await open('chrome-extension://mndgnojkakdnnkkjenpokckpjbpgdjpg'), true);
  });

  await check('security: ids cannot leave the data folder', async () => {
    const outside = path.join(root, 'smoke-outside');
    fs.mkdirSync(path.join(outside, 'keep'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'private.jpg'), 'PRIVATE');
    fs.writeFileSync(path.join(outside, 'keep', 'file.txt'), 'keep');
    const up = '..%2F..%2Fsmoke-outside';
    try {
      for (const url of [`/api/moments/${up}%2Fprivate/image`, `/api/manga/files/${up}/private.jpg`, `/api/manga/thumb/${up}%2Fprivate`]) {
        const res = await raw('GET', url);
        assert.ok(res.status >= 400 && !res.body.includes('PRIVATE'), `${url} -> ${res.status}`);
      }
      const session = { id: '../../smoke-outside/written', title: 'x', createdAt: new Date().toISOString(), episode: 1, cueCount: 0 };
      assert.equal((await call('POST', '/api/sessions/import', { session, cues: [] })).status, 400);
      assert.equal(fs.existsSync(path.join(outside, 'written.json')), false);
      assert.equal((await call('POST', '/api/moments/import', { moment: { id: '../../smoke-outside/m', kind: 'text', candidates: [] }, audio: 'AAAA' })).status, 400);
      assert.equal(fs.existsSync(path.join(outside, 'm.wav')), false);
      // A manga has to exist for the chapter route to go on.
      const zip = zipSync({ 'a/001.jpg': new Uint8Array([255, 216, 255, 217]) });
      const manga = await fetch(`${base}/api/manga/import`, { method: 'POST', headers: { 'X-Filename': 'x.cbz', 'Content-Type': 'application/octet-stream' }, body: zip }).then((r) => r.json());
      const bad = `/api/manga/chapters/${up}%2Fkeep`;
      assert.equal((await call('POST', `${bad}/prepare`, { mangaKey: manga.key, name: 'x' })).status, 400);
      await call('POST', `${bad}/cancel`, {});
      assert.equal(fs.existsSync(path.join(outside, 'keep', 'file.txt')), true, 'folder was deleted');
      // Normal ids still work.
      assert.equal((await call('GET', `/api/manga/library/${manga.key}/chapters`)).status, 200);
      assert.equal((await call('POST', '/api/sessions/import', { session: { ...session, id: 'phabc123' }, cues: [] })).status, 200);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  await check('voice and reading again: refused without anything to work on', async () => {
    assert.equal((await call('POST', '/api/tts', { text: ' ' })).status, 404);
    assert.equal((await call('POST', '/api/manga/chapters/nothing/reread')).status, 400);
    assert.equal(typeof (await call('GET', '/api/modules')).json.voice, 'boolean');
  });

  await check('a closed Anki does not stop the check for existing cards', async () => {
    assert.deepEqual((await call('POST', '/api/anki/has-cards', { words: ['決まる'] })).json, { existing: [] });
    assert.deepEqual((await call('POST', '/api/anki/has-cards', { words: 'x' })).json, { existing: [] });
  });

  await check('pwa shell is served', async () => {
    const res = await fetch(base + '/');
    assert.ok([200, 503].includes(res.status));
  });
} finally {
  await stop();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
