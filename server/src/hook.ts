import express from 'express';
import { getSettings } from './config.ts';
import { log } from './log.ts';

// Text from games and visual novels. A text hooker (Textractor with its WebSocket extension, LunaTranslator,
// or anything that sends lines) runs next to the game; Horu listens on its WebSocket and also takes lines
// posted to /api/hook/line (AutoHotkey, clipboard tools). The app shows the lines and mines them like text.

type Line = { id: number; text: string; at: string };

const lines: Line[] = [];
let nextId = 1;
let socket: WebSocket | undefined;
let connected = false;
let wantedUntil = 0;
let retry: NodeJS.Timeout | undefined;

export function addLine(raw: string): void {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text || !/[぀-ヿ㐀-鿿]/.test(text) || lines.at(-1)?.text === text) return;
  lines.push({ id: nextId++, text, at: new Date().toISOString() });
  if (lines.length > 300) lines.splice(0, lines.length - 300);
}

/** Connects while the app shows the game text (and a few minutes after), retrying every few seconds. */
function ensureSocket(): void {
  wantedUntil = Date.now() + 10 * 60_000;
  if (socket || retry) return;
  const url = getSettings().hookUrl.trim();
  if (!url) return;
  try {
    socket = new WebSocket(url);
  } catch (e) {
    log.warn('Text hooker:', (e as Error).message);
    socket = undefined;
    return;
  }
  socket.onopen = () => {
    connected = true;
    log.info(`Text hooker connected (${url})`);
  };
  socket.onmessage = (e) => {
    const data = String(e.data);
    // Plain text (Textractor) or JSON with a sentence/text field (LunaTranslator and others).
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === 'object') {
        const o = parsed as Record<string, unknown>;
        return addLine(String(o.sentence ?? o.text ?? o.data ?? ''));
      }
    } catch {
      // not JSON
    }
    addLine(data);
  };
  socket.onclose = () => {
    if (connected) log.info('Text hooker disconnected');
    connected = false;
    socket = undefined;
    if (Date.now() < wantedUntil) retry = setTimeout(() => ((retry = undefined), ensureSocket()), 5000);
  };
  socket.onerror = () => socket?.close();
}

export function hookRouter(): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '100kb' }));
  r.use(express.text({ limit: '100kb' }));
  r.get('/lines', (req, res) => {
    ensureSocket();
    const after = Number(req.query.after ?? 0);
    res.json({ connected, url: getSettings().hookUrl, lines: lines.filter((l) => l.id > after) });
  });
  r.post('/line', (req, res) => {
    addLine(typeof req.body === 'string' ? req.body : String(req.body?.text ?? ''));
    res.json({ ok: true });
  });
  return r;
}
