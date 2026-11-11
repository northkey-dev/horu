import fs from 'node:fs';
import { getSettings } from './config.ts';
import { wavToMp3 } from './audio.ts';
import { candidatesAt } from '../../shared/subtitles.ts';
import { sendToExtension } from './extensionHub.ts';
import { transcribe, whisperAvailable } from './whisper.ts';
import { log } from './log.ts';
import * as store from './store.ts';
import type { Candidate, ExtMomentMeta, Moment } from '../../shared/types.ts';

const CAPTURE_TIMEOUT_MS = 12_000;
const MIN_SYNC_OFFSET = 1.5; // below this the subtitles count as in sync (whisper timestamps are not that exact)
const MAX_SYNC_OFFSET = 15;

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Phone button pressed. Asks the extension to deliver the last N seconds. */
export function markMoment(): Moment {
  const session = store.activeSession();
  if (!session) throw new Error('No episode selected.');
  const moment = store.addMoment({
    id: store.newId(),
    kind: 'anime',
    createdAt: new Date().toISOString(),
    status: 'capturing',
    sessionId: session.id,
    title: session.title,
    episode: session.episode,
    sourceLabel: `${session.title} · Ep ${session.episode}`,
    hasAudio: false,
    hasImage: false,
    candidates: [],
  });
  if (!sendToExtension({ type: 'mark', momentId: moment.id, seconds: getSettings().bufferSeconds })) {
    store.deleteMoment(moment.id);
    throw new Error('Chrome extension is not recording. Click the Horu icon in Chrome.');
  }
  setTimeout(() => {
    if (store.getMoment(moment.id)?.status === 'capturing') {
      store.updateMoment(moment.id, { status: 'error', error: 'The Chrome extension did not respond.' });
    }
  }, CAPTURE_TIMEOUT_MS);
  return moment;
}

/** Removes the newest moment of the running session (the phone's Undo button). */
export function undoLastMoment(): Moment | undefined {
  const session = store.activeSession();
  const last = store.listMoments((m) => m.sessionId === session?.id && store.INBOX_STATUSES.has(m.status))[0];
  if (!last || Date.now() - Date.parse(last.createdAt) > 15 * 60_000) return undefined;
  store.deleteMoment(last.id);
  return last;
}

/** Audio + metadata delivered by the extension for a pending moment. */
export async function receiveCapture(id: string, meta: ExtMomentMeta, wav: Buffer | undefined): Promise<void> {
  const moment = store.getMoment(id);
  if (!moment) return; // removed with Undo before the audio arrived
  const patch: Partial<Moment> = {};

  if (meta.screenshot?.startsWith('data:image/')) {
    fs.writeFileSync(store.mediaPath(id, 'jpg'), Buffer.from(meta.screenshot.split(',')[1], 'base64'));
    patch.hasImage = true;
  }
  if (wav?.length) {
    fs.writeFileSync(store.mediaPath(id, 'wav'), wav);
    await wavToMp3(store.mediaPath(id, 'wav'), store.mediaPath(id, 'mp3'));
    patch.hasAudio = true;
  }

  const bufferSeconds = meta.bufferSeconds || getSettings().bufferSeconds;
  patch.audioDuration = bufferSeconds;
  if (meta.videoTime === null || !Number.isFinite(meta.videoTime)) {
    patch.error = `Chrome could not read the video position, so the subtitle lines cannot be matched. Whisper transcribes what was said instead.${meta.videoDiag ? ` Chrome saw: ${meta.videoDiag}` : ''}`;
  } else {
    patch.videoTime = meta.videoTime;
    patch.audioStart = meta.videoTime - bufferSeconds;
    patch.sourceLabel = `${moment.title} · Ep ${moment.episode} · ${formatTime(meta.videoTime)}`;
    patch.candidates = candidatesAt(store.sessionCues(moment.sessionId!), meta.videoTime, bufferSeconds);
  }
  store.updateMoment(id, patch);

  if (!patch.candidates?.length && patch.hasAudio && whisperAvailable()) {
    void runWhisper(id);
  } else {
    store.updateMoment(id, { status: 'ready' });
    if (patch.candidates?.length && patch.hasAudio && whisperAvailable() && getSettings().autoMatchWhisper) void autoMatch(id);
  }
}

function bigrams(s: string): Map<string, number> {
  const clean = s.replace(/[\s、。！？!?…「」『』（）()・〜ー]/g, '');
  const out = new Map<string, number>();
  for (let i = 0; i < clean.length - 1; i++) out.set(clean.slice(i, i + 2), (out.get(clean.slice(i, i + 2)) ?? 0) + 1);
  return out;
}

/** Share of the candidate's bigrams that whisper heard (robust to small transcription errors). */
function recall(candidate: string, heard: string): number {
  const c = bigrams(candidate);
  const h = bigrams(heard);
  let total = 0;
  let hit = 0;
  for (const [g, n] of c) {
    total += n;
    hit += Math.min(n, h.get(g) ?? 0);
  }
  return total ? hit / total : 0;
}

