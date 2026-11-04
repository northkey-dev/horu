import test from 'node:test';
import assert from 'node:assert/strict';
import { pronunciation } from '../../server/src/tts.ts';

const spoken = async (text) => (await pronunciation(text)).replaceAll(' ', '');

test('the voice gets kana, with the readings the card shows', async () => {
  assert.equal(await spoken('何を言ってるんだ'), 'ナニヲイッテルンダ');
  assert.equal(await spoken('金曜日'), 'キンヨービ');
  assert.equal(await spoken('明日から'), 'アシタカラ');
  assert.equal(await spoken('私の心臓'), 'ワタシノシンゾー');
});

test('particles sound the way they are spoken', async () => {
  assert.equal(await spoken('学校は'), 'ガッコーワ');
  assert.equal(await spoken('東京へ'), 'トーキョーエ');
});

test('counters with their own readings', async () => {
  assert.equal(await spoken('これで３日は'), 'コレデミッカワ');
  assert.equal(await spoken('２人で'), 'フタリデ');
  assert.equal(await spoken('一人で'), 'ヒトリデ');
  assert.equal(await spoken('３つ'), 'ミッツ');
  // Numbers that only look like them stay numbers.
  assert.match(await spoken('１３日'), /^13/);
  assert.match(await spoken('１００人'), /^100/);
});

test('word groups stay apart, so the voice can breathe', async () => {
  assert.equal(await pronunciation('今日は雨が降っている'), 'キョーワ アメガ フッテ イル');
});
