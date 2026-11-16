// Finding the same chapter in the Japanese and the English edition of a manga. Sources and files name chapters
// in many ways ("第12話", "Chapter 12", "Ch. 12.5", "Vol. 3", "第3巻"); what counts is the number. Chapters
// match by chapter number; volumes (files from Komga/Kavita are often whole volumes) by volume number.

export type ChapterNo = { chapter?: number; volume?: number };

/** Full-width digits and dots (１２．５) as plain ones. */
const halfWidth = (s: string) => s.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const VOLUME = [new RegExp(String.raw`\bv(?:ol(?:ume)?)?\.?\s*${NUM}`), new RegExp(String.raw`第\s*${NUM}\s*巻`), new RegExp(String.raw`${NUM}\s*巻`)];
const CHAPTER = [
  new RegExp(String.raw`\b(?:chapter|chap|ch|episode|ep)\.?\s*${NUM}`),
  new RegExp(String.raw`#\s*${NUM}`),
  new RegExp(String.raw`第\s*${NUM}\s*[話回]`),
  new RegExp(String.raw`${NUM}\s*[話回]`),
];

const first = (patterns: RegExp[], text: string): number | undefined => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return Number(m[1]);
  }
  return undefined;
};

/** The chapter and volume number a chapter's name gives. A bare number ("Chainsaw Man 12") counts as the chapter. */
export function chapterNumbers(name: string): ChapterNo {
  const text = halfWidth(name).toLowerCase();
  const volume = first(VOLUME, text);
  let chapter = first(CHAPTER, text);
  if (chapter === undefined && volume === undefined) {
    const all = text.match(/\d+(?:\.\d+)?/g);
    if (all) chapter = Number(all[all.length - 1]);
  }
  return { chapter, volume };
}

/** Same chapter: both have a chapter number and it is the same, or both are whole volumes with the same number. */
export function sameChapter(a: ChapterNo, b: ChapterNo): boolean {
  if (a.chapter !== undefined && b.chapter !== undefined) return a.chapter === b.chapter;
  if (a.chapter === undefined && b.chapter === undefined && a.volume !== undefined) return a.volume === b.volume;
  return false;
}

/** A manga title without the volume or chapter a file name adds ("Chainsaw Man v01 [Viz]" → "Chainsaw Man"), to look it up. */
export function cleanTitle(title: string): string {
  return (
    halfWidth(title)
      .replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
      .replace(/\bv(?:ol(?:ume)?)?\.?\s*\d+.*$/i, ' ')
      .replace(/第?\s*\d+\s*巻.*$/, ' ')
      .replace(/[\s_\-–:]+\d+\s*$/, ' ')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || title.trim()
  );
}
