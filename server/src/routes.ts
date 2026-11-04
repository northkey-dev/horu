import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import express, { type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import http from 'node:http';
import { ACCESS_TOKEN, APP_URL, PORT, ROOT_DIR, VERSION, getSettings, updateSettings } from './config.ts';
import os from 'node:os';
import { ankiOnline, isAnkiStarting, noteTypeId } from './anki.ts';
import { notify } from './webhook.ts';
import { importDict, listDicts, lookup, removeDict } from './dicts.ts';
import { nowPlaying, playerConfigured } from './players.ts';
import { claudeAvailable } from './claude.ts';
import { suwayomiInstalled } from './manga/suwayomi.ts';
import { ocrAvailable } from './manga/prepare.ts';
import { wordsReadByDay } from './text.ts';
import { cardMade, wordState } from './knownWords.ts';
import { createCard, translateOnLaptop } from './cards.ts';
import { cardsHere } from './anki.ts';
import { kanjiInfo, KANJI_GZ } from './kanji.ts';
import { DICT_GZ, dictMeta, dictState, ensureDictionary, lookupIndex } from './dict.ts';
import { toHiragana, tokenizer } from './japanese.ts';
import { extensionState } from './extensionHub.ts';
import { cuesFromUpload, downloadCues, listFiles, searchEntries } from './jimaku.ts';
import { candidatesAt } from '../../shared/subtitles.ts';
import { importPhoneMoment, markMoment, receiveCapture, refreshCandidates, runWhisper, undoLastMoment } from './moments.ts';
import { whisperAvailable } from './whisper.ts';
import { localOnly } from './auth.ts';
import { log } from './log.ts';
import * as store from './store.ts';
import type { CardRequest, Cue, ExtMomentMeta, Moment, Session, Settings, Status } from '../../shared/types.ts';

const require = createRequire(import.meta.url);

/** Wall-clock times (ms) of remote marks waiting for the phone's episode clock. */
const remoteMarks: number[] = [];
/**
 * Until when the phone says an episode runs on it. A Back Tap outside of watching (a knock in a pocket) must not
 * leave anything behind. Every pick-up of the phone renews it; it ends with the episode or after four hours.
 */
let phoneWatchingUntil = 0;
const WATCHING_MS = 4 * 3600_000;
const KUROMOJI_DICT = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
/** Wraps a handler so thrown errors become `{ error }` JSON responses. */
const h =
  (fn: Handler) =>
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      log.warn(`${req.method} ${req.path}:`, (err as Error).message);
      if (!res.headersSent) res.status(400).json({ error: (err as Error).message });
    }
  };

const param = (req: Request, name: string): string => String(req.params[name]);

