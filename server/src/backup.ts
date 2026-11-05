import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { keepDays } from './retention.ts';
import express, { type Request, type Response } from 'express';
import { DATA_DIR, SECRET_SETTINGS, getSettings } from './config.ts';
import { dayKey } from './analytics.ts';
import { log } from './log.ts';
import { flush } from './store.ts';

// Daily copy of everything Horu cannot rebuild: moments and sessions, settings, known words, vocabulary and
// Anki history, push keys. Media, dictionaries and manga are large and can be fetched again, so they stay out.

const FILES = ['db.json', 'settings.json', 'known.json', 'vocab-history.json', 'analytics-anki.json', 'manga.json', 'push.json', 'token.txt', 'reading.json', 'prepared.json', 'kanji-cards.json'];
// Grows with every answer of the AI and is only text: stored packed (about a tenth of the size).
const PACKED = ['ai-log.jsonl'];
const SUBFOLDERS = ['subs'];
// The extra folder is usually synced to a cloud, so it gets no secrets: no access token, no push keys, no API key.
const SECRET_FILES = new Set(['token.txt', 'push.json']);
const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;
const BACKUPS = path.join(DATA_DIR, 'backups');

function copyInto(target: string, withSecrets: boolean): void {
  fs.mkdirSync(target, { recursive: true });
  for (const f of FILES) {
    const from = path.join(DATA_DIR, f);
    if (!fs.existsSync(from) || (!withSecrets && SECRET_FILES.has(f))) continue;
    if (!withSecrets && f === 'settings.json') {
      fs.writeFileSync(path.join(target, f), JSON.stringify({ ...JSON.parse(fs.readFileSync(from, 'utf8')), ...Object.fromEntries(SECRET_SETTINGS.map((k) => [k, ''])) }, null, 2));
    } else fs.copyFileSync(from, path.join(target, f));
  }
  for (const f of PACKED) {
    const from = path.join(DATA_DIR, f);
    if (fs.existsSync(from)) fs.writeFileSync(path.join(target, `${f}.gz`), zlib.gzipSync(fs.readFileSync(from)));
  }
  for (const d of SUBFOLDERS) {
    const from = path.join(DATA_DIR, d);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(target, d), { recursive: true });
  }
}

function prune(root: string): void {
  const dirs = fs.readdirSync(root).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n));
  const keep = new Set(keepDays(dirs, KEEP_DAILY, KEEP_WEEKLY));
  for (const old of dirs.filter((d) => !keep.has(d))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
}

/** Writes today's backup (replacing an earlier one of the same day). Returns where it went. */
export function backupNow(): string[] {
  flush();
  const name = dayKey(Date.now());
  const targets = [BACKUPS];
  const extra = getSettings().backupFolder.trim();
  if (extra) targets.push(path.join(extra, 'Horu backup'));
  const written: string[] = [];
  for (const root of targets) {
    try {
      copyInto(path.join(root, name), root === BACKUPS);
      prune(root);
      written.push(path.join(root, name));
    } catch (err) {
      log.warn(`Backup to ${root} failed:`, (err as Error).message);
      if (root !== BACKUPS) throw new Error(`Could not write to ${root}: ${(err as Error).message}`);
    }
  }
  return written;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The days that have a backup, newest first. */
export const backupDays = (): string[] => (fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS).filter((n) => DAY.test(n)).sort().reverse() : []);

/**
 * Puts a daily backup back into data/ and restarts the server (the running process holds the old state in
 * memory and would overwrite it). The current state is kept first as "before-restore-…", the latest three stay.
 */
export function restore(day: string): void {
  if (!DAY.test(day)) throw new Error('Invalid backup');
  const source = path.join(BACKUPS, day);
  if (!fs.existsSync(source)) throw new Error('No such backup');
  flush();
  copyInto(path.join(BACKUPS, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`), true);
  const safety = fs.readdirSync(BACKUPS).filter((n) => n.startsWith('before-restore-')).sort();
  for (const old of safety.slice(0, Math.max(0, safety.length - 3))) fs.rmSync(path.join(BACKUPS, old), { recursive: true, force: true });
  for (const f of FILES) {
    const from = path.join(source, f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DATA_DIR, f));
  }
  for (const f of PACKED) {
    const packed = path.join(source, `${f}.gz`);
    if (fs.existsSync(packed)) fs.writeFileSync(path.join(DATA_DIR, f), zlib.gunzipSync(fs.readFileSync(packed)));
  }
  for (const d of SUBFOLDERS) {
    const from = path.join(source, d);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(DATA_DIR, d), { recursive: true });
  }
  log.info(`Restored backup ${day}; restarting`);
  // Not exit(0): the launcher reads that as "another instance owns the port" and stops supervising.
  setTimeout(() => process.exit(1), 500);
}

export function startBackups(): void {
  const run = () => {
    const today = path.join(BACKUPS, dayKey(Date.now()));
    if (fs.existsSync(today)) return;
    try {
      log.info(`Backup written: ${backupNow().join(', ')}`);
    } catch (err) {
      log.warn('Backup:', (err as Error).message);
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, 3 * 3_600_000).unref();
}

const h =
  (fn: (req: Request) => unknown) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  };

export function backupRouter(): express.Router {
  const r = express.Router();
  r.use(express.json());
  r.get('/', h(() => ({ days: backupDays(), keep: KEEP_DAILY + KEEP_WEEKLY })));
  r.post('/', h(() => ({ written: backupNow() })));
  r.post(
    '/restore',
    h((req) => {
      restore(String(req.body?.day ?? ''));
      return { ok: true };
    }),
  );
  return r;
}
