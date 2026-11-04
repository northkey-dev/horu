// Furigana for card HTML, shared by the laptop and the phone. Both tokenize with kuromoji (IPA dictionary);
// this file only turns tokens into <ruby> markup.

const KANJI = /[㐀-鿿豈-﫿々〆ヶ]/;

export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Splits e.g. 食べる/たべる into [食|た] + べる so okurigana stays outside the ruby. */
export function alignReading(surface: string, reading: string): { text: string; ruby?: string }[] {
  if (!KANJI.test(surface) || !reading) return [{ text: surface }];
  const kana = toHiragana(reading);
  const runs = surface.match(/[㐀-鿿豈-﫿々〆ヶ]+|[^㐀-鿿豈-﫿々〆ヶ]+/g) ?? [surface];
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = runs.map((run) => (KANJI.test(run) ? '(.+?)' : `(${escape(toHiragana(run))})`)).join('');
  const match = new RegExp(`^${pattern}$`).exec(kana);
  if (!match) return [{ text: surface, ruby: kana }];
  return runs.map((run, i) => (KANJI.test(run) ? { text: run, ruby: match[i + 1] } : { text: run }));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sentence as HTML with <ruby> furigana and the target range wrapped in <b>.
 * Segments that overlap the target boundary are included in the bold part whole.
 */
export function furiganaHtml(tokens: { surface: string; reading?: string }[], targetStart: number, targetEnd: number): string {
  let html = '';
  let bold = false;
  let pos = 0;
  for (const token of tokens) {
    for (const seg of token.reading ? alignReading(token.surface, token.reading) : [{ text: token.surface }]) {
      const start = pos;
      pos += seg.text.length;
      const inTarget = pos > targetStart && start < targetEnd;
      if (inTarget !== bold) {
        html += inTarget ? '<b>' : '</b>';
        bold = inTarget;
      }
      html += seg.ruby ? `<ruby>${escapeHtml(seg.text)}<rt>${escapeHtml(seg.ruby)}</rt></ruby>` : escapeHtml(seg.text).replace(/\n/g, '<br>');
    }
  }
  if (bold) html += '</b>';
  return html;
}

/** Sentence with the target in <b> (the plain Sentence field). */
export function highlight(sentence: string, start: number, end: number): string {
  return `${sentence.slice(0, start)}<b>${sentence.slice(start, end)}</b>${sentence.slice(end)}`;
}

/** Reading of a word in hiragana; katakana words stay katakana. */
export function readingFromTokens(tokens: { surface: string; reading?: string }[]): string {
  return tokens.map((t) => (/^[゠-ヿ]+$/.test(t.surface) ? t.surface : toHiragana(t.reading || t.surface))).join('');
}

/** Anki tag for a title: no spaces or punctuation, at most 40 characters. */
export function slug(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s:：/\\,.!?'"()[\]{}]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}
