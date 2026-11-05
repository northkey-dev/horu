import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aiKey, createAiLog } from '../../server/src/aiLog.ts';

const inTemp = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horu-ailog-'));
  try {
    fn(path.join(dir, 'ai-log.jsonl'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const rec = (output) => ({ t: '2026-11-05T00:00:00Z', kind: 'translate', engine: 'gemini', model: 'm', profile: 'p', input: { text: 'x' }, output });

test('a new log knows nothing', () => inTemp((file) => assert.equal(createAiLog(file).find('a'), undefined)));

test('an answer is found again, also after a restart', () =>
  inTemp((file) => {
    createAiLog(file).add('k1', rec({ translation: 'hello' }));
    assert.deepEqual(createAiLog(file).find('k1'), { translation: 'hello' });
    assert.equal(createAiLog(file).size(), 1);
  }));

test('every line is one JSON pair with input and output', () =>
  inTemp((file) => {
    createAiLog(file).add('k1', rec('a'));
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].input, { text: 'x' });
    assert.equal(lines[0].output, 'a');
  }));

test('a half-written last line is skipped, the rest stays', () =>
  inTemp((file) => {
    createAiLog(file).add('k1', rec('a'));
    fs.appendFileSync(file, '{"key":"k2","outp');
    const log = createAiLog(file);
    assert.equal(log.find('k1'), 'a');
    assert.equal(log.find('k2'), undefined);
  }));

test('the key changes with AI, model, learner text and input', () => {
  const base = aiKey('explain', 'gemini', 'm', 'p', ['s', 't', []]);
  assert.equal(base, aiKey('explain', 'gemini', 'm', ' p ', ['s', 't', []]));
  assert.notEqual(base, aiKey('translate', 'gemini', 'm', 'p', ['s', 't', []]));
  assert.notEqual(base, aiKey('explain', 'claude', 'm', 'p', ['s', 't', []]));
  assert.notEqual(base, aiKey('explain', 'gemini', 'm2', 'p', ['s', 't', []]));
  assert.notEqual(base, aiKey('explain', 'gemini', 'm', 'q', ['s', 't', []]));
  assert.notEqual(base, aiKey('explain', 'gemini', 'm', 'p', ['s', 'u', []]));
});
