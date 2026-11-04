import { useEffect, useState } from 'react';
import { api, type EpisodeInsight, type WordStat } from '../lib/api.ts';
import { Icon } from './Icon.tsx';
import { setWordStatus } from '../lib/words.ts';

/** Difficulty of an episode or chapter + its most frequent new words, to learn before watching or reading. */
export function WordPrep({ load, source, heading, enabled, setting }: { load: () => Promise<EpisodeInsight>; source: string; heading: string; enabled: boolean; setting: 'prepBeforeWatch' | 'prepBeforeRead' }) {
  const [on, setOn] = useState<boolean>(); // the switch in Settings; unknown until loaded
  const [insight, setInsight] = useState<EpisodeInsight>();
  const [open, setOpen] = useState(false);
  const [known, setKnown] = useState<Record<string, boolean>>({});
  const [cards, setCards] = useState<Record<string, 'busy' | 'done' | string>>({});

  useEffect(() => {
    api.settings().then(
      (s) => setOn(s[setting]),
      () => setOn(true),
    );
  }, [setting]);

  useEffect(() => {
    setInsight(undefined);
    setCards({});
    setOpen(false);
    if (!enabled || !on) return;
    let alive = true;
    load().then(
      (d) => alive && setInsight(d),
      () => undefined,
    );
    return () => {
      alive = false;
    };
    // `load` is a new function every render; the parent re-mounts this component (key) when the source changes.
  }, [enabled, on]);

  if (!enabled || !on) return null;
  if (!insight) return <p className="footnote">Estimating how much you will understand…</p>;
  const pct = Math.round(insight.coverage * 100);

  async function toggle(word: string) {
    const next = !known[word];
    setKnown((k) => ({ ...k, [word]: next }));
    await setWordStatus(word, next ? 4 : 0).catch(() => undefined);
  }

  /** busy | done | exists (a Horu note with this word is already in Anki) | an error message */
  const stateOf = (w: WordStat) => cards[w.word] ?? (w.inAnki ? 'exists' : undefined);
  const pending = insight.priming.filter((w) => !known[w.word] && (stateOf(w) === undefined || !['busy', 'done', 'exists'].includes(stateOf(w)!)));

  async function addCards(list: WordStat[]) {
    setCards((c) => ({ ...c, ...Object.fromEntries(list.map((w) => [w.word, 'busy'])) }));
    try {
      const res = await api.previewCards(list.map((w) => ({ word: w.word, reading: w.reading, meaning: w.meaning, example: w.example, source: `${source} (preview)` })));
      setCards((c) => ({ ...c, ...Object.fromEntries(list.map((w) => [w.word, res.added.includes(w.word) ? 'done' : 'exists'])) }));
    } catch (e) {
      setCards((c) => ({ ...c, ...Object.fromEntries(list.map((w) => [w.word, (e as Error).message])) }));
    }
  }

  function addAll() {
    if (confirm(`Add ${pending.length} cards to Anki? They join your new cards and follow your daily limit.`)) void addCards(pending);
  }

  return (
    <>
      <h2>{heading}</h2>
      <div className="card">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="num" style={{ fontSize: 28, fontWeight: 600 }}>
            {pct}%
          </span>
          <span className="grow muted small">of the words you probably know</span>
          <span className="small muted">{insight.unknownWords} new</span>
        </div>
        <div className="meter">
          <div style={{ width: `${pct}%` }} />
        </div>
        {insight.priming.length > 0 && (
          <button className="small" style={{ marginTop: 12 }} onClick={() => setOpen(!open)}>
            {open ? 'Hide word list' : `Prepare ${insight.priming.length} key words · 5 min`}
          </button>
        )}
        {open && pending.length > 1 && (
          <button className="small" style={{ marginTop: 12, marginLeft: 8 }} onClick={addAll}>
            Add all {pending.length} as cards
          </button>
        )}
        {open && (
          <div style={{ marginTop: 6 }}>
            {insight.priming.map((w) => (
              <div key={w.word} className="word-row">
                <div className="grow">
                  <div>
                    <span className="w jp">{w.word}</span> <span className="muted jp small">{w.reading !== w.word ? w.reading : ''}</span>
                    <span className="tag">×{w.count}</span>
                  </div>
                  <div className="small">{w.meaning}</div>
                  {w.example && <div className="hint jp ellipsis">{w.example}</div>}
                  {stateOf(w) && !['busy', 'done', 'exists'].includes(stateOf(w)!) && <div className="hint">{stateOf(w)}</div>}
                </div>
                <button className="small" disabled={['busy', 'done', 'exists'].includes(stateOf(w) ?? '')} onClick={() => addCards([w])}>
                  {stateOf(w) === 'done' || stateOf(w) === 'exists' ? <Icon name="check" size={15} weight={2.2} /> : null}
                  {stateOf(w) === 'done' ? 'Added' : stateOf(w) === 'exists' ? 'In Anki' : stateOf(w) === 'busy' ? 'Adding…' : 'Card'}
                </button>
                <button className={`small ${known[w.word] ? 'known-on' : ''}`} onClick={() => toggle(w.word)}>
                  {known[w.word] && <Icon name="check" size={15} weight={2.2} />}
                  {known[w.word] ? 'Known' : 'Know it'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
