// Smoke test: starts a throwaway server on its own port and data folder (data-smoke, never your real data/)
// and checks the main API contracts. Anki, Whisper, Claude and the phone are not needed.
//   npm run smoke
import { spawn } from 'node:child_process';
import http from 'node:http';
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

const server = spawn(process.execPath, [path.join(root, 'server', 'src', 'main.ts')], {
  env: { ...process.env, HORU_PORT: String(PORT), HORU_DATA: 'data-smoke', HORU_ANKI_URL: 'http://127.0.0.1:9', HORU_JIMAKU_URL: `http://127.0.0.1:${JIMAKU_PORT}` },
  stdio: 'ignore',
});
const stop = () => {
  server.kill();
  jimaku.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
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
    const none = (await call('POST', '/api/sessions/detect', { texts: [{ text: "Frieren Beyond Journey's End - SiteName", weight: 2 }] })).json;
    assert.equal(none.session.episode, 1);
    assert.equal(none.session.cueCount, 0, 'no episode, no subtitles');
    assert.match(none.warning ?? '', /no episode/i);
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

  await check('pwa shell is served', async () => {
    const res = await fetch(base + '/');
    assert.ok([200, 503].includes(res.status));
  });
} finally {
  stop();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
