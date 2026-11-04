import type { Msg } from './messages.ts';

// Sluka-style reading help on any web page, switched on per site (context menu or Alt+Shift+J):
// words that are not known yet get a coloured underline (new = strong, status 1-3 = fainter), hovering one
// shows the dictionary, its status buttons and "Add to inbox". The same runs on the subtitle overlay that can
// be shown over the recorded video (context menu → Subtitles over the video).

type Word = { start: number; end: number; base: string; reading: string; status?: number; known: boolean };
type Entry = [string, string, 0 | 1, string, string];
type Extra = { defs: { dict: string; reading: string; gloss: string }[]; freq?: { rank: number }; pitch?: { reading: string; positions: number[] }[] };

const JP = /[぀-ヿ㐀-鿿々]/;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE', 'PRE', 'svg']);
const MAX_NODES = 4000;

const api = <T>(path: string, body?: unknown): Promise<T> =>
  chrome.runtime.sendMessage({ type: 'api', path, body } satisfies Msg).then((r: T & { error?: string }) => {
    if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(r.error);
    return r;
  });

const understood = (w: Word) => w.known || w.status === 4 || w.status === -1;

// ---- page styles and popup host ----

const CSS = `
.horu-w { border-bottom: 2px solid rgba(214, 72, 50, 0.85); cursor: pointer; border-radius: 1px; }
.horu-w.horu-s1 { border-bottom-color: rgba(214, 72, 50, 0.55); }
.horu-w.horu-s2 { border-bottom-color: rgba(214, 72, 50, 0.35); }
.horu-w.horu-s3 { border-bottom-color: rgba(214, 72, 50, 0.2); }
.horu-w:hover { background: rgba(214, 72, 50, 0.12); }
.horu-overlay { position: fixed; z-index: 2147483646; pointer-events: auto; text-align: center; font: 500 26px/1.45 "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  color: #fff; text-shadow: 0 0 4px #000, 0 0 2px #000, 0 2px 3px #000; padding: 0 12px; box-sizing: border-box; }
.horu-overlay .horu-w { border-bottom-width: 3px; }
`;

let styled = false;
function addStyles(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  (document.head ?? document.documentElement).append(style);
}

// ---- highlighting ----

const done = new WeakSet<Text>();
let enabled = false;
let processed = 0;
let observer: MutationObserver | undefined;
let selfMutating = false;

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || done.has(n as Text) || !JP.test(n.nodeValue ?? '')) return NodeFilter.FILTER_REJECT;
      if (SKIP.has(p.tagName) || p.isContentEditable || p.closest('.horu-w, #horu-popup-host, rt')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode() && out.length + processed < MAX_NODES) out.push(walker.currentNode as Text);
  return out;
}

function wrap(node: Text, words: Word[]): void {
  done.add(node);
  const text = node.nodeValue ?? '';
  const marks = words.filter((w) => !understood(w));
  if (!marks.length || !node.parentNode) return;
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const w of marks) {
    if (w.start > pos) frag.append(text.slice(pos, w.start));
    const span = document.createElement('span');
    span.className = `horu-w horu-s${w.status ?? 0}`;
    span.dataset.b = w.base;
    span.dataset.r = w.reading;
    span.textContent = text.slice(w.start, w.end);
    frag.append(span);
    pos = w.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  selfMutating = true;
  node.parentNode.replaceChild(frag, node);
  selfMutating = false;
}

async function highlight(root: Node): Promise<void> {
  const nodes = textNodes(root);
  // The page has a budget so huge pages stay responsive; the subtitle overlay does not count.
  if (root !== overlay) processed += nodes.length;
  for (let i = 0; i < nodes.length; ) {
    const batch: Text[] = [];
    let size = 0;
    while (i < nodes.length && batch.length < 60 && size < 6000) {
      size += nodes[i].nodeValue!.length;
      batch.push(nodes[i++]);
    }
    let result: Word[][];
    try {
      result = await api<Word[][]>('/api/text/analyse', { texts: batch.map((n) => n.nodeValue ?? '') });
    } catch {
      return; // service not running: leave the page as it is
    }
    addStyles();
    batch.forEach((n, k) => wrap(n, result[k] ?? []));
  }
}

let pending: Node[] = [];
let timer: number | undefined;
function onMutations(list: MutationRecord[]): void {
  if (selfMutating) return;
  for (const m of list) for (const n of m.addedNodes) if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) pending.push(n);
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const roots = pending.filter((n) => n.isConnected);
    pending = [];
    for (const r of roots) void highlight(r.nodeType === Node.TEXT_NODE ? r.parentNode ?? r : r);
  }, 700);
}

function setEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  if (on) {
    void highlight(document.body);
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true, characterData: false });
  } else {
    observer?.disconnect();
    // Unwrap what was marked.
    for (const span of document.querySelectorAll<HTMLElement>('.horu-w')) if (!span.closest('.horu-overlay')) span.replaceWith(span.textContent ?? '');
    document.body.normalize();
    processed = 0;
  }
}

// ---- popup ----

let host: HTMLElement | undefined;
let shadow: ShadowRoot | undefined;
let hideTimer: number | undefined;

const POPUP_CSS = `
:host { all: initial; }
.box { position: fixed; z-index: 2147483647; width: 320px; max-height: 360px; overflow: auto; background: #1d1a17; color: #eee7da; border-radius: 10px;
  box-shadow: 0 12px 34px rgba(0,0,0,.45); padding: 14px 16px; font: 14px/1.45 system-ui, sans-serif; }
.head { font: 500 26px/1.2 "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif; }
.reading { color: #a39887; font-size: 15px; margin-left: 8px; }
.meta { color: #a39887; font-size: 12.5px; margin: 4px 0 8px; }
ol { margin: 6px 0 0; padding-left: 20px; } li { margin: 2px 0; }
.dict { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #a39887; margin-top: 8px; }
.row { display: flex; gap: 4px; margin: 10px 0 0; }
button { flex: 1; font: 12.5px system-ui, sans-serif; color: #eee7da; background: transparent; border: 1px solid #403a33; border-radius: 6px; padding: 5px 2px; cursor: pointer; }
button.on { background: #eee7da; color: #1d1a17; border-color: #eee7da; }
button.mine { margin-top: 8px; width: 100%; background: #e4604a; border-color: #e4604a; color: #fff; padding: 8px; font-size: 13.5px; }
.note { color: #a39887; font-size: 12.5px; margin-top: 6px; }
`;

function popupRoot(): ShadowRoot {
  if (shadow) return shadow;
  host = document.createElement('div');
  host.id = 'horu-popup-host';
  (document.fullscreenElement ?? document.documentElement).append(host);
  shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = POPUP_CSS;
  shadow.append(style);
  return shadow;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const STATUS = [
  [0, 'New'],
  [1, '1'],
  [2, '2'],
  [3, '3'],
  [4, 'Known'],
  [-1, 'Ignore'],
] as const;

/** The sentence around a word: the text of its block, cut at sentence ends. */
function sentenceAround(span: HTMLElement): string {
  const block = span.closest('p, li, div, td, h1, h2, h3, h4, blockquote, .horu-overlay') ?? span.parentElement!;
  const text = block.textContent ?? '';
  const before = textBefore(block, span);
  const start = Math.max(...['。', '！', '？', '!', '?', '\n'].map((c) => text.lastIndexOf(c, before - 1))) + 1;
  const ends = ['。', '！', '？', '!', '?', '\n'].map((c) => text.indexOf(c, before)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start, end).trim().slice(0, 300);
}

function textBefore(block: Element, target: Node): number {
  let n = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (target.contains(walker.currentNode)) return n;
    n += walker.currentNode.nodeValue?.length ?? 0;
  }
  return n;
}

async function show(span: HTMLElement): Promise<void> {
  clearTimeout(hideTimer);
  const root = popupRoot();
  if (host && !host.isConnected) (document.fullscreenElement ?? document.documentElement).append(host);
  root.querySelector('.box')?.remove();
  const box = document.createElement('div');
  box.className = 'box';
  const r = span.getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(innerWidth - 336, r.left))}px`;
  box.style[r.bottom + 380 > innerHeight ? 'bottom' : 'top'] = r.bottom + 380 > innerHeight ? `${innerHeight - r.top + 6}px` : `${r.bottom + 6}px`;
  box.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  box.addEventListener('mouseleave', scheduleHide);
  const base = span.dataset.b ?? span.textContent ?? '';
  box.innerHTML = `<div><span class="head">${esc(base)}</span><span class="reading">${esc(span.dataset.r ?? '')}</span></div><div class="note">Looking up…</div>`;
  root.append(box);
  const [entries, extras] = await Promise.all([
    api<Record<string, Entry[]>>('/api/lookup', { forms: [base] }).catch(() => ({}) as Record<string, Entry[]>),
    api<Record<string, Extra>>('/api/dicts/lookup', { forms: [base] }).catch(() => ({}) as Record<string, Extra>),
  ]);
  const extra = extras[base];
  const statusNow = Number(/horu-s(-?\d)/.exec(span.className)?.[1] ?? 0);
  const meta = [extra?.freq && `Frequency #${extra.freq.rank}`, extra?.pitch?.[0] && `${extra.pitch[0].reading} [${extra.pitch[0].positions.join(',')}]`].filter(Boolean).join(' · ');
  box.innerHTML = `
    <div><span class="head">${esc(base)}</span><span class="reading">${esc(entries[base]?.[0]?.[1].split('|')[0] ?? span.dataset.r ?? '')}</span></div>
    ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
    ${(entries[base] ?? [])
      .slice(0, 2)
      .map((e) => `<ol>${e[3].split(' / ').slice(0, 3).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`)
      .join('')}
    ${(extra?.defs ?? []).slice(0, 2).map((d) => `<div class="dict">${esc(d.dict)}</div><div>${esc(d.gloss)}</div>`).join('')}
    ${!entries[base]?.length && !extra?.defs.length ? '<div class="note">No dictionary entry.</div>' : ''}
    <div class="row">${STATUS.map(([v, l]) => `<button data-s="${v}" class="${v === statusNow ? 'on' : ''}">${l}</button>`).join('')}</div>
    <button class="mine">Add sentence to inbox</button>
    <div class="note" hidden></div>`;
  const note = box.querySelector<HTMLElement>('.note[hidden]')!;
  for (const b of box.querySelectorAll<HTMLButtonElement>('[data-s]'))
    b.addEventListener('click', async () => {
      const status = Number(b.dataset.s);
      await api('/api/insights/status', { word: base, status }).catch(() => undefined);
      box.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
      restyle(base, status);
    });
  box.querySelector('.mine')!.addEventListener('click', async () => {
    const sentence = sentenceAround(span);
    try {
      await api('/api/text/mine', { sentence, word: base, title: document.title, url: location.href });
      note.textContent = `Added: ${sentence}`;
    } catch (e) {
      note.textContent = (e as Error).message;
    }
    note.hidden = false;
  });
}

