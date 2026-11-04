import { useEffect, useRef, useState } from 'react';
import { api, laptopUp } from '../lib/api.ts';
import { flash, formatTime, navigate } from '../lib/hooks.ts';
import { tokenize, type Lookup } from '../lib/japanese.ts';
import { mineAudioLine, mineText } from '../lib/phone.ts';
import {
  addAudio,
  addPhotos,
  addText,
  audioBlob,
  clipLine,
  countRead,
  fetchArticle,
  finishTranscripts,
  flushRead,
  getText,
  importFile,
  isAudioFile,
  listTexts,
  removeText,
  setProgress,
  wordsReadToday,
  type LineTime,
  type TextMeta,
} from '../lib/texts.ts';
import { Nav } from '../components/Nav.tsx';
import { isWord, TokenText } from '../components/TokenText.tsx';

// Text reader: articles, books and pasted text with unknown words underlined. Tap a word for the dictionary
// and its status; "Add sentence to inbox" mines the sentence around it. Words of paragraphs you read past
// count as words read (XP on the laptop).

export function Texts({ id }: { id?: string }) {
  if (id === 'hook') return <GameText />;
  return id ? <ReadText id={id} /> : <Library />;
}

function Library() {
  const [texts, setTexts] = useState<TextMeta[]>();
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [photoHelp, setPhotoHelp] = useState(false);

  const reload = () => listTexts().then(setTexts, () => setTexts([]));
  useEffect(() => void reload(), []);
  // Recordings the laptop is still transcribing.
  const waiting = texts?.some((t) => t.job);
  useEffect(() => {
    if (!waiting) return;
    const check = () => void finishTranscripts().then(reload, () => undefined);
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, [waiting]);

  async function run(fn: () => Promise<TextMeta>) {
    setBusy(true);
    setError(undefined);
    try {
      const t = await fn();
      navigate(`texts/${t.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // Text copied anywhere: Live Text from a photo or the camera, another app, a web page.
  async function pasteClipboard() {
    let text = '';
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch {
      return setError('Horu may not read the clipboard here. Touch and hold the box above → Paste, then Read pasted text.');
    }
    if (!text) return setError('The clipboard is empty. Copy some Japanese text first.');
    void run(() => addText('', text, 'Clipboard'));
  }

  return (
    <div>
      <Nav back="Manga" to="manga" />
      <h1>Texts</h1>
      {error && <div className="banner error">{error}</div>}

      {!!texts?.length && (
        <div className="group">
          {texts.map((t) => (
            <div key={t.id} className="list-item" role="button" onClick={() => navigate(`texts/${t.id}`)}>
              <div className="grow">
                <div className="text jp ellipsis">{t.title}</div>
                <div className="meta">
                  {t.source} ·{' '}
                  {t.job
                    ? 'The laptop is writing the lines…'
                    : t.error
                      ? t.error
                      : t.progress
                        ? `${Math.round((t.progress / t.paragraphs) * 100)} % read`
                        : `${t.paragraphs} ${t.audio ? 'lines' : 'paragraphs'}`}
                </div>
              </div>
              <button
                className="small ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Remove “${t.title}”?`)) void removeText(t.id).then(reload);
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {texts && !texts.length && (
        <div className="empty">
          <span className="glyph jp" aria-hidden="true">
            読
          </span>
          <b>Nothing to read yet</b>
          <p>Add an article (NHK News Web Easy, a blog, Wikipedia), an EPUB book or any text. Unknown words are underlined.</p>
        </div>
      )}

      <h2>Add</h2>
      <div className="group">
        <label className="field stacked">
          <span>Web page</span>
          <input type="url" inputMode="url" autoCapitalize="off" placeholder="https://www3.nhk.or.jp/news/easy/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="hint">{laptopUp() ? 'Fetched by the laptop.' : 'Needs the laptop (most sites do not let a web app read them). Without it, copy the text and paste it below.'}</div>
        </label>
        <button className="list-item action-row" disabled={busy || !url.trim() || !laptopUp()} onClick={() => run(() => fetchArticle(url.trim()))}>
          Fetch page
        </button>
        <label className="field stacked">
          <span>Paste text</span>
          <textarea rows={4} className="jp" value={paste} onChange={(e) => setPaste(e.target.value)} />
        </label>
        <button className="list-item action-row" disabled={busy || !paste.trim()} onClick={() => run(() => addText('', paste, 'Pasted'))}>
          Read pasted text
        </button>
        <button className="list-item action-row" disabled={busy} onClick={pasteClipboard}>
          Paste from clipboard
        </button>
        <button className="list-item action-row" disabled={busy} onClick={() => file.current?.click()}>
          Open a file (EPUB, TXT, HTML)…
        </button>
        <button className="list-item action-row" disabled={busy} onClick={() => audio.current?.click()}>
          Open audio (podcast, audio book)…
        </button>
        <button className="list-item action-row" disabled={!laptopUp()} onClick={() => navigate('texts/hook')}>
          Game text (Textractor, LunaTranslator)
        </button>
        <button className="list-item action-row" onClick={() => navigate('camera')}>
          Camera: a sign, a menu, a pullover…
        </button>
        <button className="list-item action-row" disabled={busy} onClick={() => (laptopUp() ? photo.current?.click() : setPhotoHelp(!photoHelp))}>
          Photo of a page (book, sign, menu)…
        </button>
      </div>
      {(photoHelp || laptopUp()) && (
        <p className="footnote">
          {laptopUp() ? 'Photos are read by the laptop. ' : ''}On the phone alone: open the photo in Photos (or point the camera at the page), touch and hold the text → Select All → Copy, then tap
          Paste from clipboard. The phone recognises the text itself (Live Text on iPhone, Google Lens on Android).
        </p>
      )}
      <input
        ref={photo}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void run(() => addPhotos(files));
        }}
      />
      <p className="footnote">
        Audio: pick the recording together with its transcript (.srt, .vtt, .lrc) if you have one. Without, the laptop writes the lines with Whisper, which takes about as long as
        the recording.
      </p>
      <input
        ref={audio}
        type="file"
        multiple
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.srt,.vtt,.lrc"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          const sound = files.find(isAudioFile);
          if (!sound) return setError('Pick an audio file (MP3, M4A …).');
          void run(() => addAudio(sound, files.find((f) => f !== sound)));
        }}
      />
      <input
        ref={file}
        type="file"
        accept=".epub,.txt,.html,.htm,.xhtml,application/epub+zip,text/plain,text/html"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void run(() => importFile(f));
        }}
      />
      <p className="footnote">Texts stay on this phone. Words of paragraphs you read past count as words read: {wordsReadToday().toLocaleString()} today.</p>
    </div>
  );
}

