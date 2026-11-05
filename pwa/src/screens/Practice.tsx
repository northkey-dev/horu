import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { kanjiInfo, lookupForm, tokenize, type DictEntry } from '../lib/japanese.ts';
import { setWordStatus, statusOf } from '../lib/words.ts';
import { Nav } from '../components/Nav.tsx';
import { kanjiFocus, wordsToPractice, type KanjiRow, type PracticeSentence, type WordCard } from '../../../shared/practice.ts';
import { isUnderstood, type WordStatus } from '../../../shared/words.ts';
import type { KanjiInfo } from '../../../shared/kanji.ts';
import type { Moment } from '../../../shared/types.ts';

// Practice from your own marks: the words in your marked sentences that you do not know yet, one at a time, and
// the kanji they are made of. Works on the phone alone (tokenizer and dictionary are on it).

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞', '形容動詞', '感動詞']);
const ROUND = 10;

const sentenceOf = (m: Moment): string => (m.cardSentence ?? m.candidates[m.matchedIndex ?? 0]?.text ?? m.candidates[0]?.text ?? '').trim();

type Loaded = { words: WordCard[]; statuses: Record<string, WordStatus | undefined>; kanji: (KanjiRow & { info?: KanjiInfo })[]; sentences: number };

async function load(): Promise<Loaded> {
  const moments = (await api.moments(300)).filter((m) => m.status !== 'discarded');
  const seen = new Set<string>();
  const sentences: PracticeSentence[] = [];
  for (const m of moments.slice(0, 200)) {
    const text = sentenceOf(m);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const tokens = await tokenize(text);
    sentences.push({ text, words: tokens.map((t) => ({ surface: t.surface, base: t.base && t.base !== '*' ? t.base : t.surface, content: CONTENT_POS.has(t.pos) })) });
  }
  const all = [...new Set(sentences.flatMap((s) => s.words.flatMap((w) => [w.base, w.surface])))];
  const statuses = await statusOf(all);
  const isKnown = (w: string) => isUnderstood(statuses[w]);
  const kanji = kanjiFocus(sentences, isKnown);
  const info = await kanjiInfo(kanji.map((k) => k.kanji).join(''));
  return {
    words: wordsToPractice(sentences, isKnown, (w) => (statuses[w] ?? 0) >= 3),
    statuses,
    kanji: kanji.map((k) => ({ ...k, info: info[k.kanji] })),
    sentences: sentences.length,
  };
}

