import { api } from './api.ts';
import { loadKanjidic } from './japanese.ts';
import { recall, remember } from './mirror.ts';
import { ownKnownWords } from './words.ts';
import { afterRound, evidenceOf, levelOf, mergeSkill, type Level, type SkillMap } from '../../../shared/kanjiSkill.ts';
import { kanjiOf } from '../../../shared/kanji.ts';

// The kanji collection on the phone: quiz progress (a copy lives on the laptop), the words you know that prove a
// kanji, and the small memories the chapter end needs. Works without the laptop.

export type Collection = { skill: SkillMap; evidence: Record<string, number> };

export const today = (): string => new Date().toLocaleDateString('sv');

/** The quiz progress and the evidence, fresh from the laptop when it answers, else as last saved. */
export async function loadCollection(): Promise<Collection> {
  const mine = (await recall<SkillMap>('kanji-skill'))?.value ?? {};
  let skill = mine;
  let evidence = (await recall<Record<string, number>>('kanji-evidence'))?.value ?? {};
  try {
    const theirs = await api.kanjiSkill();
    skill = mergeSkill(mine, theirs);
    evidence = await api.kanjiEvidence();
    void remember('kanji-evidence', evidence);
    if (JSON.stringify(skill) !== JSON.stringify(theirs)) void api.putKanjiSkill(skill).catch(() => undefined);
  } catch {
    // the laptop is away: what the phone has
  }
  void remember('kanji-skill', skill);
  const own = evidenceOf(await ownKnownWords());
  evidence = { ...evidence };
  for (const [k, n] of Object.entries(own)) evidence[k] = Math.max(evidence[k] ?? 0, n);
  return { skill, evidence };
}

export const levelsOf = (c: Collection, kanji: string[]): Record<string, Level> => Object.fromEntries(kanji.map((k) => [k, levelOf(c.skill[k], c.evidence[k])]));

/** Stamps the whole collection has: kanji at level 1 or 2 among the given ones. */
export const stampedCount = (levels: Record<string, Level>): number => Object.values(levels).filter((l) => l > 0).length;

/** Writes one finished round (meaning and reading both right, or not) and sends the progress to the laptop. */
export async function saveRound(c: Collection, kanji: string, correct: boolean): Promise<Collection> {
  const skill = { ...c.skill, [kanji]: afterRound(c.skill[kanji], correct, today()) };
  await remember('kanji-skill', skill);
  void api.putKanjiSkill(skill).catch(() => undefined);
  return { ...c, skill };
}

// ---- kanji met while reading ----

/** Kanji that appeared in what you read (finished chapters), kept as one string. */
export async function seenKanji(): Promise<Set<string>> {
  return new Set([...((await recall<string>('kanji-seen'))?.value ?? '')]);
}

export async function addSeen(kanji: string[]): Promise<void> {
  const all = await seenKanji();
  const before = all.size;
  kanji.forEach((k) => all.add(k));
  if (all.size !== before) await remember('kanji-seen', [...all].join(''));
}

// ---- the chapter end ----

export type Stamp = { kanji: string; level: Level; /** the level it had at the last chapter end */ was: Level };

/**
 * Stamps earned since the last chapter end, and how many kanji of this chapter can be read. The first time there is
 * nothing to compare with: the collection as it is becomes the starting point, so an old Anki history does not arrive
 * as one giant ceremony.
 */
export async function chapterStamps(words: string[]): Promise<{ stamps: Stamp[]; readable: { have: number; total: number }; collection: { count: number; total: number } }> {
  const c = await loadCollection();
  const dic = await loadKanjidic().catch(() => ({}) as Record<string, { grade?: number | null }>);
  const chapter = kanjiOf(words.join(''));
  void addSeen(chapter);
  const everything = Object.keys(dic).filter((k) => (dic[k].grade ?? 0) >= 1 && dic[k].grade! <= 8);
  const levels = levelsOf(c, [...new Set([...everything, ...Object.keys(c.skill), ...Object.keys(c.evidence)])]);
  const last = (await recall<Record<string, Level>>('kanji-levels'))?.value;
  const inCollection = new Set(everything);
  const now = Object.fromEntries(Object.entries(levels).filter(([k, l]) => l > 0 && inCollection.has(k)));
  void remember('kanji-levels', now);
  const stamps: Stamp[] = last
    ? Object.entries(now)
        .filter(([k, l]) => l > (last[k] ?? 0))
        .map(([kanji, level]) => ({ kanji, level, was: (last[kanji] ?? 0) as Level }))
        // gold last, so it is the one that lands at the end
        .sort((a, b) => a.level - b.level)
    : [];
  return {
    stamps,
    readable: { have: chapter.filter((k) => (levels[k] ?? 0) > 0).length, total: chapter.length },
    collection: { count: everything.filter((k) => (levels[k] ?? 0) > 0).length, total: everything.length },
  };
}
