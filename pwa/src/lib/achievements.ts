import type { Analytics } from '../../../shared/types.ts';

// Achievement series: every series has tiers; the seal shows how many are reached (I, II, III …).

export type Series = {
  id: string;
  kanji: string;
  title: string;
  /** what the number counts, e.g. "days" */
  unit: string;
  tiers: number[];
  /** optional names for the tiers (vocabulary: JLPT levels) */
  names?: string[];
  value: (a: Analytics) => number;
};

export const SERIES: Series[] = [
  { id: 'streak', kanji: '継', title: 'Streak', unit: 'days in a row', tiers: [3, 7, 14, 30, 60, 100, 365], value: (a) => a.streak.best },
  { id: 'cards', kanji: '札', title: 'Cards', unit: 'cards created', tiers: [1, 10, 25, 50, 100, 250, 500, 1000], value: (a) => a.totals.cards },
  { id: 'reviews', kanji: '復', title: 'Reviews', unit: 'Anki reviews', tiers: [100, 500, 1000, 2500, 5000, 10000, 25000], value: (a) => a.totals.reviews },
  {
    id: 'words',
    kanji: '語',
    title: 'Vocabulary',
    unit: 'known words',
    tiers: [800, 1500, 3750, 6000, 10000],
    names: ['N5', 'N4', 'N3', 'N2', 'N1'],
    value: (a) => a.totals.knownWords,
  },
  { id: 'episodes', kanji: '観', title: 'Episodes', unit: 'episodes watched', tiers: [1, 5, 10, 25, 50, 100], value: (a) => a.totals.episodes },
  { id: 'manga', kanji: '読', title: 'Manga', unit: 'chapters read', tiers: [1, 5, 10, 25, 50, 100], value: (a) => a.totals.chapters },
  { id: 'time', kanji: '時', title: 'Study time', unit: 'hours in Anki', tiers: [1, 5, 10, 25, 50, 100], value: (a) => Math.floor(a.totals.minutes / 60) },
  { id: 'level', kanji: '階', title: 'Level', unit: 'level', tiers: [2, 3, 5, 10, 15, 20], value: (a) => a.level.n },
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export function progress(s: Series, a: Analytics) {
  const value = s.value(a);
  const reached = s.tiers.filter((t) => value >= t).length;
  const next = s.tiers[reached];
  const prev = reached ? s.tiers[reached - 1] : 0;
  return {
    value,
    reached,
    roman: ROMAN[reached] ?? String(reached),
    next,
    fraction: next === undefined ? 1 : Math.max(0, Math.min(1, (value - prev) / (next - prev))),
    label: reached ? s.names?.[reached - 1] : undefined,
  };
}

/** Rough vocabulary sizes of the JLPT levels (cumulative), for orientation only. */
export const JLPT_STEPS = [
  { level: 'N5', words: 800 },
  { level: 'N4', words: 1500 },
  { level: 'N3', words: 3750 },
  { level: 'N2', words: 6000 },
  { level: 'N1', words: 10000 },
];