function restyle(base: string, status: number): void {
  for (const s of document.querySelectorAll<HTMLElement>('.horu-w')) {
    if (s.dataset.b !== base) continue;
    if (status === 4 || status === -1) s.replaceWith(s.textContent ?? '');
    else s.className = `horu-w horu-s${status}`;
  }
}

function scheduleHide(): void {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => shadow?.querySelector('.box')?.remove(), 350);
}

let hoverTimer: number | undefined;
document.addEventListener(
  'mouseover',
  (e) => {
    const span = (e.target as Element | null)?.closest?.('.horu-w') as HTMLElement | null;
    clearTimeout(hoverTimer);
    if (span) hoverTimer = window.setTimeout(() => void show(span), 250);
  },
  true,
);
document.addEventListener(
  'mouseout',
  (e) => {
    if ((e.target as Element | null)?.closest?.('.horu-w')) {
      clearTimeout(hoverTimer);
      scheduleHide();
    }
  },
  true,
);
document.addEventListener('keydown', (e) => e.key === 'Escape' && shadow?.querySelector('.box')?.remove());

// ---- subtitle overlay over the recorded video ----

let cues: { start: number; end: number; text: string }[] = [];
let overlay: HTMLElement | undefined;
let overlayTimer: number | undefined;
let shownCue = -1;

function mainVideo(): HTMLVideoElement | undefined {
  let best: HTMLVideoElement | undefined;
  let area = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (v.duration > 30 && r.width * r.height > area) {
      best = v;
      area = r.width * r.height;
    }
  }
  return best;
}

function tickOverlay(): void {
  const video = mainVideo();
  if (!video || !overlay) return;
  const parent = document.fullscreenElement ?? document.documentElement;
  if (overlay.parentNode !== parent) parent.append(overlay);
  const r = video.getBoundingClientRect();
  overlay.style.left = `${r.left}px`;
  overlay.style.width = `${r.width}px`;
  overlay.style.bottom = `${Math.max(0, innerHeight - r.bottom) + r.height * 0.1}px`;
  const t = video.currentTime;
  const i = cues.findIndex((c) => c.start <= t && c.end >= t);
  if (i === shownCue) return;
  shownCue = i;
  overlay.textContent = i >= 0 ? cues[i].text : '';
  if (i >= 0) void highlight(overlay);
}

function setOverlay(on: boolean, list?: typeof cues): void {
  clearInterval(overlayTimer);
  overlay?.remove();
  overlay = undefined;
  shownCue = -1;
  if (!on || !list?.length || !mainVideo()) return;
  cues = list;
  addStyles();
  overlay = document.createElement('div');
  overlay.className = 'horu-overlay';
  overlayTimer = window.setInterval(tickOverlay, 200);
}

// ---- switches ----

const site = location.hostname;
chrome.storage.local.get('highlightSites').then((s) => setEnabled(((s.highlightSites as string[] | undefined) ?? []).includes(site)));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.highlightSites) setEnabled(((changes.highlightSites.newValue as string[] | undefined) ?? []).includes(site));
});
chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.type === 'overlay') setOverlay(msg.enabled, msg.cues);
});
