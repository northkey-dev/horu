import type { JimakuEntry } from './types.ts';

// Which anime and episode is a web page showing? No site list: a page announces it in many places (tab title,
// og:title, the player's media session, a heading, the address). Each text is read for an episode marker
// ("Episode 3", "EP03", "S2E5", "第3話", "#3"); the words before it are the title, minus site names and noise.
// Texts that agree vote. The laptop then looks the title up on Jimaku (matchEntry).

export type PageText = { text: string; weight: number };
export type Guess = { titles: string[]; episode?: number; season?: number };

// Words that tell about the page, not the show.
const NOISE = new Set([
  'watch', 'online', 'free', 'full', 'english', 'eng', 'sub', 'subs', 'subbed', 'dub', 'dubbed', 'hd', 'uncensored', 'anime', 'stream', 'streaming',
  'episode', 'episodes', 'ep', 'eps', 'watching', 'download', 'hindi', 'multi', 'cc', '720p', '1080p', '480p',
]);

const HARD_SEP = /\s*[|•·»«›‹]\s*|\s+::\s+|\s+[–—]\s+/;
const SOFT_SEP = /\s+-\s+/;
const DOMAIN = /^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,6}(?:\/\S*)?$/i;

const clean = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/_/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:sub|dub|hd|eng|english|subbed|dubbed|uncensored|tv|\d{3,4}p)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Marker = { start: number; end: number; episode?: number; season?: number };

/** The episode marker in a text (the first that matches, strongest pattern first). */
function findMarker(s: string): Marker | undefined {
  const tries: [RegExp, (m: RegExpExecArray) => { episode?: number; season?: number }][] = [
    [/\bS(\d{1,2})\s*[-. ]?\s*E(\d{1,3})\b/i, (m) => ({ season: +m[1], episode: +m[2] })],
    [/\bseason\s*(\d{1,2})\W{0,8}(?:episode|ep)\.?\s*#?\s*(\d{1,3})\b/i, (m) => ({ season: +m[1], episode: +m[2] })],
    [/\b(?:episode|episodio|épisode|folge|eps?)\.?\s*#?\s*0*(\d{1,4})(?!\d|\.\d)/i, (m) => ({ episode: +m[1] })],
    [/第\s*(\d{1,4})\s*話|エピソード\s*(\d{1,4})|(\d{1,4})\s*話/, (m) => ({ episode: +(m[1] ?? m[2] ?? m[3]) })],
    [/#\s*0*(\d{1,3})(?!\d)/, (m) => ({ episode: +m[1] })],
    [/\bE0*(\d{1,3})\b/, (m) => ({ episode: +m[1] })],
    [/\s-\s0*(\d{1,3})(?=\s|$)/, (m) => ({ episode: +m[1] })],
  ];
  for (const [re, pick] of tries) {
    const m = re.exec(s);
    if (m) return { start: m.index, end: m.index + m[0].length, ...pick(m) };
  }
  return undefined;
}

/** "Season 2", "2nd Season", "第2期" anywhere in a text. */
function findSeason(s: string): number | undefined {
  const m = /\bseason\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b|第\s*(\d{1,2})\s*期/i.exec(s);
  return m ? +(m[1] ?? m[2] ?? m[3]) : undefined;
}

const stripSeason = (s: string) => s.replace(/\bseason\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+season\b|第\s*\d{1,2}\s*期/gi, ' ');

function stripNoise(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  // Noise at the start ("Watch Berserk") and at the end ("Berserk English Subbed"), never in the middle of a title.
  while (words.length && NOISE.has(words[0].toLowerCase().replace(/\W/g, ''))) words.shift();
  while (words.length && NOISE.has(words[words.length - 1].toLowerCase().replace(/\W/g, ''))) words.pop();
  return words.join(' ').replace(/^[\s\-–—:,.|]+|[\s\-–—:,.|]+$/g, '').trim();
}

const usable = (s: string) => s.length >= 2 && !DOMAIN.test(s) && /[\p{L}\p{N}]/u.test(s) && !NOISE.has(s.toLowerCase());

/** Title variants of the words around a marker, most likely first. */
function titlesFrom(part: string): string[] {
  const out: string[] = [];
  const hard = part.split(HARD_SEP).map((p) => stripNoise(stripSeason(p))).filter(usable);
  // The segment next to the marker is the show; the rest is usually the site.
  const nearest = hard[hard.length - 1];
  if (nearest) {
    out.push(nearest);
    const soft = nearest.split(SOFT_SEP).map((p) => stripNoise(p)).filter(usable);
    if (soft.length > 1) out.push(soft[soft.length - 1], soft[0]);
  }
  for (const h of hard.slice(0, -1).reverse()) out.push(h);
  return [...new Set(out)];
}

/** Reads one text. Undefined when it names no show. */
export function parsePageText(raw: string): Guess | undefined {
  const s = clean(raw);
  if (!s) return undefined;
  const season = findSeason(s);
  const marker = findMarker(s);
  let titles: string[] = [];
  if (marker) {
    titles = titlesFrom(s.slice(0, marker.start));
    if (!titles.length) titles = titlesFrom(s.slice(marker.end));
  } else {
    titles = titlesFrom(s);
  }
  if (!titles.length) return undefined;
  return { titles, episode: marker?.episode, season: season ?? marker?.season };
}

const decoded = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // a stray % in the address
  }
};

/** The address' path as readable text: "/watch/berserk-1997-episode-3/" → "berserk 1997 episode 3". Ids and hashes drop out. */
export function textFromPath(pathname: string): string {
  return pathname
    .split('/')
    .flatMap((seg) => {
      let s = decoded(seg).replace(/\.[a-z0-9]{2,5}$/i, '');
      if (!/[a-z぀-鿿]{2}/i.test(s) && !/^(?:s\d+e\d+|e\d+|ep\d+)$/i.test(s)) return [];
      s = s.replace(/[-_+]+/g, ' ');
      return s
        .split(' ')
        .filter((w) => !/^\d{5,}$/.test(w) && !(/\d/.test(w) && /[a-z]/i.test(w) && w.length >= 8 && !/^(?:s\d+e\d+|e\d+|ep\d+|\d+(?:st|nd|rd|th))$/i.test(w)))
        .join(' ');
    })
    .filter(Boolean)
    .join(' / ');
}

/** The texts of a page vote: the show named most often, the episode most texts agree on. */
export function bestGuess(texts: PageText[]): Guess | undefined {
  const titleScore = new Map<string, { score: number; shown: string }>();
  const episodeVotes = new Map<number, number>();
  const seasonVotes = new Map<number, number>();
  for (const { text, weight } of texts) {
    // The path text has several segments ("watch / berserk episode 3"): each is read on its own.
    for (const part of text.split(' / ')) {
      const g = parsePageText(part);
      if (!g) continue;
      g.titles.forEach((t, i) => {
        const key = normalizeTitle(t);
        if (!key) return;
        const had = titleScore.get(key);
        titleScore.set(key, { score: (had?.score ?? 0) + weight / (i + 1), shown: had?.shown ?? t });
      });
      if (g.episode !== undefined) episodeVotes.set(g.episode, (episodeVotes.get(g.episode) ?? 0) + weight);
      if (g.season !== undefined) seasonVotes.set(g.season, (seasonVotes.get(g.season) ?? 0) + weight);
    }
  }
  const titles = [...titleScore.values()].sort((a, b) => b.score - a.score).map((t) => t.shown);
  if (!titles.length) return undefined;
  const top = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { titles: titles.slice(0, 4), episode: top(episodeVotes), season: top(seasonVotes) };
}

// ---- matching a title to a Jimaku entry ----

const STOP = new Set(['the', 'a', 'an', 'of', 'tv', 'season', 'part', 'cour', 'st', 'nd', 'rd', 'th', 'no', 'wa', 'ga', 'to']);

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const tokens = (s: string) => normalizeTitle(s).split(' ').filter((t) => t && !STOP.has(t));

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  if (normalizeTitle(a) === normalizeTitle(b)) return 1;
  const sb = new Set(tb);
  const common = ta.filter((t) => sb.has(t)).length;
  const dice = (2 * common) / (ta.length + tb.length);
  const contained = common === ta.length || common === tb.length;
  // A show name inside a longer entry name ("Berserk" in "Berserk (1997)") is a good sign, a little less than equal.
  return contained ? Math.max(dice, 0.85 - 0.01 * Math.abs(ta.length - tb.length)) : dice;
}

