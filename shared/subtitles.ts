import type { Candidate, Cue } from './types.ts';

// Parsers for the subtitle formats found on Jimaku: SRT, WebVTT and ASS/SSA. Shared by the laptop and the
// phone (which loads subtitles itself when it watches without the laptop).

function parseTimestamp(raw: string): number {
  // 00:01:02,345 | 00:01:02.345 | 01:02.345 | 0:01:02.34 (ASS)
  const parts = raw.trim().replace(',', '.').split(':').map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds;
}

function cleanText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, '') // ASS override tags
    .replace(/<[^>]+>/g, '') // HTML-ish tags (SRT/VTT)
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function parseSrtOrVtt(content: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = content.replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [from, to] = lines[timeIdx].split('-->');
    const text = cleanText(lines.slice(timeIdx + 1).join('\n'));
    if (!text) continue;
    cues.push({ start: parseTimestamp(from), end: parseTimestamp(to.trim().split(/\s+/)[0]), text });
  }
  return cues;
}

export function parseAss(content: string): Cue[] {
  const cues: Cue[] = [];
  let format: string[] = [];
  let inEvents = false;
  for (const rawLine of content.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inEvents = line.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) continue;
    if (line.startsWith('Format:')) {
      format = line.slice(7).split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!line.startsWith('Dialogue:')) continue;
    const fields = line.slice(9).split(',');
    const textIdx = format.indexOf('text');
    const get = (name: string) => fields[format.indexOf(name)]?.trim() ?? '';
    const text = cleanText(fields.slice(textIdx).join(','));
    // Drawing commands ({\p1}) produce gibberish; skip lines without any Japanese/latin letters.
    if (!text || !/[\p{L}]/u.test(text)) continue;
    cues.push({ start: parseTimestamp(get('start')), end: parseTimestamp(get('end')), text });
  }
  return cues;
}

export function parseSubtitles(name: string, content: string): Cue[] {
  const cues = /\.(ass|ssa)$/i.test(name) ? parseAss(content) : parseSrtOrVtt(content);
  cues.sort((a, b) => a.start - b.start);
  // Merge exact duplicates (ASS files often layer the same line twice).
  const out: Cue[] = [];
  for (const cue of cues) {
    const prev = out[out.length - 1];
    if (prev && prev.text === cue.text && Math.abs(prev.start - cue.start) < 0.05) continue;
    out.push(cue);
  }
  return out;
}

export function decodeSubtitleBytes(bytes: Uint8Array): string {
  // UTF-8 (with/without BOM) or UTF-16 LE/BE. Japanese SRTs are occasionally Shift_JIS.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/**
 * Lines that were spoken around a button press. People press *after* hearing a
 * line, so the window reaches further into the past than into the future.
 */
export function candidatesAt(cues: Cue[], videoTime: number, bufferSeconds: number): Candidate[] {
  const from = videoTime - Math.min(bufferSeconds, 15);
  const to = videoTime + 1.5;
  const hits = cues.filter((c) => c.end >= from && c.start <= to);
  return hits.slice(-6).map((c) => ({ ...c, source: 'subs' as const }));
}
