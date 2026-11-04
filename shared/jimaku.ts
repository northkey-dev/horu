import { unzipSync } from 'fflate';
import { decodeSubtitleBytes, parseSubtitles } from './subtitles.ts';
import type { Cue, JimakuEntry, JimakuFile } from './types.ts';

// Client for https://jimaku.cc (free API key from the account page). Shared by the laptop and the phone;
// Jimaku allows calls straight from the browser, and downloads need no key.

const BASE = 'https://jimaku.cc/api';
const SUBTITLE_EXT = /\.(srt|ass|ssa|vtt)$/i;

export function jimakuClient(getKey: () => string, base = BASE) {
  async function api<T>(pathAndQuery: string): Promise<T> {
    const key = getKey();
    if (!key) throw new Error('Jimaku API key missing (Settings).');
    const res = await fetch(base + pathAndQuery, { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Jimaku ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  return {
    searchEntries: (query: string) => api<JimakuEntry[]>(`/entries/search?anime=true&query=${encodeURIComponent(query)}`),

    async listFiles(entryId: number, episode: number): Promise<JimakuFile[]> {
      const files = await api<JimakuFile[]>(`/entries/${entryId}/files?episode=${episode}`);
      // Plain subtitle files first, archives last; SRT before ASS (cleaner text).
      const rank = (f: JimakuFile) => (/\.srt$/i.test(f.name) ? 0 : SUBTITLE_EXT.test(f.name) ? 1 : 2);
      return files.sort((a, b) => rank(a) - rank(b));
    },

    async downloadCues(file: JimakuFile, episode: number): Promise<{ name: string; cues: Cue[] }> {
      const res = await fetch(file.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return cuesFromUpload(file.name, new Uint8Array(await res.arrayBuffer()), episode);
    },
  };
}

/** True if a file name looks like it belongs to the given episode number. */
export function matchesEpisode(name: string, episode: number): boolean {
  const n = String(episode);
  const padded = n.padStart(2, '0');
  const patterns = [
    new RegExp(`(?:^|[^0-9])(?:e|ep|episode|#)\\s*0*${n}(?:[^0-9]|$)`, 'i'),
    new RegExp(`第0*${n}話`),
    new RegExp(`(?:^|[ _\\-\\[(.])0*${padded}(?:v\\d)?(?:[ _\\-\\])\\.]|$)`),
  ];
  return patterns.some((p) => p.test(name));
}

/** Accepts a subtitle file or a zip archive containing one per episode. */
export function cuesFromUpload(name: string, bytes: Uint8Array, episode?: number): { name: string; cues: Cue[] } {
  if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const entries = Object.entries(unzipSync(bytes)).filter(([n]) => SUBTITLE_EXT.test(n) && !n.startsWith('__MACOSX'));
    if (!entries.length) throw new Error('Archive contains no subtitle files.');
    const pick =
      (episode !== undefined && entries.find(([n]) => matchesEpisode(n.split('/').pop()!, episode))) ||
      (entries.length === 1 ? entries[0] : undefined);
    if (!pick) throw new Error(`No file for episode ${episode} in archive.`);
    return { name: pick[0].split('/').pop()!, cues: parseSubtitles(pick[0], decodeSubtitleBytes(pick[1])) };
  }
  return { name, cues: parseSubtitles(name, decodeSubtitleBytes(bytes)) };
}
