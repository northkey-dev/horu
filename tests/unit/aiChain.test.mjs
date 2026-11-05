import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChainError, runChain } from '../../server/src/aiChain.ts';
import { aiKey, createAiLog, trainingLines } from '../../server/src/aiLog.ts';
import { migrateAi } from '../../server/src/aiSettings.ts';
import { aiChain } from '../../shared/ai.ts';

test('aiChain: primary first, then the fallbacks, unknown names and repeats dropped', () => {
  assert.deepEqual(aiChain('gemini', 'claude,ollama'), ['gemini', 'claude', 'ollama']);
  assert.deepEqual(aiChain('claude', 'claude, gemini ,nonsense,gemini'), ['claude', 'gemini']);
  assert.deepEqual(aiChain('claude', ''), ['claude']);
  assert.deepEqual(aiChain('bogus', ''), ['claude']);
});

test('runChain: the first that answers wins, later ones are not asked', async () => {
  const asked = [];
  const out = await runChain(['a', 'b', 'c'], async (e) => (asked.push(e), e === 'a' ? Promise.reject(new Error('down')) : `from ${e}`));
  assert.deepEqual(out, { engine: 'b', result: 'from b' });
  assert.deepEqual(asked, ['a', 'b']);
});

test('runChain: an engine that is not set up is skipped without a call', async () => {
  const asked = [];
  const out = await runChain(['a', 'b'], async (e) => (asked.push(e), 'ok'), (e) => (e === 'a' ? 'no key' : undefined));
  assert.equal(out.engine, 'b');
  assert.deepEqual(asked, ['b']);
});

test('runChain: when all fail, one error names every engine', async () => {
  await assert.rejects(
    runChain(['a', 'b'], async (e) => Promise.reject(new Error(`${e} broke`))),
    (err) => err instanceof ChainError && /a: a broke/.test(err.message) && /b: b broke/.test(err.message),
  );
});

test('runChain: a single engine keeps its own error', async () => {
  const boom = new TypeError('own');
  await assert.rejects(runChain(['a'], async () => Promise.reject(boom)), (err) => err === boom);
});

test('runChain: reports each fallback', async () => {
  const seen = [];
  await runChain(['a', 'b'], async (e) => (e === 'a' ? Promise.reject(new Error('x')) : 1), undefined, (e, m) => seen.push([e, m]));
  assert.deepEqual(seen, [['a', 'x']]);
});

test('migrateAi: the old key and model move to the engine they belonged to', () => {
  assert.deepEqual(migrateAi({ aiEngine: 'gemini', aiApiKey: 'K', aiModel: 'M' }), { aiEngine: 'gemini', aiKeyGemini: 'K', aiModelGemini: 'M' });
  assert.deepEqual(migrateAi({ aiEngine: 'claude', aiApiKey: 'K' }), { aiEngine: 'claude' });
  assert.deepEqual(migrateAi({ aiEngine: 'gemini', aiApiKey: 'old', aiKeyGemini: 'new' }), { aiEngine: 'gemini', aiKeyGemini: 'new' });
});

const inTemp = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horu-ailog2-'));
  try {
    fn(path.join(dir, 'ai-log.jsonl'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const rec = (output) => ({ t: 'x', kind: 'translate', engine: 'gemini', model: 'm', profile: 'p', input: { text: 'a' }, output });

test('ratings survive a restart and an answer asked again starts unrated', () =>
  inTemp((file) => {
    const log = createAiLog(file);
    log.add('k', rec('one'));
    assert.equal(log.rate('k', 1), true);
    assert.equal(log.rate('nope', 1), false);
    assert.equal(createAiLog(file).all()[0].rating, 1);
    log.add('k', rec('two'));
    const again = createAiLog(file).all();
    assert.equal(again.length, 1);
    assert.equal(again[0].output, 'two');
    assert.equal(again[0].rating, undefined);
  }));

test('training lines: poor answers stay out, rated mode keeps only good ones', () =>
  inTemp((file) => {
    const log = createAiLog(file);
    log.add('a', rec('A'));
    log.add('b', rec('B'));
    log.add('c', rec('C'));
    log.rate('a', 1);
    log.rate('b', -1);
    const prompt = (e) => `ask ${e.key}`;
    const all = trainingLines(log.all(), prompt).map((l) => JSON.parse(l));
    assert.deepEqual(all.map((x) => x.messages[0].content), ['ask a', 'ask c']);
    assert.equal(all[0].messages[1].content, '"A"');
    assert.equal(trainingLines(log.all(), prompt, true).length, 1);
  }));

test('the key tells engines apart', () => assert.notEqual(aiKey('translate', 'a', 'm', 'p', ['x']), aiKey('translate', 'b', 'm', 'p', ['x'])));
