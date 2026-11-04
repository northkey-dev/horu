import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from '../../shared/types.ts';
import { DEFAULT_PROFILE } from '../../shared/ai.ts';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Optional settings in .env next to package.json. Values already in the environment win.
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch {
  // no .env
}

export const PORT = Number(process.env.HORU_PORT ?? 7317);
/** Your own hosted copy of the phone app (GitHub Pages fork). Empty: this service serves the app itself. */
export const APP_URL = (process.env.HORU_APP_URL ?? '').trim().replace(/\/*$/, '/').replace(/^\/$/, '');
export const APP_ORIGIN = APP_URL ? new URL(APP_URL).origin : undefined;

/** The release number, kept in the root package.json (Settings shows it for the laptop and the app). */
export const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as { version: string }).version;
export const DATA_DIR = path.resolve(ROOT_DIR, process.env.HORU_DATA ?? 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const SUBS_DIR = path.join(DATA_DIR, 'subs');
export const MANGA_DIR = path.join(DATA_DIR, 'manga');
export const DICT_DIR = path.join(DATA_DIR, 'dict');
export const PWA_DIST = path.join(ROOT_DIR, 'pwa', 'dist');
export const TOOLS_DIR = path.join(ROOT_DIR, 'tools');
export const VENV_PYTHON = process.platform === 'win32' ? path.join(TOOLS_DIR, '.venv', 'Scripts', 'python.exe') : path.join(TOOLS_DIR, '.venv', 'bin', 'python');

for (const dir of [DATA_DIR, MEDIA_DIR, SUBS_DIR, MANGA_DIR, DICT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS: Settings = {
  jimakuApiKey: '',
  deckName: 'Anime Mining',
  newCardsPerDay: 10,
  claudeModel: 'sonnet',
  // In a container (Raspberry Pi) the lighter model, and no Whisper run for every mark
  whisperModel: process.env.HORU_DOCKER ? 'small' : 'medium',
  bufferSeconds: 25,
  suwayomiUrl: 'http://127.0.0.1:4567',
  mangaPrefetchChapters: 15,
  mangaMaxActive: 5,
  mangaKeepReadDays: 3,
  knownWordsQuery: '',
  jlptBaseline: true,
  autoMatchWhisper: !process.env.HORU_DOCKER,
  kanjiCards: false,
  animeScreenshot: false,
  keepDays: 7,
  dailyGoalXp: 40,
  reminderEnabled: false,
  reminderTime: '19:00',
  backupFolder: '',
  prepBeforeWatch: true,
  prepBeforeRead: true,
  prepWordCount: 12,
  showAdultSources: false,
  mangaExtensionRepo: '',
  aiEngine: 'claude',
  aiApiKey: '',
  aiModel: '',
  ollamaUrl: 'http://127.0.0.1:11434',
  learnerProfile: DEFAULT_PROFILE,
  webhookUrl: '',
  jpdbApiKey: '',
  wanikaniToken: '',
  jpdbDeckId: '',
  anilistToken: '',
  playerKind: 'none',
  playerUrl: '',
  playerToken: '',
  mangaServerKind: 'none',
  mangaServerUrl: '',
  mangaServerKey: '',
  hookUrl: 'ws://127.0.0.1:6677',
};

let settings: Settings = { ...DEFAULT_SETTINGS };
try {
  settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
} catch {
  // first run
}

export function getSettings(): Settings {
  return settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const allowed = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
  const clean: Partial<Settings> = {};
  for (const key of allowed) {
    if (key in patch && typeof patch[key] === typeof DEFAULT_SETTINGS[key]) {
      (clean as Record<string, unknown>)[key] = patch[key];
    }
  }
  settings = { ...settings, ...clean };
  writeJsonAtomic(SETTINGS_FILE, settings);
  return settings;
}

/** Access token for clients that are neither on this machine nor behind `tailscale serve`. */
const TOKEN_FILE = path.join(DATA_DIR, 'token.txt');
export const ACCESS_TOKEN: string = (() => {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    const token = crypto.randomUUID().replaceAll('-', '');
    fs.writeFileSync(TOKEN_FILE, token);
    return token;
  }
})();

export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
