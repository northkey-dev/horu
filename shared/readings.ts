import { toHiragana } from './furigana.ts';
import type { KanjiInfo } from './kanji.ts';

// Getting readings right. The IPA dictionary behind the tokenizer knows most words, but it has some plain mistakes
// (この間 as konokan) and reads counters digit by digit (３日). Those are corrected here, for furigana, cards and
// the voice alike. Better still is what the page itself prints next to a kanji: a manga's own furigana (Printed)
// beats every dictionary, as long as it really is a reading of that kanji.

/** Furigana printed on the page, as a pair, so it survives a correction of the text. */
export type Printed = { base: string; reading: string };

type RawToken = { surface_form: string; basic_form: string; reading?: string; pronunciation?: string; pos: string; pos_detail_1: string };

/** 1日 stays out: it can be ついたち or いちにち. */
const COUNTERS: Record<string, Record<string, string>> = {
  日: { 2: 'フツカ', 3: 'ミッカ', 4: 'ヨッカ', 5: 'イツカ', 6: 'ムイカ', 7: 'ナノカ', 8: 'ヨウカ', 9: 'ココノカ', 10: 'トオカ', 14: 'ジュウヨッカ', 20: 'ハツカ' },
  人: { 1: 'ヒトリ', 2: 'フタリ' },
  つ: { 1: 'ヒトツ', 2: 'フタツ', 3: 'ミッツ', 4: 'ヨッツ', 5: 'イツツ', 6: 'ムッツ', 7: 'ナナツ', 8: 'ヤッツ', 9: 'ココノツ' },
};

/**
 * Words the dictionary reads wrongly, or with the rarer of two readings. Found by comparing it with the furigana
 * printed in real manga: standing alone, 金 is money far more often than gold.
 */
const WORDS: Record<string, string> = { この間: 'コノアイダ', その間: 'ソノアイダ', あの間: 'アノアイダ', 値: 'ネ', 他: 'ホカ', 金: 'カネ', 後: 'アト' };

const asWord = <T extends RawToken>(token: T, surface: string, kana: string): T => ({
  ...token,
  surface_form: surface,
  basic_form: surface,
  reading: kana,
  pronunciation: kana,
  pos: '名詞',
  pos_detail_1: '一般',
});

/** The tokens with the known mistakes corrected. */
export function correctTokens<T extends RawToken>(tokens: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const surface = token.surface_form;
    // ３日, １０日: the digits may come as several tokens.
    let end = i;
    let digits = '';
    while (end < tokens.length && /^[0-9０-９]+$/.test(tokens[end].surface_form)) digits += tokens[end++].surface_form;
    const counter = digits ? tokens[end]?.surface_form : undefined;
    const counted = counter ? COUNTERS[counter]?.[digits.normalize('NFKC')] : undefined;
    if (counted) {
      out.push(asWord(tokens[end], digits + counter!, counted));
      i = end;
      continue;
    }
    if (digits) {
      out.push(...tokens.slice(i, end)); // a number as a whole: the 3 of １３日 is no ３日
      i = end - 1;
      continue;
    }
    // 一人, 二人, but not 十二人.
    const numeral = /^[一二三四五六七八九十百千万億]+$/.test(tokens[i - 1]?.surface_form ?? '');
    if ((surface === '一' || surface === '二') && tokens[i + 1]?.surface_form === '人' && !numeral) {
      out.push(asWord(tokens[i + 1], `${surface}人`, surface === '一' ? 'ヒトリ' : 'フタリ'));
      i++;
      continue;
    }
    if (WORDS[surface]) {
      out.push(asWord(token, surface, WORDS[surface]));
      continue;
    }
    // The dictionary's first choice for verbs that are mostly the other one in speech: 行った is went, 抱く is だく.
    if (surface === '行っ' && token.reading === 'オコナッ') {
      out.push({ ...token, basic_form: '行く', reading: 'イッ', pronunciation: 'イッ' });
      continue;
    }
    if (surface.startsWith('抱') && token.reading?.startsWith('イダ')) {
      const kana = token.reading.slice(1);
      out.push({ ...token, reading: kana, pronunciation: kana });
      continue;
    }
    // 間 alone is ま in the dictionary, which fits 間が悪い. After の and before に it is the space between: あいだ.
    if (surface === '間' && token.reading === 'マ' && (tokens[i - 1]?.surface_form === 'の' || tokens[i + 1]?.surface_form === 'に')) {
      out.push({ ...token, reading: 'アイダ', pronunciation: 'アイダ' });
      continue;
    }
    out.push(token);
  }
  return out;
}

const KANJI = /[㐀-鿿豈-﫿々]/;

