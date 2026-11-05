// Which daily backups to keep: the last few days in full, then one per week for a month. A year of daily copies
// would eat the disk and nobody restores one from March; a bad change noticed a week late is the real case.

/** Monday (YYYY-MM-DD) of the week a day falls in. */
function weekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * The days to keep out of `days` (YYYY-MM-DD): the newest `daily`, plus the newest backup of each of the
 * `weekly` earlier weeks that have one. Everything else can go.
 */
export function keepDays(days: string[], daily = 7, weekly = 4): string[] {
  const newestFirst = [...days].sort().reverse();
  const keep = newestFirst.slice(0, daily);
  const weeks = new Set(keep.map(weekOf));
  let older = 0;
  for (const day of newestFirst.slice(daily)) {
    const week = weekOf(day);
    if (weeks.has(week)) continue;
    weeks.add(week);
    keep.push(day);
    if (++older >= weekly) break;
  }
  return keep;
}