/**
 * Whisper listens to the last seconds and picks the subtitle line that was
 * actually spoken right before the press (handles off-sync subtitles). The
 * last spoken segment decides; if whisper merged several lines into it, the
 * later line wins because that is what the user just heard.
 */
async function autoMatch(id: string): Promise<void> {
  try {
    const moment = store.getMoment(id);
    if (!moment?.candidates.length) return;
    const segments = await transcribe(store.mediaPath(id, 'wav'));
    for (const segment of segments.slice(-2).reverse()) {
      const current = store.getMoment(id);
      if (!current || current.status !== 'ready') return;
      let best = -1;
      current.candidates.forEach((c, i) => {
        if (recall(c.text, segment.text) >= 0.5 && (best < 0 || c.start >= current.candidates[best].start)) best = i;
      });
      if (best >= 0) {
        const patch: Partial<Moment> = { matchedIndex: best };
        // Subtitles of another release run early or late. Whisper's segment end (when the line was really
        // spoken) against the cue end gives the shift, used to cut the audio clip in the right place.
        if (current.audioStart !== undefined && current.candidates[best].source === 'subs') {
          const offset = current.audioStart + segment.end - current.candidates[best].end;
          if (Math.abs(offset) >= MIN_SYNC_OFFSET && Math.abs(offset) <= MAX_SYNC_OFFSET) patch.syncOffset = Math.round(offset * 10) / 10;
        }
        store.updateMoment(id, patch);
        return;
      }
    }
    // Nothing on offer is even close to what was said: these are not the subtitles of this audio (Netflix has a
    // freely translated Japanese track next to the closed captions, YouTube has speech recognition). The
    // heard line goes in as a candidate of its own and is preselected; the subtitle lines stay available.
    const current = store.getMoment(id);
    // (Whisper invents "thanks for watching" over silence: never a line to offer.)
    const heard = segments.filter((s) => s.text.replace(/[^぀-ヿ一-鿿]/g, '').length >= 4 && !/ご視聴|チャンネル登録/.test(s.text)).slice(-2);
    if (current?.status === 'ready' && heard.length && current.candidates.every((c) => heard.every((h) => recall(c.text, h.text) < 0.25))) {
      const base = current.audioStart ?? 0;
      const extra: Candidate[] = heard.map((s) => ({ start: base + s.start, end: base + s.end, text: s.text, source: 'whisper' }));
      store.updateMoment(id, { candidates: [...current.candidates, ...extra], matchedIndex: current.candidates.length + extra.length - 1 });
    }
  } catch (err) {
    log.debug('Auto-match failed', err);
  }
}

export async function runWhisper(id: string): Promise<void> {
  const moment = store.getMoment(id);
  if (!moment) return;
  store.updateMoment(id, { status: 'transcribing' });
  try {
    const segments = await transcribe(store.mediaPath(id, 'wav'));
    // Without a video position the audio starts at 0, so the lines can still be cut out of it.
    const base = moment.audioStart ?? 0;
    const candidates: Candidate[] = segments.map((s) => ({
      start: base + s.start,
      end: base + s.end,
      text: s.text,
      source: 'whisper',
    }));
    store.updateMoment(id, { status: 'ready', candidates: candidates.slice(-6), audioStart: base });
  } catch (err) {
    log.error('Whisper failed', err);
    store.updateMoment(id, { status: 'ready', error: `Transcription failed: ${(err as Error).message}` });
  }
}

/**
 * A moment the phone marked on its own (episode clock, maybe microphone audio). Keeps the phone's id, so the
 * inbox entry stays the same; Whisper fills in or checks the lines like for a laptop mark.
 */
export async function importPhoneMoment(moment: Moment, wav: Buffer | undefined): Promise<Moment> {
  const existing = store.getMoment(moment.id);
  if (existing) return existing;
  // A card the phone already made keeps that state; it only comes over for history and statistics.
  const done = moment.status === 'done' || moment.status === 'discarded';
  store.addMoment({ ...moment, status: done ? moment.status : 'ready', hasAudio: false, hasImage: false });
  if (wav?.length && !done) {
    fs.writeFileSync(store.mediaPath(moment.id, 'wav'), wav);
    await wavToMp3(store.mediaPath(moment.id, 'wav'), store.mediaPath(moment.id, 'mp3'));
    store.updateMoment(moment.id, { hasAudio: true });
    if (whisperAvailable()) {
      if (!moment.candidates.length) void runWhisper(moment.id);
      else if (getSettings().autoMatchWhisper) void autoMatch(moment.id);
    }
  }
  return store.getMoment(moment.id)!;
}

/** Re-computes candidates after the subtitles of a session changed (e.g. uploaded later). */
export function refreshCandidates(sessionId: string): void {
  const cues = store.sessionCues(sessionId);
  for (const m of store.listMoments((m) => m.sessionId === sessionId && m.status === 'ready')) {
    if (m.videoTime === undefined) continue;
    const candidates = candidatesAt(cues, m.videoTime, m.audioDuration ?? getSettings().bufferSeconds);
    if (candidates.length) store.updateMoment(m.id, { candidates });
  }
}
