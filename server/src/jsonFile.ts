import fs from 'node:fs';

/**
 * Reads a JSON file of ours. Missing is normal (first start). A damaged one is copied aside before the fallback is
 * used, otherwise the next save would overwrite whatever could still be rescued from it.
 */
export function readJsonKeepingDamaged<T>(file: string, fallback: () => T): T {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return fallback();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const copy = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, copy);
    console.error(`Horu: ${file} is damaged. It was kept as ${copy}; Settings → Backup can restore a daily copy.`);
    return fallback();
  }
}
