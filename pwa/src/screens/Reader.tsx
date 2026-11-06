import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../lib/hooks.ts';
import { describeError, fileUrl, loadChapter, mangaApi, mineLine, offlineChaptersOf, reportProgress, savedPage, type ChapterData } from '../lib/manga.ts';
import { dragFrame, type Box, type Grip } from '../../../shared/frames.ts';
import { looksChinese } from '../../../shared/lang.ts';
import { TokenText, isWord } from '../components/TokenText.tsx';
import { tokenize } from '../lib/japanese.ts';
import { statusOf } from '../lib/words.ts';
import { bubbleEdits, readerPrefs, saveBubbleEdit } from '../lib/readerPrefs.ts';
import { Icon } from '../components/Icon.tsx';
import { TextSheet } from '../components/TextSheet.tsx';
import { ChapterDone } from '../components/ChapterDone.tsx';
import { recordScore, resultSince, snapshotOf, type Result, type Snapshot } from '../lib/chapterScore.ts';
import { chapterStamps } from '../lib/kanjiSkill.ts';

// Full-screen manga reader. Japanese order: tap the LEFT side (or swipe right)
// for the next page. Tap a speech bubble to read it with the dictionary or translate it whole. Pinch or
// double-tap the middle to zoom in; the bubbles zoom with the page. A bubble read wrongly can get a new frame:
// its corners and edges are dragged, the page can still be zoomed, and the laptop reads what the frame holds.

type Rect = { left: number; top: number; scale: number };
type Zoom = { s: number; x: number; y: number };

const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 4;
const GRIPS: Exclude<Grip, 'move'>[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
let spreadHinted = false;

/** Keeps the zoomed page inside the stage (the page can be moved, but not out of the screen). */
function clampZoom(z: Zoom, w: number, h: number): Zoom {
  const s = Math.min(MAX_ZOOM, Math.max(1, z.s));
  if (s < 1.02) return NO_ZOOM;
  return { s, x: Math.min(0, Math.max(w - w * s, z.x)), y: Math.min(0, Math.max(h - h * s, z.y)) };
}

// Pages are big (colour scans up to ~1 MB), and loading one only when it is turned to makes every page
// wait. So the whole chapter is fetched as soon as it opens, nearest pages first, and kept as blobs on the
// phone; near the end the next chapter's first pages follow. Only the open and the next chapter are kept.
// Each page is fetched once: the page on screen and the background loader share the same request.
const pageSrc = new Map<string, Promise<string>>(); // page URL → object URL (the URL itself if the fetch failed)

function loadPage(url: string): Promise<string> {
  let p = pageSrc.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => {
        pageSrc.delete(url); // tried again the next time it is asked for
        return url;
      });
    pageSrc.set(url, p);
  }
  return p;
}

/** The page as an image the browser has fully decoded, so showing it cannot flash black. */
async function decodedPage(url: string): Promise<{ src: string; img: HTMLImageElement }> {
  const src = await loadPage(url);
  const img = new Image();
  img.src = src;
  await img.decode().catch(() => undefined);
  return { src, img };
}

function keepOnly(chapterKeys: string[]): void {
  for (const [url, p] of pageSrc) {
    if (chapterKeys.some((k) => url.includes(`/files/${k}/`))) continue;
    pageSrc.delete(url);
    void p.then((src) => src.startsWith('blob:') && URL.revokeObjectURL(src));
  }
}

/** Loads the pages three at a time, in the order given, until `alive` says stop. */
async function fetchPages(urls: string[], alive: () => boolean): Promise<void> {
  const todo = urls.filter((u) => !pageSrc.has(u));
  const worker = async () => {
    while (alive() && todo.length) await loadPage(todo.shift()!);
  };
  await Promise.all([worker(), worker(), worker()]);
}

