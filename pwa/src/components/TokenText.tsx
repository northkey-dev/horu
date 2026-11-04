import { useEffect, useState } from 'react';
import { alignReading, kanjiInfo, tokenize, type KanjiInfo, type Lookup, type Token } from '../lib/japanese.ts';
import { guessReading, KANJI_CHAR } from '../../../shared/kanji.ts';
import { statusOf } from '../lib/words.ts';
import type { WordStatus } from '../../../shared/words.ts';
import { WordSheet } from './WordSheet.tsx';

// Japanese text where every word can be tapped for a dictionary lookup. With `highlight`, words not known
// yet are underlined (new strongly, status 1-3 fainter), like the browser extension does on web pages.

type Props = {
  text: string;
  target?: { start: number; end: number };
  suggested?: { start: number; end: number };
  onPick?: (l: Lookup) => void;
  onTokens?: (tokens: Token[]) => void;
  className?: string;
  highlight?: boolean;
  pickLabel?: string;
  /** Show the furigana switch under the text (the reader has one for all paragraphs) */
  furiganaToggle?: boolean;
};

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '形容動詞', '感動詞', '連体詞']);
/** Tokens worth a status: content words with kana or kanji. */
export const isWord = (t: Token) => CONTENT_POS.has(t.pos) && /[぀-ヿ㐀-鿿]/.test(t.surface) && !/^[぀-ゟ]$/.test(t.surface);

function readFurigana(): boolean {
  try {
    return localStorage.getItem('horu-furigana') === '1';
  } catch {
    return false;
  }
}

export function TokenText({ text, target, suggested, onPick, onTokens, className = 'sentence', highlight, pickLabel, furiganaToggle = true }: Props) {
  const [tokens, setTokens] = useState<Token[]>();
  const [statuses, setStatuses] = useState<Record<string, WordStatus | undefined>>();
  const [open, setOpen] = useState<number>();
  const [furigana, setFurigana] = useState(readFurigana);
  // Words the tokenizer has no reading for get one from KANJIDIC (shown fainter: a guess).
  const [kanji, setKanji] = useState<Record<string, KanjiInfo>>();

  function toggleFurigana() {
    setFurigana(!furigana);
    try {
      localStorage.setItem('horu-furigana', furigana ? '0' : '1');
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    let alive = true;
    tokenize(text).then(
      (t) => {
        if (!alive) return;
        setTokens(t);
        onTokens?.(t);
        if (highlight) statusOf([...new Set(t.filter(isWord).map((x) => x.base))]).then((s) => alive && setStatuses(s), () => undefined);
      },
      () => alive && setTokens(undefined),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const unread = (t: Token) => !t.reading && KANJI_CHAR.test(t.surface);
  useEffect(() => {
    if (!furigana || !tokens?.some(unread)) return;
    let alive = true;
    kanjiInfo(tokens.filter(unread).map((t) => t.surface).join('')).then((k) => alive && setKanji(k), () => undefined);
    return () => {
      alive = false;
    };
  }, [furigana, tokens]);

  const ruby = (t: Token) => {
    const guess = unread(t) && kanji ? guessReading(t.surface, kanji) : undefined;
    return alignReading(t.surface, guess ?? t.reading).map((part, k) =>
      part.ruby ? (
        <ruby key={k}>
          {part.text}
          <rt className={guess ? 'guess' : undefined}>{part.ruby}</rt>
        </ruby>
      ) : (
        part.text
      ),
    );
  };

  if (!tokens) return <div className={`${className} jp`}>{text}</div>;

  const inRange = (t: Token, r?: { start: number; end: number }) => r !== undefined && t.start < r.end && t.end > r.start;
  const mark = (t: Token) => {
    if (!statuses || !isWord(t) || !(t.base in statuses)) return '';
    const s = statuses[t.base];
    return s === 4 || s === -1 ? '' : ` w-s${s ?? 0}`;
  };
  return (
    <>
      <div className={`${className} jp${furigana ? ' with-furigana' : ''}`}>
        {tokens.map((t, i) => (
          <span
            key={i}
            className={`tok${inRange(t, target) ? ' target' : !target && inRange(t, suggested) ? ' suggested' : ''}${open === i ? ' sel' : ''}${mark(t)}`}
            onClick={() => /\S/.test(t.surface) && setOpen(i)}
          >
            {furigana ? ruby(t) : t.surface}
          </span>
        ))}
      </div>
      {furiganaToggle && (
        <button className="ghost small furigana-toggle" onClick={toggleFurigana} aria-pressed={furigana}>
          {furigana ? 'Hide furigana' : 'Show furigana'}
        </button>
      )}
      {open !== undefined && (
        <WordSheet
          tokens={tokens}
          index={open}
          onClose={() => {
            setOpen(undefined);
            // The status may have changed in the sheet.
            if (highlight) statusOf([...new Set(tokens.filter(isWord).map((x) => x.base))]).then(setStatuses, () => undefined);
          }}
          pickLabel={pickLabel}
          onPick={
            onPick &&
            ((l) => {
              onPick(l);
              setOpen(undefined);
            })
          }
        />
      )}
    </>
  );
}
