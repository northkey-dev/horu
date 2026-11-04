import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonKeepingDamaged } from '../../server/src/jsonFile.ts';

const inTemp = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horu-json-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('a good file is read', () =>
  inTemp((dir) => {
    fs.writeFileSync(path.join(dir, 'a.json'), '{"x":1}');
    assert.deepEqual(readJsonKeepingDamaged(path.join(dir, 'a.json'), () => ({})), { x: 1 });
  }));

test('a missing file is the first start: no copy, the fallback', () =>
  inTemp((dir) => {
    assert.deepEqual(readJsonKeepingDamaged(path.join(dir, 'a.json'), () => ({ fresh: true })), { fresh: true });
    assert.deepEqual(fs.readdirSync(dir), []);
  }));

test('a damaged file is kept aside before it can be overwritten', () =>
  inTemp((dir) => {
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, '{"moments":[{"id":"half');
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(readJsonKeepingDamaged(file, () => ({ fresh: true })), { fresh: true });
    } finally {
      console.error = quiet;
    }
    const copy = fs.readdirSync(dir).find((f) => f.includes('.damaged-'));
    assert.ok(copy, 'no copy made');
    assert.equal(fs.readFileSync(path.join(dir, copy), 'utf8'), '{"moments":[{"id":"half');
  }));
