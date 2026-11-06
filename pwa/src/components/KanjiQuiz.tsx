import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { loadKanjidic } from '../lib/japanese.ts';
import { loadCollection, saveRound, today, type Collection } from '../lib/kanjiSkill.ts';
import { navigate } from '../lib/hooks.ts';
import { Stamp } from './Stamp.tsx';
import { kanjiOf, type KanjiInfo } from '../../../shared/kanji.ts';
import { levelOf, pickKanji, questionsFor, type Level, type Question } from '../../../shared/kanjiSkill.ts';

// The kanji quiz: for each kanji its meaning and its reading, four choices each. Both right is one round, and a
// round is what raises a kanji's box (shared/kanjiSkill.ts). The first round gives the red stamp, on the spot.

const ROUND = 8;
type QuizSet = 'marks' | 'n5' | 'n4';
const SETS: { id: QuizSet; label: string }[] = [
  { id: 'marks', label: 'Kanji from my marks' },
  { id: 'n5', label: 'JLPT N5 kanji' },
  { id: 'n4', label: 'JLPT N4 kanji' },
];

type Dic = Record<string, KanjiInfo>;
type Item = { kanji: string; questions: Question[] };

/** The kanji of a set, most useful first. */
async function poolOf(set: QuizSet, dic: Dic): Promise<string[]> {
  if (set === 'n5') return Object.keys(dic).filter((k) => dic[k].jlpt === 4);
  if (set === 'n4') return Object.keys(dic).filter((k) => dic[k].jlpt === 3);
  const counts = new Map<string, number>();
  for (const m of await api.moments(300)) {
    if (m.status === 'discarded') continue;
    for (const c of kanjiOf(m.cardSentence ?? m.candidates[m.matchedIndex ?? 0]?.text ?? m.candidates[0]?.text ?? '')) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts].filter(([k]) => dic[k]).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export function KanjiQuiz() {
  const [dic, setDic] = useState<Dic>();
  const [collection, setCollection] = useState<Collection>();
  const [error, setError] = useState<string>();
  const [items, setItems] = useState<Item[]>();
  const [at, setAt] = useState({ item: 0, question: 0 });
  const [chosen, setChosen] = useState<string>();
  const [rightSoFar, setRightSoFar] = useState(true);
  const [earned, setEarned] = useState<{ kanji: string; level: Level }[]>([]);
  const [pressing, setPressing] = useState<{ kanji: string; level: Level }>();
  const [passed, setPassed] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([loadKanjidic(), loadCollection()]).then(
      ([d, c]) => (setDic(d), setCollection(c)),
      (e: Error) => setError(e.message),
    );
  }, []);

  async function start(set: QuizSet) {
    if (!dic || !collection) return;
    setBusy(true);
    setError(undefined);
    try {
      const pool = await poolOf(set, dic);
      const picked = pickKanji(pool, collection.skill, collection.evidence, today(), ROUND);
      if (!picked.length) throw new Error(set === 'marks' ? 'Nothing to quiz yet: mark some sentences first, or pick a JLPT set.' : 'Everything in this set has its stamp for today. Come back tomorrow, or pick another set.');
      // Wrong options come from the same set when it is big enough, else from the school kanji.
      const school = Object.keys(dic).filter((k) => (dic[k].grade ?? 99) <= 4);
      const choices = pool.length >= 12 ? pool : [...pool, ...school];
      const made = picked.map((kanji) => ({ kanji, questions: questionsFor(kanji, dic, choices) })).filter((i): i is Item => !!i.questions);
      if (!made.length) throw new Error('These kanji have no meaning or reading to ask for.');
      setItems(made);
      setAt({ item: 0, question: 0 });
      setChosen(undefined);
      setRightSoFar(true);
      setEarned([]);
      setPassed(0);
      setDone(false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const item = items?.[at.item];
  const question = item?.questions[at.question];

  async function next(correct: boolean) {
    if (!items || !item || !collection) return;
    const both = rightSoFar && correct;
    if (at.question === 0) {
      setAt({ ...at, question: 1 });
      setChosen(undefined);
      setRightSoFar(both);
      return;
    }
    // The kanji is finished: the round counts.
    const before = levelOf(collection.skill[item.kanji], collection.evidence[item.kanji]);
    const updated = await saveRound(collection, item.kanji, both);
    setCollection(updated);
    const after = levelOf(updated.skill[item.kanji], updated.evidence[item.kanji]);
    if (both) setPassed((n) => n + 1);
    const last = at.item === items.length - 1;
    const advance = () => {
      setPressing(undefined);
      if (last) return setDone(true);
      setAt({ item: at.item + 1, question: 0 });
      setChosen(undefined);
      setRightSoFar(true);
    };
    if (after > before) {
      setEarned((e) => [...e, { kanji: item.kanji, level: after }]);
      setPressing({ kanji: item.kanji, level: after });
      setTimeout(advance, 1100);
    } else advance();
  }

  function answer(option: string) {
    if (chosen !== undefined || !question) return;
    setChosen(option);
    const correct = option === question.answer;
    setTimeout(() => void next(correct), correct ? 650 : 1500);
  }

  if (error && !items)
    return (
      <div style={{ marginTop: 20 }}>
        <div className="banner error">{error}</div>
        {dic && collection && <Choose onPick={start} busy={busy} />}
      </div>
    );
  if (!dic || !collection)
    return (
      <p className="muted row small" style={{ marginTop: 24 }}>
        <span className="spinner" /> Loading the kanji…
      </p>
    );
  if (!items) return <Choose onPick={start} busy={busy} />;

  if (done)
    return (
      <div className="quiz-done">
        <p className="serif" style={{ fontSize: 28, margin: '24px 0 4px' }}>
          {passed} of {items.length} kanji right
        </p>
        {earned.length > 0 ? (
          <>
            <p className="muted small">New stamps</p>
            <div className="stamp-row">
              {earned.map((s, i) => (
                <Stamp key={s.kanji} kanji={s.kanji} level={s.level} delay={i * 220} size={56} />
              ))}
            </div>
          </>
        ) : (
          <p className="muted">No new stamp this round. A stamp needs both answers right; the next box comes on another day.</p>
        )}
        <div className="row" style={{ gap: 8, marginTop: 20 }}>
          <button className="grow" onClick={() => setItems(undefined)}>
            Another round
          </button>
          <button className="primary grow" onClick={() => navigate('study/kanji')}>
            Open the collection
          </button>
        </div>
      </div>
    );

  if (!item || !question) return null;
  return (
    <div className="quiz">
      <p className="muted small num">
        Kanji {at.item + 1} of {items.length} · {question.kind === 'meaning' ? 'What does it mean?' : 'How is it read?'}
      </p>
      <div className="quiz-kanji jp">{item.kanji}</div>
      <div className="quiz-options">
        {question.options.map((o) => {
          const state = chosen === undefined ? '' : o === question.answer ? ' right' : o === chosen ? ' wrong' : ' dim';
          return (
            <button key={o} className={`quiz-option${question.kind === 'reading' ? ' jp' : ''}${state}`} disabled={chosen !== undefined} onClick={() => answer(o)}>
              {o}
            </button>
          );
        })}
      </div>
      {pressing && (
        <div className="quiz-press" aria-live="polite">
          <Stamp kanji={pressing.kanji} level={pressing.level} size={120} />
        </div>
      )}
    </div>
  );
}

function Choose({ onPick, busy }: { onPick: (set: QuizSet) => void; busy: boolean }) {
  return (
    <div style={{ marginTop: 20 }}>
      <p className="hint">
        {ROUND} kanji a round: meaning and reading for each. Both right is a round won. The first one gives the red stamp, being right on three different days the gold one.
      </p>
      <div className="group">
        {SETS.map((s) => (
          <button key={s.id} className="list-item action-row" disabled={busy} onClick={() => onPick(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

