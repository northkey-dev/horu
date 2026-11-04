import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { lookupDicts, parseYomitan, pitchName } from '../../shared/yomitan.ts';
import { parseWordList } from '../../shared/words.ts';
import { parseExplanation } from '../../shared/ai.ts';
import { alignReading, furiganaHtml } from '../../shared/furigana.ts';

const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(JSON.stringify(v))])));

test('yomitan: structured content becomes plain text, examples are dropped', () => {
  const d = parseYomitan(
    zip({
      'index.json': { title: 'Jitendex [2026]', revision: 'x' },
      'term_bank_1.json': [
        ['食べる', 'たべる', '', '', 0, [{ type: 'structured-content', content: [{ tag: 'ol', content: [{ tag: 'li', content: 'to eat' }, { tag: 'li', content: ['to live on ', { tag: 'img', path: 'x.png' }] }] }, { tag: 'div', data: { content: 'example-sentence' }, content: 'ご飯を食べる' }] }], 1, ''],
      ],
    }),
  );
  assert.equal(d.id, 'jitendex-2026');
  assert.deepEqual(d.terms['食べる'], [['たべる', 'to eat; to live on']]);
});

test('yomitan: frequency in all three shapes, lowest rank wins, pitch kept', () => {
  const d = parseYomitan(
    zip({
      'index.json': { title: 'Freq' },
      'term_meta_bank_1.json': [
        ['猫', 'freq', 500],
        ['猫', 'freq', { reading: 'ねこ', frequency: { value: 120, displayValue: '120' } }],
        ['犬', 'freq', { value: 900 }],
        ['箸', 'pitch', { reading: 'はし', pitches: [{ position: 1 }] }],
      ],
    }),
  );
  assert.equal(d.freq['猫'], 120);
  assert.equal(d.freq['犬'], 900);
  const hit = lookupDicts([d], ['箸', '猫', '無い']);
  assert.deepEqual(hit['箸'].pitch, [{ reading: 'はし', positions: [1] }]);
  assert.equal(hit['猫'].freq.rank, 120);
  assert.equal(hit['無い'], undefined);
  assert.equal(pitchName('はし', 1), 'atamadaka');
  assert.equal(pitchName('きょう', 1), 'atamadaka');
  assert.equal(pitchName('さかな', 0), 'heiban');
  assert.equal(pitchName('おとこ', 3), 'odaka');
});

test('yomitan: a zip without index.json is refused', () => {
  assert.throws(() => parseYomitan(zip({ 'foo.json': [] })), /index\.json/);
});

test('word list: first column, Japanese only, no duplicates', () => {
  assert.deepEqual(parseWordList('食べる\t to eat\n"見る",to see\nhello\n食べる\n\n'), ['食べる', '見る']);
});

test('AI answer: JSON inside prose or a code block is found', () => {
  const e = parseExplanation('Sure!\n```json\n{"targetReading":"ねこ","targetMeaning":"cat","translation":"A cat.","explanation":"Simple noun."}\n```');
  assert.equal(e.translation, 'A cat.');
  assert.equal(parseExplanation('no json here'), undefined);
});

test('furigana: okurigana outside the ruby, target in bold', () => {
  assert.deepEqual(alignReading('食べる', 'タベル'), [{ text: '食', ruby: 'た' }, { text: 'べる' }]);
  const html = furiganaHtml([{ surface: 'ご飯' , reading: 'ゴハン' }, { surface: 'を' }, { surface: '食べる', reading: 'タベル' }], 3, 6);
  assert.equal(html, 'ご<ruby>飯<rt>はん</rt></ruby>を<b><ruby>食<rt>た</rt></ruby>べる</b>');
});

test('import: Language Reactor style CSV with a header', async () => {
  const { parseImport } = await import('../../shared/importLines.ts');
  const csv = 'Word,Translation,Context,Source\n食べる,to eat,"毎日ご飯を食べる, そうだ",Netflix\nhello,x,no japanese,\n';
  assert.deepEqual(parseImport(csv), [{ sentence: '毎日ご飯を食べる, そうだ', word: '食べる', source: 'Netflix' }]);
});

test('import: JSON list, headerless TSV, duplicates dropped', async () => {
  const { parseImport } = await import('../../shared/importLines.ts');
  const json = JSON.stringify({ items: [{ subtitle: { text: '今日は<b>暑い</b>ね' }, lemma: '暑い' }, { subtitle: { text: '今日は<b>暑い</b>ね' } }] });
  assert.deepEqual(parseImport(json), [{ sentence: '今日は暑いね', word: '暑い', source: undefined }]);
  assert.deepEqual(parseImport('猫\t猫が好きです\tcat'), [{ sentence: '猫が好きです', word: '猫', source: undefined }]);
});

test('lang: Chinese manga text is told apart from Japanese', async () => {
  const { looksChinese } = await import('../../shared/lang.ts');
  const zh = Array(8).fill('你今天去哪裏了？我們一起走吧。').concat('がゃ');
  const ja = Array(8).fill('今日はどこへ行ったの？一緒に行こうよ。');
  assert.equal(looksChinese(zh), true);
  assert.equal(looksChinese(ja), false);
  assert.equal(looksChinese(['短い']), undefined);
});

test('kanji: reading guessed from KANJIDIC for words the tokenizer does not know', async () => {
  const { guessReading } = await import('../../shared/kanji.ts');
  const dic = { 嚇: { meanings: ['menacing'], on: ['カク'], kun: [] }, 杷: { meanings: ['loquat'], on: ['ハ'], kun: [] }, 侍: { meanings: [], on: [], kun: ['さむらい', 'はべ.る'] } };
  assert.equal(guessReading('嚇', dic), 'かく');
  assert.equal(guessReading('杷ア', dic), 'はあ');
  assert.equal(guessReading('侍', dic), 'さむらい');
  assert.equal(guessReading('龘', dic), undefined);
});

test('manga errors: source failures are explained in plain words', async () => {
  const { friendlyMangaError } = await import('../../shared/mangaErrors.ts');
  assert.match(friendlyMangaError('Page download failed: 403'), /refused the download/);
  assert.match(friendlyMangaError('Page download failed: 404'), /no longer has/);
  assert.match(friendlyMangaError('fetch failed'), /cannot be reached/);
  assert.match(friendlyMangaError('The operation was aborted due to timeout'), /too long/);
  assert.equal(friendlyMangaError('Something else'), 'Something else');
});

test('lang: German and English lines are not Japanese, mixed lines with Japanese are', async () => {
  const { looksJapanese } = await import('../../shared/lang.ts');
  assert.equal(looksJapanese('本日は営業しております'), true);
  assert.equal(looksJapanese('禁煙'), true);
  assert.equal(looksJapanese('コーヒー'), true);
  assert.equal(looksJapanese('Opening hours: 9 to 18'), false);
  assert.equal(looksJapanese('Öffnungszeiten täglich'), false);
  assert.equal(looksJapanese('ＨＥＬＬＯ ＷＯＲＬＤ'), false);
  assert.equal(looksJapanese('12:30'), false);
  assert.equal(looksJapanese('営業時間 9:00-18:00'), true);
});

test('a card field is text: HTML in a sentence cannot run in Anki', async () => {
  const { highlight } = await import('../../shared/furigana.ts');
  assert.equal(highlight('<img src=x onerror=alert(1)>猫だ', 28, 29), '&lt;img src=x onerror=alert(1)&gt;<b>猫</b>だ');
});
