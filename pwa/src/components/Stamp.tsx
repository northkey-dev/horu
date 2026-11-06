import type { CSSProperties } from 'react';
import type { Level } from '../../../shared/kanjiSkill.ts';

// A hanko stamp pressed onto a kanji: red once you can read it, gold once you can read it for good.

export function Stamp({ kanji, level, delay = 0, size = 64, still = false }: { kanji: string; level: Level; delay?: number; size?: number; still?: boolean }) {
  const style = { '--size': `${size}px`, animationDelay: `${delay}ms` } as CSSProperties;
  return (
    <span className={`stamp l${level}${still ? ' still' : ''}`} style={style} aria-label={level === 2 ? `${kanji}, gold stamp` : `${kanji}, stamp`}>
      <span className="jp">{kanji}</span>
    </span>
  );
}
