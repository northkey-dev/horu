import { useEffect, useState } from 'react';
import { kanjiInfo, lookupAt, type KanjiInfo, type Lookup, type Token } from '../lib/japanese.ts';
import { kanjiOf } from '../../../shared/kanji.ts';
import { dictExtras, setWordStatus, statusOf } from '../lib/words.ts';
import { STATUSES, type WordStatus } from '../../../shared/words.ts';
import { pitchName, type DictHit } from '../../../shared/yomitan.ts';
import { Sheet } from './Sheet.tsx';

// Bottom sheet with dictionary results for the tapped word (longest match first), then its kanji one by one
// (KANJIDIC), which is also the answer when JMdict has no word at all.
// `onPick` is offered when the caller can use a word, e.g. as card target.

type Props = {
  tokens: Token[];
  index: number;
  onClose: () => void;
  onPick?: (l: Lookup) => void;
  pickLabel?: string;
};

export function WordSheet({ tokens, index, onClose, onPick, pickLabel = 'Use as target' }: Props) {
  const [results, setResults] = useState<Lookup[]>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<Record<string, WordStatus | undefined>>({});
  const [extras, setExtras] = useState<Record<string, DictHit>>({});
  const [kanji, setKanji] = useState<Record<string, KanjiInfo>>();

  // Word status feeds the known-words estimate (episode difficulty, suggestions, highlighting).
  function choose(form: string, value: WordStatus) {
    setStatus((m) => ({ ...m, [form]: value }));
    void setWordStatus(form, value);
  }

  useEffect(() => {
    setResults(undefined);
    setKanji(undefined);
    lookupAt(tokens, index).then(
      (list) => {
        setResults(list);
        const forms = [...new Set(list.map((l) => l.form))];
        statusOf(forms).then(setStatus, () => undefined);
        dictExtras(forms).then(setExtras, () => undefined);
        kanjiInfo(list[0]?.text ?? tokens[index].surface).then(setKanji, () => setKanji({}));
      },
      (e: Error) => setError(e.message),
    );
  }, [tokens, index]);

  const tok = tokens[index];
  const chars = kanjiOf(results?.[0]?.text ?? tok.surface);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <Sheet onClose={onClose}>
        {error && <p className="muted">{error}</p>}
        {!results && !error && (
          <p className="muted row">
            <span className="spinner" /> Looking up…
          </p>
        )}
        {results && !results.length && (
          <div>
            <div className="entry">
              <span className="head jp">{tok.surface}</span>
              {tok.reading && <span className="reading jp">{tok.reading}</span>}
              <p className="muted small">
                {!chars.length
                  ? 'No dictionary entry. Translate the whole line to see what it means here.'
                  : 'Not in the word dictionary (a name, rare or old word, or an OCR error). Its kanji:'}
              </p>
            </div>
            {onPick && (
              <button className="primary block" onClick={() => onPick({ text: tok.surface, form: tok.base, start: tok.start, end: tok.end, entries: [] })}>
                {pickLabel}: {tok.surface}
              </button>
            )}
          </div>
        )}
        {results?.map((l) => (
          <div key={l.form + l.start + l.end} className="entry">
            <div className="row">
              <div className="grow">
                <span className="head jp">{l.form}</span>
                {l.form !== l.text && <span className="reading jp">{l.text}</span>}
              </div>
              {onPick && (
                <button className="small primary" onClick={() => onPick(l)}>
                  {pickLabel}
                </button>
              )}
            </div>
            <WordExtras hit={extras[l.form]} />
            <div className="status-row" role="radiogroup" aria-label="How well you know it">
              {STATUSES.map((st) => (
                <button key={st.value} role="radio" aria-checked={(status[l.form] ?? 0) === st.value} className={(status[l.form] ?? 0) === st.value ? 'on' : ''} onClick={() => choose(l.form, st.value)}>
                  {st.label}
                </button>
              ))}
            </div>
            {l.entries.map((e, i) => (
              <div key={i} className="sense">
                <span className="sense-word jp">{e.kanji[0] ?? e.kana[0]}</span>
                <span className="reading jp">{e.kana.slice(0, 2).join('・')}</span>
                {e.common && <span className="tag common">common</span>}
                <ol>
                  {e.senses.slice(0, 3).map((s, j) => (
                    <li key={j}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
            {extras[l.form]?.defs.map((d, i) => (
              <div key={`y${i}`} className="sense">
                <span className="dict-name">{d.dict}</span>
                <span className="reading jp">{d.reading}</span>
                <p className="gloss">{d.gloss}</p>
              </div>
            ))}
          </div>
        ))}
        {results && chars.length > 0 && <KanjiList chars={chars} info={kanji} />}
      </Sheet>
    </>
  );
}

/** Meaning and readings of each kanji; says so when one is not a Japanese character at all. */
function KanjiList({ chars, info }: { chars: string[]; info?: Record<string, KanjiInfo> }) {
  if (!info) return null;
  const unknown = chars.filter((c) => !info[c]);
  return (
    <div className="kanji-list">
      {chars
        .filter((c) => info[c])
        .map((c) => (
          <div key={c} className="kanji-item">
            <span className="kanji-char jp">{c}</span>
            <div className="grow">
              <div className="gloss">{info[c].meanings.join(', ') || '—'}</div>
              <div className="kanji-readings jp">
                {info[c].on.length > 0 && <span>{info[c].on.join('、')}</span>}
                {info[c].kun.length > 0 && <span>{info[c].kun.join('、')}</span>}
              </div>
            </div>
          </div>
        ))}
      {unknown.length > 0 && (
        <p className="muted small">
          <span className="jp">{unknown.join(' ')}</span> {unknown.length > 1 ? 'are' : 'is'} not used in Japanese – probably Chinese text or an OCR error.
        </p>
      )}
    </div>
  );
}

/** Frequency rank and pitch accent from the imported Yomitan dictionaries. */
function WordExtras({ hit }: { hit?: DictHit }) {
  if (!hit?.freq && !hit?.pitch) return null;
  return (
    <div className="word-extras">
      {hit.freq && (
        <span title={hit.freq.dict}>
          Frequency <b className="num">#{hit.freq.rank}</b>
        </span>
      )}
      {hit.pitch?.slice(0, 2).map((p) => (
        <span key={p.reading}>
          <span className="jp">{p.reading}</span> {p.positions.map((n) => `[${n}] ${pitchName(p.reading, n)}`).join(' · ')}
        </span>
      ))}
    </div>
  );
}
