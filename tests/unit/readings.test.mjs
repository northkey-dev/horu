import test from 'node:test';
import assert from 'node:assert/strict';
import { correctTokens, fitsKanji, printedReading, realWords, trustedPrinted } from '../../shared/readings.ts';
import { tokenizer } from '../../server/src/japanese.ts';

const read = async (text) => (await tokenizer()).tokenize(text).map((t) => t.reading ?? t.surface_form).join('');
const dic = {
  間: { on: ['カン', 'ケン'], kun: ['あいだ', 'ま', 'あい'], meanings: [] },
  木: { on: ['ボク', 'モク'], kun: ['き', 'こ-'], meanings: [] },
  売: { on: ['バイ'], kun: ['う.る', 'う.れる'], meanings: [] },
  学: { on: ['ガク'], kun: ['まな.ぶ'], meanings: [] },
  校: { on: ['コウ', 'キョウ'], kun: [], meanings: [] },
  本: { on: ['ホン'], kun: ['もと'], meanings: [] },
  日: { on: ['ニチ', 'ジツ'], kun: ['ひ', 'か'], meanings: [] },
  諸: { on: ['ショ'], kun: ['もろ'], meanings: [] },
  腎: { on: ['ジン'], kun: [], meanings: [] },
  臓: { on: ['ゾウ'], kun: [], meanings: [] },
};

test('the known mistakes of the dictionary are corrected for everyone', async () => {
  assert.equal(await read('この間'), 'コノアイダ');
  assert.equal(await read('二人の間'), 'フタリノアイダ');
  assert.equal(await read('時間の間に'), 'ジカンノアイダニ');
  assert.equal(await read('一人で'), 'ヒトリデ');
  assert.equal(await read('３日'), 'ミッカ');
  assert.equal(await read('１０日'), 'トオカ');
});

test('what only looks like them stays as it is', async () => {
  assert.equal(await read('間が悪い'), 'マガワルイ');
  assert.match(await read('十二人'), /ニン$/);
  assert.match(await read('１３日'), /ニチ$/);
  assert.equal(await read('間に合う'), 'マニアウ');
});

test('corrected words are still one word each', () => {
  const tok = (surface_form, reading, pos = '名詞') => ({ surface_form, basic_form: surface_form, reading, pronunciation: reading, pos, pos_detail_1: '一般' });
  const out = correctTokens([tok('３', 'サン'), tok('日', 'ニチ'), tok('は', 'ハ', '助詞')]);
  assert.deepEqual(out.map((t) => t.surface_form), ['３日', 'は']);
});

test('printed furigana beats the dictionary, also inside a longer word', () => {
  const printed = [{ base: '間', reading: 'あいだ' }, { base: '売', reading: 'う' }];
  assert.equal(printedReading('この間', printed), 'このあいだ');
  assert.equal(printedReading('間', printed), 'あいだ');
  assert.equal(printedReading('売っ', printed), 'うっ');
  assert.equal(printedReading('腎臓', printed), undefined, 'nothing printed for it');
  assert.equal(printedReading('時間', printed), undefined, 'a kanji stays unread');
  assert.equal(printedReading('何か'), undefined);
});

test('readings found by comparing with printed furigana', async () => {
  assert.equal(await read('いい値'), 'イイネ');
  assert.equal(await read('他の'), 'ホカノ');
  assert.equal(await read('金もねぇ'), 'カネモネェ');
  assert.equal(await read('入った後'), 'ハイッタアト');
  assert.equal(await read('金曜日'), 'キンヨウビ', 'a longer word keeps its reading');
  assert.equal(await read('飲み行った'), 'ノミイッタ');
  assert.equal(await read('抱かせて'), 'ダカセテ');
});

test('a digit is never spelled by what is printed over the rest', () => {
  assert.equal(printedReading('３日', [{ base: '日', reading: 'か' }]), undefined);
});

test('a word may not end cut short', () => {
  const words = { 生: { on: ['セイ'], kun: [], meanings: [] }, 活: { on: ['カツ'], kun: [], meanings: [] } };
  assert.equal(fitsKanji('生活', 'せいかっ', words), false);
  assert.ok(fitsKanji('生活', 'せいかつ', words));
});

test('a reading has to fit the kanji', () => {
  assert.ok(fitsKanji('間', 'あいだ', dic));
  assert.ok(fitsKanji('売', 'う', dic));
  assert.ok(fitsKanji('腎臓', 'じんぞう', dic));
  assert.ok(fitsKanji('学校', 'がっこう', dic), 'がく shortens to がっ');
  assert.ok(fitsKanji('日本', 'にっぽん', dic), 'にち shortens, ほん takes the half voice');
  assert.ok(fitsKanji('諸々', 'もろもろ', dic), '々 repeats');
  assert.equal(fitsKanji('木', 'さい', dic), false);
  assert.equal(fitsKanji('本', 'ちばん', dic), false);
  assert.equal(fitsKanji('間', 'あいだだ', dic), false, 'nothing may be left over');
  assert.equal(fitsKanji('未知', 'みち', dic), false, 'a kanji the dictionary does not have');
});

test('a mark on a verb has to give a real word', () => {
  const known = (word) => ({ 決まる: ['きまる'], 抱く: ['だく', 'いだく'], 取り出す: ['とりだす'] })[word] ?? [];
  const verb = (surface_form, basic_form) => ({ surface_form, basic_form, pos: '動詞' });
  assert.deepEqual(realWords([{ base: '決', reading: 'さ' }], [verb('決まっ', '決まる')], known), [], 'さまる does not exist');
  assert.equal(realWords([{ base: '決', reading: 'き' }], [verb('決まっ', '決まる')], known).length, 1);
  assert.equal(realWords([{ base: '抱', reading: 'だ' }], [verb('抱き', '抱く')], known).length, 1);
  assert.equal(realWords([{ base: '取', reading: 'と' }], [verb('取り出し', '取り出す')], known).length, 1, 'only half of the word is marked');
  assert.equal(realWords([{ base: '取', reading: 'と' }, { base: '出', reading: 'だ' }], [verb('取り出し', '取り出す')], known).length, 2);
  assert.equal(realWords([{ base: '来', reading: 'き' }], [verb('来', '来る')], (w) => (w === '来る' ? ['くる'] : [])).length, 1, 'き is 来 before た');
  assert.equal(realWords([{ base: '叫', reading: 'さけ' }], [verb('叫ん', '叫ぶ')], known).length, 1, 'a verb the dictionary lacks');
  assert.equal(realWords([{ base: '間', reading: 'あいだ' }], [{ surface_form: '間', basic_form: '間', pos: '名詞' }], known).length, 1);
});

test('only believable marks are kept', () => {
  const known = (word) => (word === '今日' ? ['きょう', 'こんにち'] : []);
  const kept = trustedPrinted(
    [
      { base: '間', ruby: 'あいだ' },
      { base: '木', ruby: 'さい' },
      { base: '売', ruby: '片方' },
      { base: '腎臓', ruby: 'じんぞう？' },
      { base: '今日', ruby: 'きょう' },
    ],
    dic,
    known,
  );
  assert.deepEqual(kept, [{ base: '間', reading: 'あいだ' }, { base: '今日', reading: 'きょう' }]);
});