export function apiRouter(): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '25mb' }));

  // ---- Japanese helpers: fallback for when the phone cannot run the tokenizer/dictionary itself ----

  r.post(
    '/tokenize',
    h(async (req) => {
      const text = String(req.body?.text ?? '').slice(0, 500);
      let pos = 0;
      return (await tokenizer()).tokenize(text).map((tok) => {
        const start = pos;
        pos += tok.surface_form.length;
        return {
          surface: tok.surface_form,
          base: tok.basic_form && tok.basic_form !== '*' ? tok.basic_form : tok.surface_form,
          reading: tok.reading && tok.reading !== '*' ? toHiragana(tok.reading) : '',
          pos: tok.pos,
          start,
          end: pos,
        };
      });
    }),
  );
  r.post(
    '/kanji',
    h((req) => kanjiInfo(String(req.body?.text ?? '').slice(0, 200))),
  );
  r.post(
    '/translate',
    h((req) => {
      const text = String(req.body?.text ?? '').trim().slice(0, 1000);
      if (!text) throw new Error('Nothing to translate');
      const context = Array.isArray(req.body?.context) ? (req.body.context as unknown[]).slice(-4).map((l) => String(l).slice(0, 300)) : [];
      return translateOnLaptop({ text, context, source: String(req.body?.source ?? '').slice(0, 200) });
    }),
  );
  r.post(
    '/lookup',
    h((req) => {
      const index = lookupIndex();
      const forms = Array.isArray(req.body?.forms) ? (req.body.forms as unknown[]).slice(0, 40).map(String) : [];
      return Object.fromEntries(forms.filter((f) => index?.has(f)).map((f) => [f, index!.get(f)!.slice(0, 5)]));
    }),
  );

  // ---- status & settings ----

  let ankiCache = { at: 0, ok: false };
  r.get(
    '/status',
    h(async (): Promise<Status> => {
      if (Date.now() - ankiCache.at > 5000) ankiCache = { at: Date.now(), ok: await ankiOnline() };
      const ext = extensionState();
      return {
        version: VERSION,
        cards: cardsHere(),
        extensionConnected: ext.connected,
        extensionRecording: ext.recording,
        anki: ankiCache.ok ? 'ok' : isAnkiStarting() ? 'starting' : 'offline',
        jimakuConfigured: Boolean(getSettings().jimakuApiKey),
        whisperAvailable: whisperAvailable(),
        session: store.activeSession(),
        sessionMarks: store.listMoments((m) => m.sessionId !== undefined && m.sessionId === store.activeSession()?.id && m.status !== 'error').length,
        inboxCount: store.inboxMoments().length,
        player: playerConfigured(),
      };
    }),
  );

  r.get(
    '/settings',
    h(() => ({ ...getSettings(), jimakuApiKey: getSettings().jimakuApiKey ? '••••' + getSettings().jimakuApiKey.slice(-4) : '' })),
  );
  r.put(
    '/settings',
    h((req) => {
      const patch = req.body as Partial<Settings>;
      if (patch.jimakuApiKey?.startsWith('••••')) delete patch.jimakuApiKey;
      updateSettings(patch);
      return { ok: true };
    }),
  );

  // ---- jimaku & sessions ----

  r.get('/jimaku/search', h((req) => searchEntries(String(req.query.q ?? ''))));
  r.get('/jimaku/entries/:id/files', h((req) => listFiles(Number(param(req, 'id')), Number(req.query.episode))));

  r.get(
    '/sessions/recent',
    h(() =>
      store.recentSessions().map((s) => ({
        ...s,
        nextEpisode: (s.jimakuEntryId ? store.lastEpisode(s.jimakuEntryId) ?? s.episode : s.episode) + 1,
      })),
    ),
  );

  r.post(
    '/sessions',
    h(async (req) => {
      const body = req.body as { title: string; jimakuEntryId?: number; anilistId?: number; episode: number; fileUrl?: string; fileName?: string };
      if (!body.title || !Number.isFinite(body.episode)) throw new Error('Title and episode are required');
      let cues: Cue[] = [];
      let subtitleName: string | undefined;
      let warning: string | undefined;
      if (body.jimakuEntryId) {
        try {
          const file = body.fileUrl
            ? { url: body.fileUrl, name: body.fileName ?? 'subs.srt', size: 0 }
            : (await listFiles(body.jimakuEntryId, body.episode))[0];
          if (file) {
            ({ name: subtitleName, cues } = await downloadCues(file, body.episode));
          } else {
            warning = 'No Japanese subtitles on Jimaku for this episode. Whisper will transcribe instead.';
          }
        } catch (err) {
          warning = `Subtitles could not be loaded: ${(err as Error).message}`;
        }
      }
      const session = store.addSession(
        {
          id: store.newId(),
          createdAt: new Date().toISOString(),
          title: body.title,
          jimakuEntryId: body.jimakuEntryId,
          anilistId: body.anilistId,
          episode: body.episode,
          subtitleName,
          cueCount: cues.length,
        },
        cues,
      );
      log.info(`Session: ${session.title} Ep ${session.episode} (${cues.length} lines)`);
      return { session, warning };
    }),
  );

  // Japanese subtitles the recorded page shows or downloads itself (YouTube, Netflix, Crunchyroll, players with
  // text tracks; see extension/src/content.ts). They are timed by the video, so they beat Jimaku: a whole track
  // replaces Jimaku's lines, lines read off the screen only fill a session without other subtitles.
  r.post(
    '/sessions/site-subs',
    h((req) => {
      const { cues, live, page } = req.body as { cues?: Cue[]; live?: boolean; page?: string };
      const clean = (Array.isArray(cues) ? cues : [])
        .filter((c) => Number.isFinite(c?.start) && Number.isFinite(c?.end) && typeof c.text === 'string' && c.text.trim())
        .slice(0, 5000)
        .map((c) => ({ start: c.start, end: Math.max(c.end, c.start), text: c.text.trim() }));
      if (!clean.length) return { lines: 0 };
      const session =
        store.activeSession() ??
        store.addSession({ id: store.newId(), createdAt: new Date().toISOString(), title: (page?.trim() || 'Video').slice(0, 90), episode: 1, cueCount: 0 }, []);
      const existing = store.sessionCues(session.id);
      const fromPage = session.subtitleName?.startsWith('From the page') ?? false;
      const wholeTrack = session.subtitleName === 'From the page';
      if ((!fromPage && existing.length && (live || clean.length < 20)) || (live && wholeTrack)) return { lines: existing.length, kept: session.subtitleName };
      const byKey = new Map<string, Cue>();
      // A whole track replaces; screen lines and streamed pieces (HLS sends subtitles in chunks) add up.
      for (const c of [...(fromPage && (live || clean.length < 20) ? existing : []), ...clean]) {
        const key = `${c.start.toFixed(1)}|${c.text}`;
        const had = byKey.get(key);
        byKey.set(key, had ? { ...had, end: Math.max(had.end, c.end) } : c);
      }
      const merged = [...byKey.values()].sort((a, b) => a.start - b.start);
      store.updateSessionCues(session.id, merged, live ? 'From the page (live)' : 'From the page');
      // Marks made a moment before their line was read off the screen get it now.
      const recent = Date.now() - 3 * 60_000;
      for (const m of store.listMoments((m) => m.sessionId === session.id && m.status === 'ready' && Date.parse(m.createdAt) > recent)) {
        if (m.videoTime === undefined) continue;
        const candidates = candidatesAt(merged, m.videoTime, m.audioDuration ?? getSettings().bufferSeconds);
        if (candidates.length > m.candidates.length) store.updateMoment(m.id, { candidates });
      }
      return { lines: merged.length };
    }),
  );

  r.post(
    '/sessions/:id/subtitles',
    express.raw({ type: () => true, limit: '20mb' }),
    h((req) => {
      const session = store.getSession(param(req, 'id'));
      if (!session) throw new Error('Unknown session');
      const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'upload.srt'));
      const { name: picked, cues } = cuesFromUpload(name, new Uint8Array(req.body as Buffer), session.episode);
      if (!cues.length) throw new Error('No subtitle lines found in that file');
      store.updateSessionCues(session.id, cues, picked);
      refreshCandidates(session.id);
      return { session: store.getSession(session.id) };
    }),
  );

  r.get(
    '/sessions/:id/cues',
    h((req) => {
      const from = Number(req.query.from ?? 0);
      const to = Number(req.query.to ?? from + 60);
      return store.sessionCues(param(req, 'id')).filter((c) => c.end >= from && c.start <= to);
    }),
  );

  r.post('/sessions/end', h(() => store.endSession()));

  // ---- what the phone recorded on its own (see pwa/src/lib/phone.ts) ----

  r.post(
    '/sessions/import',
    h((req) => {
      const { session, cues } = req.body as { session: Session; cues?: Cue[] };
      if (!session?.id || !session.title) throw new Error('Session missing');
      store.importSession({ ...session, cueCount: cues?.length ?? session.cueCount }, cues);
      return { ok: true };
    }),
  );
  r.post(
    '/moments/import',
    h(async (req) => {
      const { moment, audio } = req.body as { moment: Moment; audio?: string };
      if (!moment?.id || !moment.kind) throw new Error('Moment missing');
      return importPhoneMoment(moment, audio ? Buffer.from(audio, 'base64') : undefined);
    }),
  );
  // So a phone that watches without the laptop can load subtitles itself.
  r.get('/jimaku/key', h(() => ({ key: getSettings().jimakuApiKey })));

  // ---- watching ----

  r.post(
    '/mark',
    h(() => {
      const m = markMoment();
      notify('mark', { moment: m });
      return m;
    }),
  );
  r.post('/undo', h(() => ({ removed: undoLastMoment() ?? null })));

  // A mark from an iOS Shortcut (Back Tap, Action button, Siri) or any other tool, without opening the app.
  // The extension takes it if it records; otherwise the phone picks it up and places it on its episode clock.
  r.post('/mark/remote', (req, res) => {
    const at = Number(req.query.at ?? req.body?.at) || Date.now();
    if (extensionState().recording) {
      try {
        const m = markMoment();
        notify('mark', { moment: m });
        return void res.type('text').send('Marked');
      } catch {
        // fall through to the phone
      }
    }
    if (Date.now() > phoneWatchingUntil) {
      return void res.status(409).type('text').send('Nothing marked: no episode is running. Start one in Horu, or record the tab in Chrome.');
    }
    remoteMarks.push(at);
    if (remoteMarks.length > 50) remoteMarks.shift();
    res.type('text').send('Marked – opens on the phone with the episode clock');
  });
  // The phone tells when it starts or ends an episode.
  r.post(
    '/mark/remote/watching',
    h((req) => {
      phoneWatchingUntil = req.body?.on ? Date.now() + WATCHING_MS : 0;
      return { ok: true };
    }),
  );
  r.post(
    '/mark/remote/take',
    h(() => {
      phoneWatchingUntil = Date.now() + WATCHING_MS;
      return { marks: remoteMarks.splice(0) };
    }),
  );

  // ---- inbox ----

  r.get('/inbox', h(() => store.inboxMoments()));
  r.get('/moments', h((req) => store.listMoments().slice(0, Number(req.query.limit ?? 200))));
  r.get(
    '/moments/:id',
    h((req) => {
      const m = store.getMoment(param(req, 'id'));
      if (!m) throw new Error('Not found');
      return m;
    }),
  );
  r.get('/moments/:id/audio', (req, res) => sendMedia(res, store.mediaPath(param(req, 'id'), 'mp3'), 'audio/mpeg'));
  r.get('/moments/:id/image', (req, res) => sendMedia(res, store.mediaPath(param(req, 'id'), 'jpg'), 'image/jpeg'));
  r.post(
    '/moments/:id/card',
    h((req) => {
      const body = req.body as CardRequest & { skipAi?: boolean };
      createCard(param(req, 'id'), body, { skipAi: body.skipAi });
      return { ok: true };
    }),
  );
  // The phone made the card itself (.apkg, AnkiMobile, AnkiConnect on the phone); only the inbox state changes.
  r.post(
    '/moments/:id/done',
    h((req) => {
      const id = param(req, 'id');
      const m = store.getMoment(id);
      if (!m) throw new Error('Not found');
      const { cardSentence, cardTarget } = req.body as { cardSentence?: string; cardTarget?: string };
      if (m.status !== 'done') store.updateMoment(id, { status: 'done', error: undefined, cardSentence, cardTarget });
      if (cardTarget) cardMade(cardTarget);
      notify('card', { moment: store.getMoment(id), target: cardTarget, sentence: cardSentence, madeOn: 'phone' });
      return { ok: true };
    }),
  );
  // So .apkg files built on the phone use the same note type as the laptop's Anki.
  r.get('/anki/notetype', h(async () => ({ id: await noteTypeId().catch(() => undefined), deck: getSettings().deckName })));
  r.post(
    '/moments/:id/discard',
    h((req) => {
      store.discardMoment(param(req, 'id'));
      return { ok: true };
    }),
  );
  r.post(
    '/moments/:id/restore',
    h((req) => {
      if (!store.restoreMoment(param(req, 'id'))) throw new Error('Only finished or discarded moments can be restored');
      return { ok: true };
    }),
  );
  r.post(
    '/moments/:id/transcribe',
    h((req) => {
      if (!whisperAvailable()) throw new Error('Whisper is not installed');
      void runWhisper(param(req, 'id'));
      return { ok: true };
    }),
  );

  // ---- integrations ----

  /** Which optional parts are installed (scripts/install.ps1 -Modules …). */
  let claudeCache: { at: number; ok: boolean } | undefined;
  r.get(
    '/modules',
    h(async () => {
      if (!claudeCache || Date.now() - claudeCache.at > 10 * 60_000) claudeCache = { at: Date.now(), ok: await claudeAvailable() };
      const ollama = await fetch(`${getSettings().ollamaUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
      return { whisper: whisperAvailable(), manga: suwayomiInstalled(), ocr: ocrAvailable(), claude: claudeCache.ok, ollama };
    }),
  );
  r.get('/player/now', h(async () => (await nowPlaying()) ?? null));
  /** Everything Horu knows, for moving to another tool (no media, no keys). */
  r.get(
    '/export',
    h(async (_req, res) => {
      res.setHeader('Content-Disposition', `attachment; filename="horu-${new Date().toISOString().slice(0, 10)}.json"`);
      return { exportedAt: new Date().toISOString(), version: VERSION, moments: store.listMoments(), sessions: store.allSessions(), words: await wordState(), wordsRead: wordsReadByDay() };
    }),
  );

  // ---- Yomitan dictionaries (see dicts.ts) ----

  r.get('/dicts', h(() => listDicts()));
  r.post(
    '/dicts',
    express.raw({ type: () => true, limit: '400mb' }),
    h((req) => importDict(req.body as Buffer)),
  );
  r.delete(
    '/dicts/:id',
    h((req) => {
      removeDict(param(req, 'id'));
      return { ok: true };
    }),
  );
  r.post(
    '/dicts/lookup',
    h((req) => lookup(Array.isArray(req.body?.forms) ? (req.body.forms as unknown[]).slice(0, 40).map(String) : [])),
  );

  // ---- chrome extension (this machine only) ----

  const pendingAudio = new Map<string, Buffer>();
  r.post(
    '/ext/moments/:id/audio',
    localOnly,
    express.raw({ type: () => true, limit: '30mb' }),
    h((req) => {
      pendingAudio.set(param(req, 'id'), req.body as Buffer);
      setTimeout(() => pendingAudio.delete(param(req, 'id')), 60_000);
      return { ok: true };
    }),
  );
  r.post(
    '/ext/moments/:id/meta',
    localOnly,
    h(async (req) => {
      const id = param(req, 'id');
      await receiveCapture(id, req.body as ExtMomentMeta, pendingAudio.get(id));
      pendingAudio.delete(id);
      return { ok: true };
    }),
  );

  return r;
}

function sendMedia(res: Response, file: string, type: string): void {
  if (!fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.type(type).sendFile(file);
}

export function dictRouter(): express.Router {
  const r = express.Router();
  r.get('/meta', (_req, res) => {
    void ensureDictionary();
    res.json({ state: dictState(), ...dictMeta() });
  });
  r.get('/jmdict.json', (_req, res) => {
    if (!fs.existsSync(DICT_GZ)) return void res.status(503).json({ error: 'Dictionary is still being built' });
    res.set({ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache' });
    fs.createReadStream(DICT_GZ).pipe(res);
  });
  r.get('/kanjidic.json', (_req, res) => {
    if (!fs.existsSync(KANJI_GZ)) return void res.status(503).json({ error: 'KANJIDIC is still downloading' });
    res.set({ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-cache' });
    fs.createReadStream(KANJI_GZ).pipe(res);
  });
  // kuromoji's browser loader gunzips these itself, so serve them as plain bytes.
  r.use('/kuromoji', express.static(KUROMOJI_DICT, { setHeaders: (res) => res.setHeader('Content-Type', 'application/octet-stream') }));
  return r;
}

const execFileP = promisify(execFile);

/** The laptop's Tailscale address (https://name.tailnet.ts.net), and whether `tailscale serve` passes it to Horu. */
/** Asks the Tailscale daemon over its socket (the Tailscale container shares it with Horu). */
function tailscaleLocalApi(socketPath: string): Promise<{ Self?: { DNSName?: string } }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: '/localapi/v0/status', headers: { Host: 'local-tailscaled.sock' }, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Tailscale did not answer')));
    req.end();
  });
}

async function tailscaleUrl(): Promise<{ url?: string; serving: boolean }> {
  // In a container the address is given (HORU_PUBLIC_URL) or asked from the Tailscale container, which serves it.
  if (process.env.HORU_PUBLIC_URL) return { url: process.env.HORU_PUBLIC_URL.replace(/\/+$/, ''), serving: true };
  if (process.env.TS_SOCKET) {
    const name = await tailscaleLocalApi(process.env.TS_SOCKET).then((s) => s.Self?.DNSName?.replace(/\.$/, ''), () => undefined);
    return name ? { url: `https://${name}`, serving: true } : { serving: false };
  }
  try {
    const status = JSON.parse((await execFileP('tailscale', ['status', '--json'], { timeout: 5000 })).stdout) as { Self?: { DNSName?: string } };
    const name = status.Self?.DNSName?.replace(/\.$/, '');
    if (!name) return { serving: false };
    const serve = await execFileP('tailscale', ['serve', 'status'], { timeout: 5000 }).catch(() => ({ stdout: '' }));
    return { url: `https://${name}`, serving: serve.stdout.includes(`:${PORT}`) };
  } catch {
    return { serving: false };
  }
}

/** Pairing page for the phone (laptop only): QR code that the app scans to connect to this laptop. */
/** This laptop's address in the home network (not Tailscale, not link-local). */
function lanAddress(): string | undefined {
  // In a container the interfaces are the container's own: the host's address is given (HORU_LAN_ADDRESS).
  if (process.env.HORU_DOCKER) return process.env.HORU_LAN_ADDRESS || undefined;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const [x, y] = a.address.split('.').map(Number);
      if (x === 100 && y >= 64 && y <= 127) continue;
      if (x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31)) return a.address;
    }
  }
  return undefined;
}

