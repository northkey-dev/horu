import type { KanjiInfo } from './kanji.ts';

// What the reader can really read, kanji by kanji: the collection of stamps. A kanji earns a stamp only by being
// answered in the quiz (meaning and reading both right in a round). A round raises the kanji one box, at most once a
// day, so the gold stamp (box 3) takes three days of being right; a wrong round sets it back one box.
// Nothing else counts: not having seen the kanji, not a word in Anki (it is there after one review, forgotten or not),
// and not the JLPT starter list (an assumption).

export type Skill = { box: number; /** Day (YYYY-MM-DD) of the last round */ at: string; right: number; wrong: number };
export type SkillMap = Record<string, Skill>;
/** 0 nothing yet, 1 red stamp, 2 gold stamp */
export type Level = 0 | 1 | 2;

export const GOLD_BOX = 3;

export function levelOf(skill: Skill | undefined): Level {
  return !skill ? 0 : skill.box >= GOLD_BOX ? 2 : skill.box >= 1 ? 1 : 0;
}

/** The skill after a round. A right round counts for the box once per day; a wrong one always sets it back. */
export function afterRound(skill: Skill | undefined, correct: boolean, day: string): Skill {
  const s = skill ?? { box: 0, at: '', right: 0, wrong: 0 };
  if (!correct) return { box: Math.max(0, s.box - 1), at: day, right: s.right, wrong: s.wrong + 1 };
  return { box: s.at === day && s.box > 0 ? s.box : s.box + 1, at: day, right: s.right + 1, wrong: s.wrong };
}

/** Two copies of the skill (phone and laptop): per kanji the one with the later round wins, on a tie the higher box. */
export function mergeSkill(a: SkillMap, b: SkillMap): SkillMap {
  const out: SkillMap = { ...a };
  for (const [k, s] of Object.entries(b)) {
    const mine = out[k];
    if (!mine || s.at > mine.at || (s.at === mine.at && s.box > mine.box)) out[k] = s;
  }
  return out;
}

/**
 * The kanji for a quiz round: first those without a stamp, then stamped ones whose next box is due (not done today),
 * the lowest box first. `pool` is in the order of priority already (for example most frequent in your marks first).
 */
export function pickKanji(pool: string[], skill: SkillMap, day: string, count: number): string[] {
  const fresh = pool.filter((k) => levelOf(skill[k]) === 0);
  const due = pool
    .filter((k) => levelOf(skill[k]) > 0 && skill[k] && skill[k].box < GOLD_BOX && skill[k].at !== day)
    .sort((a, b) => skill[a].box - skill[b].box);
  return [...fresh, ...due].slice(0, count);
}

export type Question = { kanji: string; kind: 'meaning' | 'reading'; answer: string; options: string[] };

const stem = (kun: string) => kun.replace(/^-/, '').split('.')[0];

/** A kun'yomi as printed in dictionaries, the okurigana in brackets: ひ.く becomes ひ(く). */
export const kunShown = (kun: string): string => kun.replace(/\.(.+)$/, '($1)');

/** The reading used in the quiz for a kanji: its first on'yomi and kun'yomi, like カ · ひ. */
export function readingOf(info: KanjiInfo): string {
  const parts = [info.on[0], info.kun[0] && stem(info.kun[0])].filter(Boolean);
  return parts.join(' · ');
}

const meaningOf = (info: KanjiInfo) => info.meanings.slice(0, 2).join(', ');

function shuffle<T>(list: T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Two questions for a kanji (meaning, reading), each with four options. Wrong options come from other kanji of the
 * `pool`, so they look like real answers. Null when the kanji or the pool is too thin to ask.
 */
export function questionsFor(kanji: string, dic: Record<string, KanjiInfo>, pool: string[], rnd: () => number = Math.random): Question[] | null {
  const info = dic[kanji];
  if (!info?.meanings.length || (!info.on.length && !info.kun.length)) return null;
  const others = shuffle(pool.filter((k) => k !== kanji && dic[k]?.meanings.length && (dic[k].on.length || dic[k].kun.length)), rnd);
  const build = (kind: Question['kind'], text: (i: KanjiInfo) => string): Question | null => {
    const answer = text(info);
    const wrong: string[] = [];
    for (const k of others) {
      const t = text(dic[k]);
      if (t && t !== answer && !wrong.includes(t)) wrong.push(t);
      if (wrong.length === 3) break;
    }
    return wrong.length < 3 ? null : { kanji, kind, answer, options: shuffle([answer, ...wrong], rnd) };
  };
  const meaning = build('meaning', meaningOf);
  const reading = build('reading', readingOf);
  return meaning && reading ? [meaning, reading] : null;
}

export const GRADE_LABEL: Record<number, string> = { 1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4', 5: 'Grade 5', 6: 'Grade 6', 8: 'Secondary school' };

/** The 2136 jouyou kanji by school grade, the ones from the old JLPT levels first inside a grade. */
export function gradeGroups(dic: Record<string, KanjiInfo>): { grade: number; label: string; kanji: string[] }[] {
  const grades = Object.keys(GRADE_LABEL).map(Number);
  return grades.map((grade) => ({
    grade,
    label: GRADE_LABEL[grade],
    kanji: Object.keys(dic)
      .filter((k) => dic[k].grade === grade)
      .sort((a, b) => (dic[b].jlpt ?? 0) - (dic[a].jlpt ?? 0) || a.codePointAt(0)! - b.codePointAt(0)!),
  }));
}
