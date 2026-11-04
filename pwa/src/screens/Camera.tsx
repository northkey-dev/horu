import { useEffect, useRef, useState } from 'react';
import { Nav } from '../components/Nav.tsx';
import { Icon } from '../components/Icon.tsx';
import { TextSheet } from '../components/TextSheet.tsx';
import { laptopUp } from '../lib/api.ts';
import { looksJapanese } from '../../../shared/lang.ts';
import { minePhotoLine, preparePhoto, readPhoto, readRegion, type Photo, type PhotoLine } from '../lib/camera.ts';

// Read → Camera: take a photo of Japanese text (a sign, a menu, a pullover), tap a line on the picture for the
// dictionary, a translation or a card. Without the laptop the text comes from the phone's own text recognition
// (Live Text, Google Lens): copy it and paste it here. When the laptop finds no outline (one big character,
// handwriting, an odd font), "Select text yourself" lets you frame the text and reads just that.

export function Camera() {
  const [photo, setPhoto] = useState<Photo>();
  const [lines, setLines] = useState<PhotoLine[]>([]);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<number>();
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [toast, setToast] = useState<string>();
  const [typed, setTyped] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [frame, setFrame] = useState<{ x1: number; y1: number; x2: number; y2: number }>();
  const [note, setNote] = useState<string>();
  const wrap = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<{ x: number; y: number }>();
  const take = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const url = useRef<string>();

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setNote(undefined);
    setOpen(undefined);
    setLines([]);
    setEdits({});
    setSelecting(false);
    setReading(true);
    try {
      const prepared = await preparePhoto(file);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = prepared.url;
      setPhoto(prepared);
      setSize({ w: prepared.w, h: prepared.h });
      if (laptopUp()) {
        const read = await readPhoto(prepared);
        setLines(read.lines);
        setSize({ w: read.w, h: read.h });
        if (read.whole) setNote('Only scraps of text were found, so the whole photo was read as one line (a guess, it suits one big character). If it is wrong, tap Select text yourself and frame the text.');
        else if (!read.lines.length) setError('No Japanese text found on the photo. Tap Select text yourself and frame the text, try again closer and straight on, or paste the text from the phone’s own text recognition below.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  /** Text from the phone's own recognition (Live Text, Google Lens) or typed: one line per row. */
  function addText(text: string) {
    const rows = text
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    const added = rows.filter(looksJapanese).map((t): PhotoLine => ({ text: t }));
    if (!added.length) return setError(rows.length ? 'None of that text is Japanese, so nothing was added.' : 'There is no text to add. Copy some Japanese text first.');
    setError(undefined);
    setNote(added.length < rows.length ? `${rows.length - added.length} line${rows.length - added.length > 1 ? 's' : ''} without Japanese left out.` : undefined);
    setLines((l) => [...l, ...added]);
    setTyped('');
  }

  async function paste() {
    try {
      addText(await navigator.clipboard.readText());
    } catch {
      setError('Horu may not read the clipboard here. Touch and hold the box below → Paste, then Use this text.');
    }
  }

  const textOf = (i: number) => edits[i] ?? lines[i]?.text ?? '';

  // Select text yourself: drag a frame over the text; only that region is read.
  const at = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  function frameStart(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragFrom.current = at(e);
    setFrame({ x1: dragFrom.current.x, y1: dragFrom.current.y, x2: dragFrom.current.x, y2: dragFrom.current.y });
  }
  function frameMove(e: React.PointerEvent) {
    const from = dragFrom.current;
    if (!from) return;
    const to = at(e);
    setFrame({ x1: Math.min(from.x, to.x), y1: Math.min(from.y, to.y), x2: Math.max(from.x, to.x), y2: Math.max(from.y, to.y) });
  }
  async function frameEnd() {
    const f = frame;
    dragFrom.current = undefined;
    if (!f || !photo) return;
    // Too small to be text: ignore (a tap)
    if ((f.x2 - f.x1) * size.w < 12 || (f.y2 - f.y1) * size.h < 12) return setFrame(undefined);
    setReading(true);
    setError(undefined);
    try {
      const line = await readRegion(photo, [f.x1 * size.w, f.y1 * size.h, f.x2 * size.w, f.y2 * size.h]);
      if (!line) setError('Nothing could be read in that frame. Frame one line of text closely, straight and large, and try again.');
      else {
        setOpen(lines.length);
        setLines((l) => [...l, line]);
        setSelecting(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFrame(undefined);
      setReading(false);
    }
  }

  async function mine(hint?: string) {
    if (open === undefined) return;
    try {
      const where = await minePhotoLine(photo, { ...lines[open], text: textOf(open) }, size, hint);
      setToast(where === 'inbox' ? (hint ? `Added to inbox with ${hint}` : 'Added to inbox') : 'Saved on the phone · goes to the inbox when the laptop is reachable (without the photo)');
    } catch (e) {
      setToast((e as Error).message);
    }
    setTimeout(() => setToast(undefined), 2400);
  }

  const withLaptop = laptopUp();

  return (
    <div>
      <Nav back="Read" to="manga" />
      <h1>Camera</h1>
      {error && <div className="banner error">{error}</div>}

      {!photo && (
        <p className="muted" style={{ marginTop: 0 }}>
          Photograph Japanese text: a sign, a menu, a packet, a pullover. {withLaptop ? 'The laptop reads it; tap a line on the picture for the dictionary, a translation or a card.' : 'Without the laptop Horu cannot read the picture itself: use the phone’s text recognition and paste the text below.'}
        </p>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="primary grow" disabled={reading} onClick={() => take.current?.click()}>
          {photo ? 'Take another photo' : 'Take a photo'}
        </button>
        <button className="grow" disabled={reading} onClick={() => pick.current?.click()}>
          From your photos
        </button>
      </div>
      <input ref={take} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />

      {photo && withLaptop && (
        <button className={selecting ? 'primary block' : 'block'} style={{ marginTop: 8 }} disabled={reading} onClick={() => setSelecting(!selecting)}>
          {selecting ? 'Drag a frame over the text…' : 'Select text yourself'}
        </button>
      )}
      {note && <div className="banner info" style={{ marginTop: 12 }}>{note}</div>}

      {reading && (
        <p className="muted row small" style={{ marginTop: 14 }}>
          <span className="spinner" /> {photo ? 'Reading the text…' : 'Preparing the photo…'}
        </p>
      )}

      {photo && (
        <div className="camera-photo" ref={wrap}>
          <img src={photo.url} alt="" draggable={false} />
          {lines.map(
            (l, i) =>
              l.box && (
                <button
                  key={i}
                  className={`block${open === i ? ' active' : ''}`}
                  aria-label={l.text}
                  style={{ left: `${(l.box[0] / size.w) * 100}%`, top: `${(l.box[1] / size.h) * 100}%`, width: `${((l.box[2] - l.box[0]) / size.w) * 100}%`, height: `${((l.box[3] - l.box[1]) / size.h) * 100}%` }}
                  onClick={() => setOpen(i)}
                />
              ),
          )}
          {selecting && (
            <div className="camera-frame-layer" onPointerDown={frameStart} onPointerMove={frameMove} onPointerUp={() => void frameEnd()} onPointerCancel={() => setFrame(undefined)}>
              {frame && <div className="camera-frame" style={{ left: `${frame.x1 * 100}%`, top: `${frame.y1 * 100}%`, width: `${(frame.x2 - frame.x1) * 100}%`, height: `${(frame.y2 - frame.y1) * 100}%` }} />}
            </div>
          )}
        </div>
      )}
      {selecting && <p className="footnote">Frame one line of text, as tight as you can. For handwriting or a single character: photograph it large on plain paper, straight on.</p>}

      {lines.length > 0 && (
        <>
          <h2>Lines</h2>
          <div className="group">
            {lines.map((l, i) => (
              <button key={i} className="list-item" onClick={() => setOpen(i)}>
                <span className="grow jp">{textOf(i)}</span>
                <Icon name="chevron" size={18} weight={2} className="chev" />
              </button>
            ))}
          </div>
        </>
      )}

      <h2>Text from the phone</h2>
      <div className="group">
        <button className="list-item action-row" onClick={paste}>
          Paste from clipboard
        </button>
        <label className="field stacked">
          <span>Or type or paste it here</span>
          <textarea rows={3} className="jp" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="一行ずつ" />
          <div className="hint">iPhone: open the photo, touch and hold the text → Copy (Live Text; it also works in the Camera app). Android: Google Lens → Copy text.</div>
        </label>
        <button className="list-item action-row" disabled={!typed.trim()} onClick={() => addText(typed)}>
          Use this text
        </button>
      </div>
      {!withLaptop && <p className="footnote">Without the laptop a mined line is kept as text only; with the laptop the photo goes with it as the card’s picture.</p>}

      {open !== undefined && lines[open] && (
        <TextSheet
          key={`${open}:${lines[open].text}`}
          text={textOf(open)}
          edited={edits[open] !== undefined}
          source="Photo from the camera"
          context={lines.slice(Math.max(0, open - 3), open).map((_, k) => textOf(Math.max(0, open - 3) + k))}
          onEdit={(t) => setEdits((e) => (t && t !== lines[open].text ? { ...e, [open]: t } : Object.fromEntries(Object.entries(e).filter(([k]) => Number(k) !== open))))}
          onMine={(hint) => void mine(hint)}
          onClose={() => setOpen(undefined)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
