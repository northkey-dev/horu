// How much of a chapter the reader understood, and the line that shows it growing from chapter to chapter.

/** Share (0..1) of the word occurrences in `words` that `understood` covers; 0 for an empty list. */
export function coverageOf(words: string[], understood: ReadonlySet<string>): number {
  if (!words.length) return 0;
  let known = 0;
  for (const w of words) if (understood.has(w)) known++;
  return known / words.length;
}

/** Different words that are understood now and were not before. */
export function learnedBetween(words: string[], before: ReadonlySet<string>, after: ReadonlySet<string>): number {
  return new Set(words.filter((w) => after.has(w) && !before.has(w))).size;
}

export type Curve = { path: string; dots: { x: number; y: number }[] };

/**
 * A smooth line through one value (0..100) per chapter, for an SVG of `w` x `h`. The scale stretches over the
 * values read so far, so a climb from 61 to 94 fills the height instead of hugging the top.
 */
export function curveOf(values: number[], w: number, h: number, pad = 8): Curve {
  if (!values.length) return { path: '', dots: [] };
  const lo = Math.max(0, Math.min(...values) - 8);
  const hi = Math.min(100, Math.max(...values) + 4);
  const span = Math.max(hi - lo, 12);
  const dots = values.map((v, i) => ({
    x: values.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (values.length - 1),
    y: pad + (1 - (v - lo) / span) * (h - 2 * pad),
  }));
  let path = `M${dots[0].x.toFixed(1)} ${dots[0].y.toFixed(1)}`;
  for (let i = 1; i < dots.length; i++) {
    const [a, b] = [dots[i - 1], dots[i]];
    const mx = ((a.x + b.x) / 2).toFixed(1);
    path += ` C${mx} ${a.y.toFixed(1)} ${mx} ${b.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return { path, dots };
}
