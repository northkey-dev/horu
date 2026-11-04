import fs from 'node:fs';
import express from 'express';
import { run } from './proc.ts';
import { ocrAvailable, ocrImage, ocrRegion } from './manga/prepare.ts';
import { cropAround } from './crop.ts';
import { looksJapanese } from '../../shared/lang.ts';
import { analyse } from './knownWords.ts';
import { readingOf } from './japanese.ts';
import { log } from './log.ts';
import * as store from './store.ts';

// iPhone "Back Tap" shortcut: screenshot -> OCR -> quick help + inbox.
// The shortcut posts the image to /api/screen?format=text and shows the reply.
// The app's text reader sends photos of pages (books, signs, menus) with ?inbox=0: only the text comes back.

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

export function screenRouter(): express.Router {
  const r = express.Router();
  r.post('/', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
    const asText = req.query.format === 'text';
    const toInbox = req.query.inbox !== '0';
    try {
      if (!ocrAvailable()) throw new Error('Text recognition is not installed on the laptop.');
      const body = req.body as Buffer;
      if (!body?.length) throw new Error('No image received.');
      const id = store.newId();
      const raw = store.mediaPath(id, 'src');
      fs.writeFileSync(raw, body);
      const read = await ocrImage(raw, !toInbox);
      const { w, h } = read;
      // Only Japanese: German or English text on the photo (or in a screenshot) is left out.
      const blocks = read.blocks.filter((b) => looksJapanese(b.text));
      if (!toInbox) {
        // Nothing outlined, or only scraps of one or two characters (one big character, handwriting: the detector
        // cuts it up): read the whole photo as one line instead, as a guess.
        let whole = false;
        if (req.query.whole === '1' && blocks.every((b) => b.text.length <= 2)) {
          const text = await ocrRegion(raw, [0, 0, w, h]).catch(() => '');
          if (looksJapanese(text)) {
            blocks.splice(0, blocks.length, { box: [0, 0, w, h], vertical: false, text });
            whole = true;
          }
        }
        fs.rmSync(raw, { force: true });
        return void res.json({ w, h, blocks, whole });
      }
      // Smaller JPEG for the card (screenshots are huge).
      await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'scale=min(900\\,iw):-2', '-q:v', '4', store.mediaPath(id, 'jpg')]).catch(() => undefined);
      fs.rmSync(raw, { force: true });
      if (!blocks.length) throw new Error('No Japanese text found on the screenshot.');

      const label = `Screenshot · ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
      store.addMoment({
        id,
        kind: 'screen',
        createdAt: new Date().toISOString(),
        status: 'ready',
        title: 'Screenshot',
        sourceLabel: label,
        hasAudio: false,
        hasImage: fs.existsSync(store.mediaPath(id, 'jpg')),
        candidates: blocks.map((b) => ({ start: 0, end: 0, text: b.text, source: 'ocr' as const })),
      });

      if (!asText) return void res.json({ id, blocks });
      const { words } = await analyse(blocks.map((b) => b.text));
      const lines: string[] = [];
      for (const b of blocks.slice(0, 8)) {
        lines.push(b.text, `  ${await readingOf(b.text)}`, '');
      }
      const unknown = words.filter((w) => !w.known && w.meaning).slice(0, 8);
      if (unknown.length) {
        lines.push('— New words —');
        for (const w of unknown) lines.push(`${w.word}【${w.reading}】 ${w.meaning}`);
      }
      lines.push('', 'Saved to the Horu inbox.');
      res.type('text/plain; charset=utf-8').send(lines.join('\n'));
    } catch (err) {
      log.warn('Screen OCR failed', err);
      const message = (err as Error).message;
      if (asText) res.status(200).type('text/plain; charset=utf-8').send(`Horu: ${message}`);
      else res.status(400).json({ error: message });
    }
  });
  // The camera's "select text yourself": the user framed a region (query box=x1,y1,x2,y2 in photo pixels).
  r.post('/region', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
    try {
      if (!ocrAvailable()) throw new Error('Text recognition is not installed on the laptop.');
      const box = String(req.query.box ?? '').split(',').map(Number);
      if (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || box[2] - box[0] < 4 || box[3] - box[1] < 4) throw new Error('Frame the text first.');
      const body = req.body as Buffer;
      if (!body?.length) throw new Error('No image received.');
      const raw = store.mediaPath(store.newId(), 'src');
      fs.writeFileSync(raw, body);
      try {
        const text = await ocrRegion(raw, box);
        res.json({ text: looksJapanese(text) ? text : '' });
      } finally {
        fs.rmSync(raw, { force: true });
      }
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // A line of a photo from the app's camera (Read -> Camera) goes to the inbox with the picture around it.
  r.post('/mine', express.json({ limit: '40mb' }), async (req, res) => {
    try {
      const { image, text, targetHint, box, w, h } = req.body as { image?: string; text?: string; targetHint?: string; box?: number[]; w?: number; h?: number };
      if (!text?.trim()) throw new Error('No text');
      const id = store.newId();
      let hasImage = false;
      if (image) {
        const raw = store.mediaPath(id, 'src');
        fs.writeFileSync(raw, Buffer.from(image, 'base64'));
        hasImage = await cropAround(raw, { w: w ?? 0, h: h ?? 0 }, box, store.mediaPath(id, 'jpg'));
        fs.rmSync(raw, { force: true });
      }
      const when = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      res.json(
        store.addMoment({
          id,
          kind: 'screen',
          createdAt: new Date().toISOString(),
          status: 'ready',
          title: 'Camera',
          sourceLabel: `Camera · ${when}`,
          hasAudio: false,
          hasImage,
          candidates: [{ start: 0, end: 0, text: text.trim(), source: 'ocr' }],
          targetHint: targetHint?.trim() || undefined,
        }),
      );
    } catch (err) {
      log.warn('Camera mine failed', err);
      res.status(400).json({ error: (err as Error).message });
    }
  });
  return r;
}