export function Practice() {
  const [tab, setTab] = useState<'words' | 'kanji'>('words');
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    load().then(setData, (e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <Nav back="Insights" to="insights" />
      <h1>Practice</h1>
      <div className="segmented tabs" role="tablist" aria-label="Practice">
        <button role="tab" aria-selected={tab === 'words'} className={tab === 'words' ? 'on' : ''} onClick={() => setTab('words')}>
          Words
        </button>
        <button role="tab" aria-selected={tab === 'kanji'} className={tab === 'kanji' ? 'on' : ''} onClick={() => setTab('kanji')}>
          Kanji to learn first
        </button>
      </div>
      {error && <div className="banner error" style={{ marginTop: 16 }}>{error}</div>}
      {!data && !error && (
        <p className="muted row small" style={{ marginTop: 24 }}>
          <span className="spinner" /> Reading your marks…
        </p>
      )}
      {data && tab === 'words' && <Words data={data} />}
      {data && tab === 'kanji' && <Kanji rows={data.kanji} />}
    </div>
  );
}

function Words({ data }: { data: Loaded }) {
  const [round, setRound] = useState(0);
  const [queue, setQueue] = useState<WordCard[]>(() => data.words.slice(0, ROUND));
  const [done, setDone] = useState(0);
  const [shown, setShown] = useState<DictEntry>();
  const [revealed, setRevealed] = useState(false);

  const card = queue[0];
  useEffect(() => {
    setRevealed(false);
    setShown(undefined);
    if (card) lookupForm(card.word).then((e) => setShown(e[0]), () => undefined);
  }, [card?.word]);

  if (!data.words.length)
    return (
      <p className="muted" style={{ marginTop: 24 }}>
        Nothing to practise: every word with a kanji in your {data.sentences} marked sentences is known or already practised. Mark more sentences while you watch or read.
      </p>
    );

  function next(gotIt: boolean) {
    if (!card) return;
    if (gotIt) {
      setDone((n) => n + 1);
      // Three "Got it" over time lift a word to level 3 and take it off this list; Known stays your decision.
      const level = Math.min(((data.statuses[card.word] ?? 0) as number) + 1, 3) as WordStatus;
      data.statuses[card.word] = level;
      void setWordStatus(card.word, level);
    }
    setQueue((q) => (gotIt ? q.slice(1) : [...q.slice(1), q[0]]));
  }

  if (!card)
    return (
      <div style={{ marginTop: 24 }}>
        <p>
          Round finished: <b>{done}</b> words.
        </p>
        <button
          className="primary"
          onClick={() => {
            const rest = data.words.filter((w) => (data.statuses[w.word] ?? 0) < 3);
            setQueue(rest.slice(0, ROUND));
            setDone(0);
            setRound((r) => r + 1);
          }}
          disabled={!data.words.some((w) => (data.statuses[w.word] ?? 0) < 3)}
        >
          Another round
        </button>
      </div>
    );

  const reading = shown?.kana[0];
  const marked = card.sentence.includes(card.word) ? card.sentence.split(card.word) : undefined;
  return (
    <div key={round} style={{ marginTop: 20 }}>
      <p className="muted small num">
        {queue.length} left · seen {card.count}× in your marks
      </p>
      <div className="jp" style={{ fontSize: 44, lineHeight: 1.4, textAlign: 'center', margin: '12px 0' }}>
        {card.word}
      </div>
      <p className="jp muted" style={{ textAlign: 'center' }}>
        {marked ? (
          <>
            {marked[0]}
            <b>{card.word}</b>
            {marked.slice(1).join(card.word)}
          </>
        ) : (
          card.sentence
        )}
      </p>
      {revealed ? (
        <div className="translation" style={{ textAlign: 'center' }}>
          <p className="jp" style={{ fontSize: 24 }}>
            {reading ?? '–'}
          </p>
          <p>{shown ? shown.senses.slice(0, 3).join(' · ') : 'Not in the dictionary.'}</p>
        </div>
      ) : (
        <button className="grow" style={{ width: '100%' }} onClick={() => setRevealed(true)}>
          Show reading and meaning
        </button>
      )}
      {revealed && (
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="grow" onClick={() => next(false)}>
            Again
          </button>
          <button className="primary grow" onClick={() => next(true)}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}

function Kanji({ rows }: { rows: (KanjiRow & { info?: KanjiInfo })[] }) {
  if (!rows.length)
    return (
      <p className="muted" style={{ marginTop: 24 }}>
        Every kanji in your marked sentences is part of a word you know.
      </p>
    );
  return (
    <>
      <p className="hint" style={{ marginTop: 16 }}>
        Kanji from your marks that no word you know contains, the most frequent first. Learn the top ones and many marked sentences open up.
      </p>
      <div className="group">
        {rows.map((r) => (
          <div key={r.kanji} className="cell" style={{ alignItems: 'flex-start', gap: 14 }}>
            <span className="jp" style={{ fontSize: 40, lineHeight: 1.1, minWidth: 48, textAlign: 'center' }}>
              {r.kanji}
            </span>
            <span className="grow">
              <b>{r.info?.meanings.slice(0, 3).join(', ') ?? '–'}</b>
              <span className="muted small" style={{ display: 'block' }}>
                {[...(r.info?.on ?? []).slice(0, 2), ...(r.info?.kun ?? []).slice(0, 2)].join(' · ')}
              </span>
              <span className="muted small jp" style={{ display: 'block' }}>
                {r.word} · {r.count}× in your marks
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