/** The reading of a word when the page printed one for it (hiragana), else undefined. */
export function printedReading(surface: string, printed: Printed[] = []): string | undefined {
  let spelled = surface;
  for (const p of printed) spelled = spelled.replaceAll(p.base, p.reading);
  // A kanji left unread, or a digit: ３日 is みっか as a whole, the か printed over 日 does not read it.
  if (spelled === surface || /[㐀-鿿豈-﫿々0-9０-９]/.test(spelled)) return undefined;
  return toHiragana(spelled);
}

/** The ways a kanji can sound, in hiragana: 間 → かん, けん, あいだ, ま, あい. */
function readingsOf(kanji: string, dic: Record<string, KanjiInfo>): string[] {
  const info = dic[kanji];
  if (!info) return [];
  const plain = [...info.on, ...info.kun].map((r) => toHiragana(r).replace(/[-‐]/g, ''));
  // 売.る: the stem is what stands over the kanji, the okurigana are spelled out.
  return [...new Set(plain.flatMap((r) => [r.replace('.', ''), r.split('.')[0]]))].filter(Boolean);
}

const VOICED: Record<string, string> = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const HALF_VOICED: Record<string, string> = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

/** A reading in the forms it takes inside a compound: voiced (にほんご → ぼん), cut short (がっこう: がく → がっ). */
function forms(reading: string): string[] {
  const first = reading[0];
  const out = [reading];
  if (VOICED[first]) out.push(VOICED[first] + reading.slice(1));
  if (HALF_VOICED[first]) out.push(HALF_VOICED[first] + reading.slice(1));
  for (const r of [...out]) if (/[くきちつ]$/.test(r) && r.length > 1) out.push(`${r.slice(0, -1)}っ`);
  return out;
}

/** Can this kana be split into readings of these kanji? 木=さい cannot, so that was a misread mark. */
export function fitsKanji(base: string, reading: string, dic: Record<string, KanjiInfo>): boolean {
  const chars = [...base];
  const kana = toHiragana(reading);
  const walk = (at: number, pos: number): boolean => {
    if (at === chars.length) return pos === kana.length;
    const c = chars[at] === '々' ? chars[at - 1] : chars[at];
    const last = at === chars.length - 1;
    // Only the inside of a word is cut short: せいかっ is a misread せいかつ.
    return readingsOf(c, dic).some((r) => forms(r).some((f) => !(last && f.endsWith('っ')) && kana.startsWith(f, pos) && walk(at + 1, pos + f.length)));
  };
  return walk(0, 0);
}

/**
 * Which of the marks read off a page are furigana worth believing. A mark must be kana, and a reading of the kanji
 * beside it, or a reading the dictionary has for that word (今日 = きょう cannot be split per kanji).
 */
export function trustedPrinted(found: { base: string; ruby: string }[], dic: Record<string, KanjiInfo>, known: (word: string) => string[]): Printed[] {
  const out = new Map<string, string>();
  for (const { base, ruby } of found) {
    const reading = toHiragana(ruby.trim());
    if (!/^[ぁ-ゖー]+$/.test(reading)) continue;
    if (known(base).map(toHiragana).includes(reading) || fitsKanji(base, reading, dic)) out.set(base, reading);
  }
  return [...out].map(([base, reading]) => ({ base, reading }));
}

/** Spelled the way the check below spells them: 来た is き over 来, and the dictionary keeps いい apart from 良い. */
const IRREGULAR: Record<string, string[]> = { 来る: ['きる', 'こる'], 良い: ['いい'] };

/**
 * 決 can be さ, but there is no verb さまる: a mark on a verb or adjective has to give a word the dictionary has.
 * A mark that goes is no loss, the word then just keeps the dictionary's reading.
 */
export function realWords(printed: Printed[], words: Pick<RawToken, 'surface_form' | 'basic_form' | 'pos'>[], known: (word: string) => string[]): Printed[] {
  return printed.filter((p) => {
    const word = words.find((w) => w.surface_form.includes(p.base));
    if (!word || !['動詞', '形容詞'].includes(word.pos)) return true;
    const readings = [...known(word.basic_form).map(toHiragana), ...(IRREGULAR[word.basic_form] ?? [])];
    const spelled = printed.reduce((s, m) => s.replaceAll(m.base, m.reading), word.basic_form);
    // Part of the word has no mark: then there is nothing to compare.
    return !readings.length || KANJI.test(spelled) || readings.includes(spelled);
  });
}

/** Printed readings as they arrive from a client. */
export function asPrinted(raw: unknown): Printed[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw.filter((p): p is Printed => typeof p?.base === 'string' && typeof p?.reading === 'string' && p.base.length > 0 && p.reading.length > 0).slice(0, 30);
  return list.length ? list.map((p) => ({ base: p.base.slice(0, 20), reading: p.reading.slice(0, 40) })) : undefined;
}
