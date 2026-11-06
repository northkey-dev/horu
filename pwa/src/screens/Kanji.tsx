import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { loadKanjidic } from '../lib/japanese.ts';
import { levelsOf, loadCollection, seenKanji, type Collection } from '../lib/kanjiSkill.ts';
import { Nav } from '../components/Nav.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { Stamp } from '../components/Stamp.tsx';
import { navigate } from '../lib/hooks.ts';
import { kanjiOf, type KanjiInfo } from '../../../shared/kanji.ts';
import { gradeGroups, kunShown, type Level } from '../../../shared/kanjiSkill.ts';

// The collection: every jouyou kanji (2136) as a tile. Red once you can read it, gold once you can read it for good,
// outlined once it appeared in something you marked or read, faint before that. Nothing is filled in for you.

type Loaded = { dic: Record<string, KanjiInfo>; collection: Collection; seen: Set<string> };

async function load(): Promise<Loaded> {
  const [dic, collection, seen] = await Promise.all([loadKanjidic(), loadCollection(), seenKanji()]);
  // Kanji of everything marked count as met, too.
  for (const m of await api.moments(300).catch(() => []))
    for (const k of kanjiOf(m.cardSentence ?? m.candidates[m.matchedIndex ?? 0]?.text ?? m.candidates[0]?.text ?? '')) seen.add(k);
  return { dic, collection, seen };
}

export function Kanji({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();

  useEffect(() => {
    load().then(setData, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (!data)
    return (
      <div>
        {!embedded && <Nav back="Study" to="study" />}
        <p className="muted row small" style={{ marginTop: 24 }}>
          <span className="spinner" /> Loading the collection…
        </p>
      </div>
    );

  const groups = gradeGroups(data.dic);
  const all = groups.flatMap((g) => g.kanji);
  const levels = levelsOf(data.collection, all);
  const red = all.filter((k) => levels[k] === 1).length;
  const gold = all.filter((k) => levels[k] === 2).length;
  const info = open ? data.dic[open] : undefined;

  return (
    <div>
      {!embedded && <Nav back="Study" to="study" />}
      {!embedded && <h1>Kanji</h1>}
      <div className="kanji-total" style={embedded ? { marginTop: 18 } : undefined}>
        <span className="serif num">{red + gold}</span>
        <span className="muted"> / {all.length} stamped</span>
        {gold > 0 && <span className="muted small"> · {gold} gold</span>}
      </div>
      <button className="list-item action-row" style={{ margin: '12px 0 4px' }} onClick={() => navigate('study/quiz')}>
        Quiz me
      </button>
      {groups.map((g) => {
        const done = g.kanji.filter((k) => levels[k] > 0).length;
        return (
          <section key={g.grade}>
            <div className="section-head">
              <h2>{g.label}</h2>
              <span className="muted small num">
                {done} / {g.kanji.length}
              </span>
            </div>
            <div className="kgrid">
              {g.kanji.map((k) => (
                <button key={k} className={`kcell jp l${levels[k]}${levels[k] === 0 && data.seen.has(k) ? ' seen' : ''}`} onClick={() => setOpen(k)} aria-label={k}>
                  {k}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {open && info && (
        <Sheet onClose={() => setOpen(undefined)}>
          <div className="row" style={{ gap: 16, alignItems: 'center' }}>
            <Stamp kanji={open} level={levels[open] as Level} size={72} still />
            <div className="grow">
              <b>{info.meanings.slice(0, 4).join(', ')}</b>
              <div className="kanji-readings">
                <span className="muted small">On</span>
                <span className="jp">{info.on.length ? info.on.slice(0, 6).join('、') : '–'}</span>
                <span className="muted small">Kun</span>
                <span className="jp">{info.kun.length ? info.kun.slice(0, 6).map(kunShown).join('、') : '–'}</span>
              </div>
              <div className="muted small">{statusLine(levels[open], data.collection, open)}</div>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function statusLine(level: Level, c: Collection, k: string): string {
  const box = c.skill[k]?.box ?? 0;
  return [level === 2 ? 'Gold stamp' : level === 1 ? 'Stamped' : 'No stamp yet: the quiz gives it', box ? `quiz box ${box} of 3` : ''].filter(Boolean).join(' · ');
}
