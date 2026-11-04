// Smoke test: starts a throwaway server on its own port and data folder (data-smoke, never your real data/)
// and checks the main API contracts. Anki, Whisper, Claude and the phone are not needed.
//   npm run smoke
import { spawn } from 'node:child_process';
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

const server = spawn(process.execPath, [path.join(root, 'server', 'src', 'main.ts')], {
  env: { ...process.env, HORU_PORT: String(PORT), HORU_DATA: 'data-smoke', HORU_ANKI_URL: 'http://127.0.0.1:9' },
  stdio: 'ignore',
});
const stop = () => {
  server.kill();
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

  await check('pwa shell is served', async () => {
    const res = await fetch(base + '/');
    assert.ok([200, 503].includes(res.status));
  });
} finally {
  stop();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