export function Reader({ chapterKey }: { chapterKey: string }) {
  const [data, setData] = useState<ChapterData>();
  const [error, setError] = useState<string>();
  const [page, setPage] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [block, setBlock] = useState<number>();
  const [toast, setToast] = useState<string>();
  const [rect, setRect] = useState<Rect>();
  // The end-of-chapter screen, and what the chapter's words looked like when it was opened (to see what you learned)
  const [done, setDone] = useState<Result & { history: number[] } & Partial<Awaited<ReturnType<typeof chapterStamps>>>>();
  const opened = useRef<{ key: string; snapshot: Promise<Snapshot> }>(undefined);
  const [ready, setReady] = useState<{ key: string; order: number }[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  // The page on screen. It follows `page` only once the new one is decoded; until then the old one stays.
  const [shown, setShown] = useState<{ chapterKey: string; page: number; src: string }>();
  const upcoming = useRef<HTMLImageElement[]>([]);
  // Corrected bubble texts, the draft while one is edited, bubble tint (a setting), zoom of the page
  const [edits, setEdits] = useState(bubbleEdits);
  const [tintOn] = useState(() => readerPrefs().bubbleTint);
  const [tints, setTints] = useState<number[]>();
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [spread, setSpread] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // The frame being adjusted (page pixels), the laptop reading it, and the drag going on
  const [frame, setFrame] = useState<Box>();
  const [readingFrame, setReadingFrame] = useState(false);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const grab = useRef<{ id: number; grip: Grip; x: number; y: number; box: Box }>(undefined);
  /** Counts the reads, so a laptop answering after Cancel changes nothing here */
  const frameRead = useRef(0);
  /** Clicks that belong to a gesture (pinch, drag, swipe) do not turn the page */
  const quietUntil = useRef(0);
  const touchedAt = useRef(0);
  const goRef = useRef<(delta: number) => void>(() => undefined);

  useEffect(() => {
    setData(undefined);
    setShown(undefined);
    setError(undefined);
    setBlock(undefined);
    setFrame(undefined);
    setDone(undefined);
    loadChapter(chapterKey).then(
      (d) => {
        setData(d);
        const snapshot = snapshotOf(d, chapterKey, bubbleEdits());
        snapshot.catch(() => undefined);
        opened.current = { key: chapterKey, snapshot };
        // Where this chapter was left: the page remembered on this phone, else the laptop's note. A chapter left on
        // its last page was finished, and starts over.
        const lib = mangaApi.cachedLibrary().find((m) => m.key === d.mangaKey);
        const left = savedPage(chapterKey) ?? (lib?.chapterKey === chapterKey ? lib.page : undefined) ?? 0;
        setPage(left >= d.pages.length - 1 ? 0 : left);
        // Chapters readable right now: offline copies plus (when online) ready ones on the laptop.
        const offline = offlineChaptersOf(d.mangaKey).map((c) => ({ key: c.key, order: c.order }));
        setReady(offline);
        mangaApi
          .chapters(d.mangaKey)
          .then((list) => {
            const keys = new Set(offline.map((c) => c.key));
            setReady([...offline, ...list.filter((c) => c.status === 'ready' && !keys.has(c.key)).map((c) => ({ key: c.key, order: c.order }))]);
          })
          .catch(() => {});
      },
      (e: Error) => setError(e.message),
    );
  }, [chapterKey]);

  const view = shown?.chapterKey === chapterKey ? shown : undefined;
  const current = view && data?.pages[view.page];
  const waiting = !!data && view?.page !== page;
  const chinese = useMemo(() => data && looksChinese(data.pages.flatMap((p) => p.blocks.map((b) => b.text))), [data]);

  const editKey = (i: number) => `${chapterKey}/${view?.page}/${i}`;
  /** The text of a bubble: as corrected by hand, else as recognised */
  const textOf = (i: number) => edits[editKey(i)] ?? current?.blocks[i]?.text ?? '';

  // Every page starts unzoomed.
  useEffect(() => setZoom(NO_ZOOM), [view?.page, chapterKey]);

  // Where the page image actually sits inside the stage (object-fit: contain).
  const measure = useCallback(() => {
    const el = stage.current;
    if (!el || !current?.w) return setRect(undefined);
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scale = Math.min(cw / current.w, ch / current.h);
    setRect({ left: (cw - current.w * scale) / 2, top: (ch - current.h * scale) / 2, scale });
  }, [current]);

  // The stage changes size with the phone turning and with the bars coming and going.
  useEffect(() => {
    measure();
    if (!stage.current) return;
    const watch = new ResizeObserver(measure);
    watch.observe(stage.current);
    return () => watch.disconnect();
  }, [measure]);

  // Double-page spreads are small on a phone held upright: say what helps, once per visit.
  useEffect(() => {
    if (!current || spreadHinted || current.w / current.h < 1.15 || innerHeight < innerWidth) return;
    spreadHinted = true;
    setSpread(true);
  }, [current]);
  useEffect(() => {
    if (!spread) return;
    const t = setTimeout(() => setSpread(false), 5000);
    return () => clearTimeout(t);
  }, [spread]);

  // Bubbles tinted by new words (Settings → Manga reader): the more words you do not know yet, the stronger.
  useEffect(() => {
    setTints(undefined);
    if (!tintOn || !current) return;
    let alive = true;
    (async () => {
      const lists = await Promise.all(current.blocks.map((_, i) => tokenize(textOf(i)).then((t) => t.filter(isWord), () => [])));
      const status = await statusOf([...new Set(lists.flatMap((l) => l.map((t) => t.base)))]);
      const levels = lists.map((l) => {
        let score = 0;
        for (const base of new Set(l.map((t) => t.base))) {
          const st = status[base];
          if (st === 4 || st === -1) continue;
          score += st ? 0.4 : 1; // learning words count less than new ones
        }
        return score < 0.5 ? 0 : score < 1.5 ? 1 : score < 3 ? 2 : 3;
      });
      if (alive) setTints(levels);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tintOn, current, edits]);

  useEffect(() => {
    if (!data) return;
    const finished = page === data.pages.length - 1;
    void reportProgress({ mangaKey: data.mangaKey, chapterKey, page, finished });
  }, [data, page, chapterKey]);

  // Show the page turned to as soon as it is loaded and decoded (the previous one stays until then).
  useEffect(() => {
    if (!data) return;
    let alive = true;
    void decodedPage(fileUrl(chapterKey, data.pages[page].file)).then(({ src }) => alive && setShown({ chapterKey, page, src }));
    return () => {
      alive = false;
    };
  }, [data, page, chapterKey]);

  // Then the rest of the chapter from there on (not before: it would slow the page being waited for), the
  // pages before it last; the next two are decoded in advance.
  useEffect(() => {
    if (!data) return;
    let alive = true;
    const urls = [...data.pages.slice(page), ...data.pages.slice(0, page).reverse()].map((p) => fileUrl(chapterKey, p.file));
    void loadPage(urls[0]).then(() => (alive ? fetchPages(urls, () => alive) : undefined));
    void Promise.all(urls.slice(1, 3).map((u) => decodedPage(u).then((d) => d.img))).then((imgs) => alive && (upcoming.current = imgs));
    return () => {
      alive = false;
    };
  }, [data, page, chapterKey]);

  // The blobs go when the reader closes; on a chapter change only the open and the next chapter stay.
  useEffect(() => () => keepOnly([]), []);

  const neighbours = useMemo(() => {
    if (!data) return {};
    const sorted = [...ready].sort((a, b) => a.order - b.order);
    return {
      next: sorted.find((c) => c.order > data.order),
      prev: [...sorted].reverse().find((c) => c.order < data.order),
    };
  }, [data, ready]);

  const nextKey = neighbours.next?.key;
  useEffect(() => keepOnly([chapterKey, nextKey ?? '']), [chapterKey, nextKey]);
  const nearEnd = !!data && page >= data.pages.length - 4;
  useEffect(() => {
    if (!nearEnd || !nextKey) return;
    let alive = true;
    loadChapter(nextKey).then(
      (next) => fetchPages(next.pages.slice(0, 4).map((p) => fileUrl(nextKey, p.file)), () => alive),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [nearEnd, nextKey]);

  /** Past the last page: the chapter is done. Shows how much of it you understood; without that, on to the next. */
  async function finishChapter() {
    if (!data) return;
    try {
      if (!readerPrefs().chapterEnd) throw new Error('switched off');
      const start = opened.current?.key === chapterKey ? await opened.current.snapshot : await snapshotOf(data, chapterKey, bubbleEdits());
      if (!start.words.length) throw new Error('no words');
      const result = await resultSince(start);
      const kanji = await chapterStamps(start.words).catch(() => undefined);
      setDone({ ...result, history: recordScore(data.mangaKey, data.order, result.pct).map((c) => c.pct), ...kanji });
    } catch {
      if (neighbours.next) navigate(`manga/read/${neighbours.next.key}`);
      else setChrome(true);
    }
  }

  const go = (delta: number) => {
    if (!data) return;
    setBlock(undefined);
    const target = page + delta;
    if (target >= data.pages.length) {
      void finishChapter();
      return;
    }
    if (target < 0) {
      if (neighbours.prev) navigate(`manga/read/${neighbours.prev.key}`);
      return;
    }
    setPage(target);
  };
  goRef.current = go;

  // Touch gestures: pinch zooms, a drag moves the zoomed page, a swipe turns the page, a double tap in the
  // middle zooms in and out. Page turns by tapping the edges stay instant (no waiting for a second tap).
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let pinch: { d: number; s: number; px: number; py: number } | undefined;
    let start: { x: number; y: number; t: number; zx: number; zy: number; moved: boolean } | undefined;
    let lastTap: { x: number; y: number; t: number } | undefined;
    const local = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top, w: r.width, h: r.height };
    };
    const zoomAt = (x: number, y: number, w: number, h: number, s: number) => setZoom(clampZoom({ s, x: x - x * s, y: y - y * s }, w, h));

    const onStart = (e: TouchEvent) => {
      touchedAt.current = Date.now();
      const z = zoomRef.current;
      if (e.touches.length === 1 && (e.target as Element).closest('.block-frame')) {
        pinch = start = undefined; // the frame is being dragged, not the page
        return;
      }
      if (e.touches.length === 2) {
        grab.current = undefined;
        const [a, b] = [e.touches[0], e.touches[1]];
        const m = local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: z.s, px: (m.x - z.x) / z.s, py: (m.y - z.y) / z.s };
        start = undefined;
        quietUntil.current = Date.now() + 500;
      } else if (e.touches.length === 1) {
        pinch = undefined;
        start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), zx: z.x, zy: z.y, moved: false };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const m = local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        const s = Math.min(MAX_ZOOM, pinch.s * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d));
        setZoom(clampZoom({ s, x: m.x - pinch.px * s, y: m.y - pinch.py * s }, m.w, m.h));
        quietUntil.current = Date.now() + 500;
        e.preventDefault();
      } else if (start && e.touches.length === 1) {
        const dx = e.touches[0].clientX - start.x;
        const dy = e.touches[0].clientY - start.y;
        if (Math.hypot(dx, dy) > 10) start.moved = true;
        if (zoomRef.current.s > 1) {
          const r = local(0, 0);
          setZoom(clampZoom({ s: zoomRef.current.s, x: start.zx + dx, y: start.zy + dy }, r.w, r.h));
          quietUntil.current = Date.now() + 400;
          e.preventDefault();
        }
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        if (e.touches.length < 2) pinch = undefined;
        quietUntil.current = Date.now() + 500;
        return;
      }
      const from = start;
      start = undefined;
      if (!from || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      const p = local(t.clientX, t.clientY);
      const zoomed = zoomRef.current.s > 1;
      if (!zoomed && !frameRef.current && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - from.t < 600) {
        e.preventDefault();
        quietUntil.current = Date.now() + 400;
        goRef.current(dx > 0 ? 1 : -1); // swipe right = next page (right-to-left reading)
        return;
      }
      if (from.moved) return;
      // Screen coordinates: the first tap may hide the bars, which moves the page.
      const again = lastTap && Date.now() - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 40;
      if (again && zoomed) {
        setZoom(NO_ZOOM);
        quietUntil.current = Date.now() + 400;
        lastTap = undefined;
      } else if (again && p.x > p.w * 0.33 && p.x < p.w * 0.67) {
        zoomAt(p.x, p.y, p.w, p.h, 2.5);
        quietUntil.current = Date.now() + 400;
        lastTap = undefined;
      } else lastTap = { x: t.clientX, y: t.clientY, t: Date.now() };
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [error]);

  function onTap(e: React.MouseEvent) {
    if (frame || Date.now() < quietUntil.current) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    if (block !== undefined) return setBlock(undefined);
    if (zoomRef.current.s > 1) return setChrome((c) => !c);
    if (x < r.width * 0.33) go(1);
    else if (x > r.width * 0.67) go(-1);
    else setChrome((c) => !c);
  }

  /** Mouse only (a touch double tap is handled above): double click in the middle zooms in and out. */
  function onDoubleClick(e: React.MouseEvent) {
    if (Date.now() - touchedAt.current < 1000) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    if (zoomRef.current.s > 1) return setZoom(NO_ZOOM);
    if (x > r.width * 0.33 && x < r.width * 0.67) setZoom(clampZoom({ s: 2.5, x: x - x * 2.5, y: e.clientY - r.top - (e.clientY - r.top) * 2.5 }, r.width, r.height));
  }

  async function mine(targetHint?: string) {
    if (!data || block === undefined || !current) return;
    try {
      const sent = await mineLine({ readings: current.blocks[block].readings, mangaKey: data.mangaKey, chapterKey, page: view!.page, block, text: textOf(block), targetHint });
      setToast(sent ? (targetHint ? `Added to inbox with ${targetHint}` : 'Added to inbox') : 'Saved · goes to the inbox when the laptop is reachable');
    } catch (e) {
      setToast((e as Error).message);
    }
    setTimeout(() => setToast(undefined), 2200);
  }

  function editBubble(text: string | undefined) {
    if (block === undefined) return;
    setEdits(saveBubbleEdit(editKey(block), text && text !== current?.blocks[block].text ? text : undefined));
  }

  function grabFrame(e: React.PointerEvent, grip: Grip) {
    e.stopPropagation();
    if (!frame || readingFrame) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { id: e.pointerId, grip, x: e.clientX, y: e.clientY, box: frame };
  }

  function dragTheFrame(e: React.PointerEvent) {
    const g = grab.current;
    if (!g || g.id !== e.pointerId || !rect || !current) return;
    const perPixel = rect.scale * zoomRef.current.s;
    setFrame(dragFrame(g.box, g.grip, (e.clientX - g.x) / perPixel, (e.clientY - g.y) / perPixel, current.w, current.h));
  }

  function cancelFrame() {
    frameRead.current++;
    setReadingFrame(false);
    setFrame(undefined);
  }

  async function readTheFrame() {
    if (!frame || block === undefined || !view) return;
    const run = ++frameRead.current;
    const at = view.page;
    setReadingFrame(true);
    try {
      const fixed = await mangaApi.readFrame(chapterKey, at, block, frame);
      if (run !== frameRead.current) return;
      setData((d) => d && { ...d, pages: d.pages.map((p, i) => (i === at ? { ...p, blocks: p.blocks.map((b, k) => (k === block ? fixed : b)) } : p)) });
      setEdits(saveBubbleEdit(editKey(block), undefined)); // a correction by hand belonged to the old text
      setFrame(undefined);
    } catch (e) {
      if (run !== frameRead.current) return;
      setToast(describeError(e));
      setTimeout(() => setToast(undefined), 3500);
    }
    setReadingFrame(false);
  }

  if (error)
    return (
      <div className="reader">
        <div className="reader-top">
          <button className="icon-btn" onClick={() => history.back()} aria-label="Back">
            <Icon name="back" size={28} weight={2.1} />
          </button>
        </div>
        <div className="center" style={{ padding: 32, color: 'rgba(235, 235, 245, 0.6)' }}>
          {error}
        </div>
      </div>
    );

  return (
    <div className="reader">
      {chrome && !frame && (
        <div className="reader-top">
          <button className="icon-btn" onClick={() => navigate(data ? `manga/m/${data.mangaKey}` : 'manga')} aria-label="Back">
            <Icon name="back" size={28} weight={2.1} />
          </button>
          <div className="grow center jp" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>
              {data?.mangaTitle}
            </div>
            <div className="ellipsis muted" style={{ fontSize: 13 }}>
              {data?.name}
            </div>
          </div>
          <span className="icon-btn" aria-hidden="true" />
        </div>
      )}
      {chrome && chinese && (
        <div className="reader-note">
          This chapter is in Chinese, not Japanese – the source lists a Chinese edition as Japanese. Remove the manga and look for it in another source.
        </div>
      )}

      <div ref={stage} className="reader-page" onClick={onTap} onDoubleClick={onDoubleClick}>
        <div className="reader-zoom" style={{ transform: zoom.s > 1 ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : undefined }}>
          {view && <img src={view.src} alt="" draggable={false} onLoad={measure} />}
          {current && rect && (
            <div className="blocks" style={{ left: rect.left, top: rect.top }}>
              {!frame && current.blocks.map((b, i) => (
                <div
                  key={i}
                  className={`block${block === i ? ' active' : ''}${tints?.[i] ? ` tint-${tints[i]}` : ''}`}
                  style={{
                    left: b.box[0] * rect.scale - 4,
                    top: b.box[1] * rect.scale - 4,
                    width: (b.box[2] - b.box[0]) * rect.scale + 8,
                    height: (b.box[3] - b.box[1]) * rect.scale + 8,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (Date.now() >= quietUntil.current) setBlock(i);
                  }}
                />
              ))}
              {frame && (
                <div
                  className="block-frame"
                  style={{
                    left: frame[0] * rect.scale,
                    top: frame[1] * rect.scale,
                    width: (frame[2] - frame[0]) * rect.scale,
                    height: (frame[3] - frame[1]) * rect.scale,
                    '--unzoom': 1 / zoom.s,
                  } as React.CSSProperties}
                  onPointerDown={(e) => grabFrame(e, 'move')}
                  onPointerMove={dragTheFrame}
                  onPointerUp={() => (grab.current = undefined)}
                  onPointerCancel={() => (grab.current = undefined)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {GRIPS.map((g) => (
                    <span key={g} className={`grip ${g}`} onPointerDown={(e) => grabFrame(e, g)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {waiting && view && <span className="page-wait spinner" />}
        {!view && (
          <div className="center" style={{ paddingTop: '45vh', color: 'rgba(235, 235, 245, 0.6)' }}>
            Loading…
          </div>
        )}
      </div>

      {spread && <div className="reader-hint">Double-page spread: turn the phone sideways, or pinch / double-tap the middle to zoom in.</div>}

      {frame && (
        <div className="reader-bottom">
          <button className="ghost" onClick={cancelFrame}>
            Cancel
          </button>
          <div className="grow center frame-hint">{readingFrame ? 'Reading the frame…' : 'Drag the corners and edges around the text'}</div>
          <button className="primary" disabled={readingFrame} onClick={() => void readTheFrame()}>
            {readingFrame ? <span className="spinner" /> : 'Read again'}
          </button>
        </div>
      )}

      {chrome && !frame && data && (
        <div className="reader-bottom">
          <button className="ghost" onClick={() => go(1)} aria-label="Next page">
            <Icon name="next" size={22} weight={2.1} /> Next
          </button>
          <div className="grow center page-count">
            {page + 1} of {data.pages.length}
            {page === data.pages.length - 1 && !neighbours.next && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>Last chapter on this phone</div>}
          </div>
          <button className="ghost" onClick={() => go(-1)} aria-label="Previous page">
            Back <Icon name="prev" size={22} weight={2.1} />
          </button>
        </div>
      )}

      {block !== undefined && !frame && current?.blocks[block] && data && (
        <TextSheet
          key={`${view?.page}/${block}`}
          text={textOf(block)}
          readings={current.blocks[block].readings}
          edited={edits[editKey(block)] !== undefined}
          source={`${data.mangaTitle} · ${data.name}`}
          context={current.blocks.slice(Math.max(0, block - 3), block).map((_, k) => textOf(Math.max(0, block - 3) + k))}
          onEdit={editBubble}
          onMine={(hint) => void mine(hint)}
          onReframe={() => setFrame(current.blocks[block].box)}
          onClose={() => setBlock(undefined)}
        />
      )}

      {done && data && (
        <ChapterDone
          title={data.mangaTitle}
          chapter={data.name}
          pct={done.pct}
          history={done.history}
          readable={done.readable}
          stamps={done.stamps ?? []}
          collection={done.collection}
          hasNext={!!neighbours.next}
          onNext={() => neighbours.next && navigate(`manga/read/${neighbours.next.key}`)}
          onBack={() => navigate(`manga/m/${data.mangaKey}`)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