const names = (e: JimakuEntry) => [e.name, e.english_name, e.japanese_name].filter((n): n is string => Boolean(n));

/** Does this entry name say it is season n? ("… 2nd Season", "… Season 2", "… 2") */
function isSeason(name: string, n: number): boolean {
  const t = normalizeTitle(name);
  return new RegExp(`(?:^| )(?:season ${n}|${n}(?:st|nd|rd|th) season)(?: |$)|(?: )${n}$`).test(t);
}

export type EntryMatch = { entry: JimakuEntry; score: number; confident: boolean };

/** The best entry for a title (and season), or undefined without any resemblance. */
export function matchEntry(title: string, entries: JimakuEntry[], season?: number): EntryMatch | undefined {
  const scored = entries
    .map((entry) => {
      let score = Math.max(0, ...names(entry).map((n) => similarity(title, n)));
      if (season && season > 1) {
        const hit = names(entry).some((n) => isSeason(n, season));
        const first = names(entry).every((n) => !/\b(?:season|2nd|3rd|\d+th)\b/i.test(n) && !/\s\d$/.test(n));
        score += hit ? 0.1 : first ? -0.1 : 0;
      }
      return { entry, score };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best) return undefined;
  const sameShow = second && best.entry.anilist_id && best.entry.anilist_id === second.entry.anilist_id;
  const confident = best.score >= 0.8 && (!second || sameShow || second.score <= best.score - 0.08);
  return { entry: best.entry, score: best.score, confident };
}
