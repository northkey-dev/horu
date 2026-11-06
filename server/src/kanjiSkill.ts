import path from 'node:path';
import { DATA_DIR, writeJsonAtomic } from './config.ts';
import { readJsonKeepingDamaged } from './jsonFile.ts';
import { KANJI_CHAR } from '../../shared/kanji.ts';
import { mergeSkill, type SkillMap } from '../../shared/kanjiSkill.ts';

// The quiz progress per kanji (shared/kanjiSkill.ts). The phone is where the rounds happen; the laptop keeps a copy
// that is part of the backup, and a second phone picks it up from here.

const FILE = path.join(DATA_DIR, 'kanji-skill.json');
let skill: SkillMap = readJsonKeepingDamaged<SkillMap>(FILE, () => ({}));

export const getSkill = (): SkillMap => skill;

/** Only well-formed entries for single kanji get in. */
function clean(input: unknown): SkillMap {
  const out: SkillMap = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, Record<string, unknown>>)) {
    if ([...k].length !== 1 || !KANJI_CHAR.test(k) || !v || typeof v !== 'object') continue;
    const num = (x: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(x) || 0)));
    const at = /^\d{4}-\d{2}-\d{2}$/.test(String(v.at)) ? String(v.at) : '';
    out[k] = { box: num(v.box, 9), at, right: num(v.right, 100000), wrong: num(v.wrong, 100000) };
  }
  return out;
}

export function mergeIntoSkill(input: unknown): SkillMap {
  skill = mergeSkill(skill, clean(input));
  writeJsonAtomic(FILE, skill);
  return skill;
}
