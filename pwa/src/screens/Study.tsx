import { Nav } from '../components/Nav.tsx';
import { navigate } from '../lib/hooks.ts';
import { Practice } from './Practice.tsx';
import { Kanji } from './Kanji.tsx';
import { Insights } from './Insights.tsx';

// The Study tab: what you do (practice), what you collect (kanji) and how you are doing (progress).

export type Part = 'practice' | 'kanji' | 'progress';

const PARTS: { id: Part; label: string; path: string }[] = [
  { id: 'practice', label: 'Practice', path: 'study' },
  { id: 'kanji', label: 'Kanji', path: 'study/kanji' },
  { id: 'progress', label: 'Progress', path: 'study/progress' },
];

/** Which part a route opens; the old addresses (insights, practice, kanji) keep working. */
export function partOf(page: string, arg?: string): { part: Part; quiz: boolean } {
  if (page === 'insights' || arg === 'progress') return { part: 'progress', quiz: false };
  if (page === 'kanji' || arg === 'kanji') return { part: 'kanji', quiz: false };
  return { part: 'practice', quiz: arg === 'quiz' };
}

export function Study({ part, quiz }: { part: Part; quiz: boolean }) {
  return (
    <div>
      <Nav />
      <h1>Study</h1>
      <div className="segmented tabs" role="tablist" aria-label="Study">
        {PARTS.map((p) => (
          <button key={p.id} role="tab" aria-selected={part === p.id} className={part === p.id ? 'on' : ''} onClick={() => navigate(p.path)}>
            {p.label}
          </button>
        ))}
      </div>
      {part === 'practice' && <Practice embedded startOn={quiz ? 'quiz' : undefined} />}
      {part === 'kanji' && <Kanji embedded />}
      {part === 'progress' && <Insights embedded />}
    </div>
  );
}