/** The sentence of a paragraph that contains [start, end). */
function sentenceAt(text: string, start: number, end: number): string {
  const ends = /[。！？!?]/g;
  let from = 0;
  let to = text.length;
  for (const m of text.matchAll(ends)) {
    const i = m.index! + 1;
    if (i <= start) from = i;
    else if (i >= end) {
      to = i;
      break;
    }
  }
  return text.slice(from, to).trim();
}

function ReadText({ id }: { id: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getText>> | null>();
  const [furigana, setFurigana] = useState(() => localStorage.getItem('horu-furigana') === '1');
  const [read, setRead] = useState(wordsReadToday);
  const player = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);

  useEffect(() => {
    getText(id).then((d) => setData(d ?? null), () => setData(null));
    return flushRead;
  }, [id]);

  // A recording: its sound plays under the lines.
  useEffect(() => {
    if (!data?.meta.audio) return;
    let url: string | undefined;
    void audioBlob(id).then((b) => b && setSrc((url = URL.createObjectURL(b))));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, data?.meta.audio]);

  // Jump to where reading stopped last time.
  useEffect(() => {
    if (!data?.meta.progress) return;
    requestAnimationFrame(() => document.getElementById(`p${data.meta.progress}`)?.scrollIntoView({ block: 'start' }));
  }, [data]);

  if (data === null) return <Nav back="Texts" to="texts" title="Not found" />;
  if (!data) return <Nav back="Texts" to="texts" />;

  function toggleFurigana() {
    localStorage.setItem('horu-furigana', furigana ? '0' : '1');
    setFurigana(!furigana);
  }

  const mine = (text: string, time?: LineTime) => (l: Lookup) => {
    if (!time) {
      mineText(sentenceAt(text, l.start, l.end), l.form, data!.meta.title, data!.meta.source);
      return flash('Sentence added to the inbox');
    }
    void clipLine(id, time)
      .catch(() => undefined)
      .then((clip) => mineAudioLine({ ...time, text }, l.form, data!.meta.title, clip))
      .then((m) => flash(m.hasAudio ? 'Line with its sound added to the inbox' : 'Line added to the inbox (the sound could not be cut)'));
  };

  function playFrom(time: LineTime) {
    const a = player.current;
    if (!a) return;
    a.currentTime = time.start;
    void a.play();
  }

  const times = data.times;
  const current = times ? times.findIndex((t, i) => at >= t.start && at < (times[i + 1]?.start ?? t.end + 1)) : -1;

  return (
    <div>
      <Nav back="Texts" to="texts" />
      <h1 className="jp" style={{ fontSize: 30 }}>
        {data.meta.title}
      </h1>
      <div className="reader-bar">
        <span className="grow">
          {data.meta.source} · {read.toLocaleString()} words read today
        </span>
        <button className="small ghost" onClick={toggleFurigana} aria-pressed={furigana}>
          {furigana ? 'Hide furigana' : 'Furigana'}
        </button>
      </div>
      {data.meta.job && <div className="banner info">The laptop is still writing the lines of this recording. Come back in a while.</div>}
      {src && (
        <div className="audio-bar">
          <audio ref={player} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} />
          <button className="small" onClick={() => (playing ? player.current?.pause() : void player.current?.play())}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <span className="num grow">{formatTime(at)}</span>
          <button className="small ghost" onClick={() => player.current && (player.current.currentTime = Math.max(0, at - 5))}>
            −5 s
          </button>
        </div>
      )}
      <div className="reader-text" key={String(furigana)}>
        {data.paragraphs.map((p, i) => (
          <Paragraph
            key={i}
            index={i}
            text={p}
            time={times?.[i]}
            current={i === current}
            onPlay={times?.[i] ? () => playFrom(times[i]) : undefined}
            onPick={mine(p, times?.[i])}
            onReadPast={(words) => {
              countRead(words);
              setRead(wordsReadToday());
              if (i + 1 > data.meta.progress) {
                data.meta.progress = i + 1;
                void setProgress(id, i + 1);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** One paragraph: plain text until it comes near the screen, then tokenized and underlined. */
function Paragraph({
  index,
  text,
  time,
  current,
  onPlay,
  onPick,
  onReadPast,
}: {
  index: number;
  text: string;
  time?: LineTime;
  current?: boolean;
  onPlay?: () => void;
  onPick: (l: Lookup) => void;
  onReadPast: (words: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const counted = useRef(false);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setNear(true);
        // Scrolled above the top of the screen: read.
        if (!e.isIntersecting && e.boundingClientRect.bottom < 0 && !counted.current) {
          counted.current = true;
          void tokenize(text).then((t) => onReadPast(t.filter(isWord).length), () => undefined);
        }
      },
      { rootMargin: '600px 0px 600px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div ref={el} id={`p${index}`} className={time ? `line${current ? ' current' : ''}` : undefined}>
      {time && (
        <button className="line-time num" onClick={onPlay} aria-label={`Play from ${formatTime(time.start)}`}>
          {formatTime(time.start)}
        </button>
      )}
      {near ? (
        <TokenText text={text} className="reader-p" highlight furiganaToggle={false} onPick={onPick} pickLabel="Add sentence to inbox" />
      ) : (
        <div className="reader-p plain jp">{text}</div>
      )}
    </div>
  );
}

/** Lines from a game or visual novel, as the text hooker on the laptop sends them; newest at the bottom. */
function GameText() {
  const [lines, setLines] = useState<{ id: number; text: string }[]>([]);
  const [state, setState] = useState<{ connected: boolean; url: string; error?: string }>();
  const [title, setTitle] = useState(() => localStorage.getItem('horu-game-title') ?? '');
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api.hookLines(last.current).then(
        (r) => {
          if (!alive) return;
          setState({ connected: r.connected, url: r.url });
          if (r.lines.length) {
            last.current = r.lines[r.lines.length - 1].id;
            setLines((l) => [...l, ...r.lines].slice(-200));
            requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
          }
        },
        (e: Error) => alive && setState({ connected: false, url: '', error: e.message }),
      );
    void poll();
    const id = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const mine = (text: string) => (l: Lookup) => {
    mineText(sentenceAt(text, l.start, l.end), l.form, title.trim() || 'Game', 'Game');
    flash('Line added to the inbox');
  };

  return (
    <div>
      <Nav back="Texts" to="texts" />
      <h1>Game text</h1>
      <div className="group">
        <label className="field">
          <span>Game</span>
          <input
            value={title}
            placeholder="Title for the cards"
            onChange={(e) => {
              setTitle(e.target.value);
              localStorage.setItem('horu-game-title', e.target.value);
            }}
          />
        </label>
      </div>
      <p className="footnote">
        {state?.error
          ? state.error
          : state?.connected
            ? `Connected to the text hooker (${state.url}).`
            : `Waiting for the text hooker at ${state?.url || '…'}. Start Textractor with its WebSocket extension, or LunaTranslator with its WebSocket output, next to the game. Change the address under Settings → Games.`}
      </p>
      <div className="reader-text">
        {lines.map((l) => (
          <TokenText key={l.id} text={l.text} className="reader-p" highlight furiganaToggle={false} onPick={mine(l.text)} pickLabel="Add line to inbox" />
        ))}
        <div ref={end} />
      </div>
      {!lines.length && state?.connected && <p className="footnote center">No lines yet. Play on; new lines appear here.</p>}
    </div>
  );
}
