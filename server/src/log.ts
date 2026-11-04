import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

// The server usually runs hidden (autostart), so everything also goes to data/horu.log.

const LOG_FILE = path.join(DATA_DIR, 'horu.log');
const MAX_BYTES = 2 * 1024 * 1024;

try {
  if (fs.statSync(LOG_FILE).size > MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
} catch {
  // no log yet
}

function write(level: string, args: unknown[]): void {
  const text = args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} ${level} ${text}`;
  if (level !== 'DEBUG' || process.env.HORU_DEBUG) console.log(line);
  fs.appendFile(LOG_FILE, line + '\n', () => {});
}

export const log = {
  debug: (...args: unknown[]) => write('DEBUG', args),
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
};