export async function pairPage(_req: Request, res: Response): Promise<void> {
  const { url, serving } = await tailscaleUrl();
  // A hosted copy of the app pairs through its own page; otherwise the phone simply opens this service.
  const link = url && (APP_URL ? `${APP_URL}#/pair?laptop=${encodeURIComponent(url)}` : `${url}/`);
  const qr = link && serving ? `<figure><img src="${await QRCode.toDataURL(link, { margin: 1, width: 260 })}"><figcaption>${url}</figcaption></figure>` : '';
  const setup = !url
    ? process.env.HORU_DOCKER
      ? '<p class="warn">The Tailscale container has not signed in (yet). Check TS_AUTHKEY in .env and look at <code>docker compose logs tailscale</code>, then reload this page.</p>'
      : '<p class="warn">Tailscale is not running on this laptop. Install it from tailscale.com and sign in, then reload this page.</p>'
    : !serving
      ? `<p class="warn">Tailscale runs, but does not pass requests to Horu yet. Run this once in a terminal, then reload:</p><p><code>tailscale serve --bg ${PORT}</code></p>`
      : '';
  // Without Tailscale: the phone opens the app from this laptop over the home Wi-Fi.
  const lan = lanAddress();
  const lanLink = lan && `http://${lan}:${PORT}/?t=${ACCESS_TOKEN}`;
  const lanQr = lanLink
    ? `<h2>No Tailscale? Same Wi-Fi only</h2>
<p>Scan this with the phone's camera, open the page in Safari and add it to the home screen. It works only at home and without offline use, microphone and reminders (browsers allow those only on https). Windows may ask once whether Node.js may use private networks: allow it.</p>
<figure><img src="${await QRCode.toDataURL(lanLink, { margin: 1, width: 220 })}"><figcaption>http://${lan}:${PORT}</figcaption></figure>`
    : '';
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Horu – connect your phone</title>
<style>body{font-family:system-ui;background:#151311;color:#ece6dc;padding:24px;max-width:640px;line-height:1.5}figure{margin:20px 0;text-align:center;display:inline-block}figcaption{font-size:13px;color:#a39887;margin-top:6px}img{background:#fff;padding:10px;border-radius:10px}code{background:#26221e;padding:2px 6px;border-radius:4px}.warn{color:#e8a25c}a{color:#e05a3a}</style>
<h1>Connect your phone</h1>
${setup}
<ol>
<li>Phone: install <b>Tailscale</b> and sign in with the same account as this laptop.</li>
${APP_URL
    ? `<li>Open <a href="${APP_URL}">${APP_URL}</a> in Safari (Chrome on Android) and add it to the home screen.</li>
<li>Open Horu from the home screen → <b>Settings → Laptop → Scan QR code</b> and scan this code.</li>`
    : url
      ? `<li>Scan this code with the phone's camera, or open <a href="${url}/">${url}</a>, in Safari (Chrome on Android) and add the page to the home screen.</li>`
      : ''}
${fs.existsSync(path.join(ROOT_DIR, 'extension', 'dist', 'manifest.json')) ? `<li>Chrome on your computer: <a href="extension.zip">download the extension</a>, unzip it, open <code>chrome://extensions</code> → Developer mode → Load unpacked. Then its <b>Options</b> → server address <code>${url ?? 'this address'}</code>.</li>` : ''}
</ol>
${qr}
${lanQr}
<p style="color:#a39887;font-size:14px">Horu also works on the phone alone. The laptop adds audio and screenshots of what you watch, Whisper, manga sources and text recognition, Claude and Anki.</p>`);
}
