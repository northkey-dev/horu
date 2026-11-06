import { useEffect, useState } from 'react';
import { curveOf } from '../../../shared/chapterScore.ts';
import type { Stamp } from '../lib/kanjiSkill.ts';
import { Stamp as StampMark } from './Stamp.tsx';

// The end of a chapter: one number, how it grew over this manga, one button. Nothing else.

type Props = {
  title: string;
  chapter: string;
  pct: number;
  /** Understanding per chapter of this manga read so far, oldest first; the last is this chapter */
  history: number[];
  /** Kanji of this chapter you can read (a stamp), out of all in it */
  readable?: { have: number; total: number };
  /** Stamps earned since the last chapter end, the gold ones last */
  stamps: Stamp[];
  collection?: { count: number; total: number };
  hasNext: boolean;
  onNext: () => void;
  onBack: () => void;
};

/** 0 to `to` over about a second, easing out; at once when the phone asks for less motion. */
function useCountUp(to: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setValue(to);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      setValue(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return value;
}

const W = 280;
const H = 76;

export function ChapterDone({ title, chapter, pct, history, readable, stamps, collection, hasNext, onNext, onBack }: Props) {
  // First the result; with new stamps, a second step presses them one by one into the collection.
  const [step, setStep] = useState<'result' | 'stamps'>('result');
  const shown = useCountUp(pct);
  const curve = curveOf(history, W, H);
  const last = curve.dots[curve.dots.length - 1];
  const buttons = (
    <div className="cd-actions">
      {hasNext && (
        <button className="primary" onClick={onNext}>
          Next chapter
        </button>
      )}
      <button className="ghost" onClick={onBack}>
        Back to the chapters
      </button>
    </div>
  );

  if (step === 'stamps' && collection) {
    const show = stamps.slice(-15);
    return (
      <div className="chapter-done" role="dialog" aria-label="New stamps">
        <div className="cd-title">
          {stamps.length} new stamp{stamps.length === 1 ? '' : 's'}
        </div>
        <div className="stamp-row cd-stamps">
          {show.map((s, i) => (
            <StampMark key={s.kanji} kanji={s.kanji} level={s.level} delay={300 + i * 260} size={show.length > 6 ? 56 : 72} />
          ))}
        </div>
        {stamps.length > show.length && <div className="cd-caption">and {stamps.length - show.length} more</div>}
        <StampCount from={Math.max(0, collection.count - stamps.length)} to={collection.count} total={collection.total} delay={300 + show.length * 260} />
        {buttons}
      </div>
    );
  }

  return (
    <div className="chapter-done" role="dialog" aria-label="Chapter finished">
      <div className="cd-seal jp" aria-hidden="true">
        読了
      </div>
      <div className="cd-title ellipsis">
        {title} · {chapter}
      </div>
      <div className="cd-number serif num">
        {shown}
        <span>%</span>
      </div>
      <div className="cd-label">of the words understood</div>
      {history.length > 1 && last ? (
        <>
          <svg className="cd-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Understanding per chapter: ${history.join(', ')} percent`}>
            <path d={curve.path} />
            <circle cx={last.x} cy={last.y} r="9" className="halo" />
            <circle cx={last.x} cy={last.y} r="4.5" />
          </svg>
          <div className="cd-caption">
            {history[0]}% → {pct}% since you started this manga
          </div>
        </>
      ) : (
        <div className="cd-caption">Your first chapter here. Next time you will see how it grows.</div>
      )}
      {readable && readable.have > 0 && (
        <div className="cd-caption">
          You can read {readable.have} of {readable.total} kanji in this chapter
        </div>
      )}
      {stamps.length > 0 && collection ? (
        <div className="cd-actions">
          <button className="primary" onClick={() => setStep('stamps')}>
            See your {stamps.length} new stamp{stamps.length === 1 ? '' : 's'}
          </button>
          <button className="ghost" onClick={hasNext ? onNext : onBack}>
            {hasNext ? 'Skip to the next chapter' : 'Back to the chapters'}
          </button>
        </div>
      ) : (
        buttons
      )}
    </div>
  );
}

/** The collection counter ticking up to its new value once the stamps have landed. */
function StampCount({ from, to, total, delay }: { from: number; to: number; total: number; delay: number }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setValue(to);
    let frame = 0;
    const begin = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - begin) / 900));
      setValue(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, delay]);
  return (
    <div className="cd-number serif num cd-count">
      {value}
      <span> / {total}</span>
    </div>
  );
}
