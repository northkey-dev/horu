import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { formatTime, useEventTick, usePoll, useWakeLock } from '../lib/hooks.ts';
import { micActive, startMic, stopMic } from '../lib/mic.ts';
import {
  MIC_SECONDS,
  currentSession,
  endPhoneSession,
  loadSubtitleFile,
  markPhone,
  micWanted,
  nudgeClock,
  pauseClock,
  phoneJimaku,
  phoneJimakuKey,
  recentPhoneSessions,
  sessionCues,
  setClock,
  setMicWanted,
  startClock,
  startPhoneSession,
  takeRemoteMarks,
  tickClock,
  followClock,
  undoPhone,
  videoTime,
  videoTimeAt,
  type PhoneSession,
} from '../lib/phone.ts';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import { WordPrep } from '../components/WordPrep.tsx';
import type { Cue, JimakuEntry, JimakuFile, Session as SessionInfo, Status } from '../../../shared/types.ts';

export function Watch({ status, refreshStatus }: { status?: Status; refreshStatus: () => void }) {
  useEventTick('horu-phone');
  const phone = currentSession();
  if (phone) return <PhoneWatch session={phone} player={status?.player} />;
  if (status?.session) return <Session status={status} refreshStatus={refreshStatus} />;
  return <StartEpisode status={status} onStarted={refreshStatus} />;
}

/** The big button, shared by laptop and phone episodes. */
function MarkButton({ count, flash, onMark }: { count: number; flash?: 'ok' | 'fail'; onMark: () => void }) {
  return (
    <button className={`mark-btn${flash === 'ok' ? ' flash' : ''}${flash === 'fail' ? ' fail' : ''}`} onClick={onMark} aria-label="Mark this moment">
      <svg className="enso" viewBox="0 0 236 236" fill="none" aria-hidden="true">
        <path d="M178 38 A100 100 0 1 0 214 128" strokeWidth="9" strokeLinecap="round" />
        <path d="M176 44 A95 95 0 1 0 209 124" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      </svg>
      <span className="mark-label">
        <b>Mark</b>
        <small>
          {count ? (
            <>
              <b>{count}</b> this episode
            </>
          ) : (
            'tap right after a line'
          )}
        </small>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- laptop episode

function Session({ status, refreshStatus }: { status: Status; refreshStatus: () => void }) {
  const session = status.session!;
  const [flash, setFlash] = useState<'ok' | 'fail'>();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(0);
  const busy = useRef(false);
  const wake = useWakeLock(true);
  const uploadRef = useRef<HTMLInputElement>(null);

  const recording = status.extensionRecording;
  const count = status.sessionMarks + pending;

  async function mark() {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => (busy.current = false), 700);
    setFlash('ok');
    setPending((p) => p + 1);
    try {
      await api.mark();
      setMessage(undefined);
      refreshStatus();
    } catch (e) {
      setFlash('fail');
      setMessage((e as Error).message);
    } finally {
      setPending((p) => p - 1);
    }
    setTimeout(() => setFlash(undefined), 600);
  }

  async function undo() {
    const { removed } = await api.undo().catch(() => ({ removed: null }));
    setMessage(removed ? 'Last mark removed.' : 'Nothing to undo.');
    refreshStatus();
  }

  async function upload(file: File) {
    try {
      await api.uploadSubtitles(session.id, file);
      setMessage(`Subtitles loaded: ${file.name}`);
      refreshStatus();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <div>
      <Nav>
        <button
          className="strong"
          onClick={async () => {
            await api.endSession();
            refreshStatus();
          }}
        >
          End
        </button>
      </Nav>
      <div className="now">
        <div className="eyebrow">Now watching</div>
        <div className="title clamp">{session.title}</div>
        <div className="italic episode">Episode {session.episode}</div>
      </div>

      <div className="group facts">
        <div className="cell">
          <span className="grow muted">Chrome</span>
          <span className={`status ${recording ? 'rec' : 'bad'}`}>
            <span className="dot" />
            {recording ? 'Recording' : 'Not recording'}
          </span>
        </div>
        <div className="cell">
          <span className="grow muted">Subtitles</span>
          <span className="status">{session.cueCount ? `${session.cueCount} lines` : status.whisperAvailable ? 'Whisper listens' : 'None'}</span>
        </div>
        {wake && (
          <div className="cell">
            <span className="grow muted">Screen</span>
            <span className="status">Stays on</span>
          </div>
        )}
      </div>

      {!recording && (
        <div className="banner" style={{ marginTop: 16 }}>
          On the laptop, click the Horu icon in Chrome on the anime tab, or press <b>Alt+Shift+H</b>. Once per episode.
        </div>
      )}

      <div className="mark-wrap">
        <MarkButton count={count} flash={flash} onMark={mark} />
        <div className="mark-actions">
          <button className="ghost" onClick={undo}>
            <Icon name="undo" size={19} /> Undo
          </button>
          {!session.cueCount && (
            <button className="ghost" onClick={() => uploadRef.current?.click()}>
              <Icon name="upload" size={19} /> Subtitles
            </button>
          )}
        </div>
        {message && <p className="footnote center">{message}</p>}
        <input ref={uploadRef} type="file" accept=".srt,.ass,.ssa,.vtt,.zip" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- phone episode

/** "12:34" or "1:02:03" → seconds. */
const RETURN_MARKS = 'horu-return-marks';
function returnMarks(): boolean {
  try {
    return localStorage.getItem(RETURN_MARKS) === '1';
  } catch {
    return false;
  }
}
function setReturnMarks(on: boolean): void {
  try {
    localStorage.setItem(RETURN_MARKS, on ? '1' : '0');
  } catch {
    // remembered for this visit only
  }
}

function parseTime(text: string): number | undefined {
  const parts = text.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  return parts.reduce((sum, n) => sum * 60 + n, 0);
}

function PhoneWatch({ session, player }: { session: PhoneSession; player?: string }) {
  const [, setNow] = useState(0);
  const [follow, setFollow] = useState<{ on: boolean; note?: string }>({ on: false });
  const [cues, setCues] = useState<Cue[]>([]);
  const [mic, setMic] = useState(micActive);
  const [flash, setFlash] = useState<'ok' | 'fail'>();
  const [message, setMessage] = useState<string>();
  const busy = useRef(false);
  const wake = useWakeLock(true);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [away, setAway] = useState<number>();
  const [autoMark, setAutoMark] = useState(returnMarks);

  useEffect(() => {
    const draw = setInterval(() => setNow(Date.now()), 500);
    const save = setInterval(tickClock, 5000);
    return () => {
      clearInterval(draw);
      clearInterval(save);
    };
  }, []);
  useEffect(() => void sessionCues(session.id).then(setCues), [session.id, session.cueCount]);
  // The clock follows the media player the laptop watches.
  useEffect(() => {
    if (!follow.on || !player) return;
    const poll = () =>
      api.playerNow().then(
        (now) => {
          if (!now) return setFollow({ on: true, note: 'Nothing playing' });
          followClock(now.position, now.playing);
          setFollow({ on: true, note: `${now.title}${now.episode ? ` · Ep ${now.episode}` : ''}` });
        },
        (e: Error) => setFollow({ on: true, note: e.message }),
      );
    void poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [follow.on, player]);
  // Watching on this phone: the video plays fullscreen in Safari or a streaming app, you hear a line and switch
  // to Horu (the video keeps playing as picture-in-picture). Coming back offers a mark at the moment you left.
  useEffect(() => {
    let left: number | undefined;
    const onVisibility = () => {
      if (document.hidden) {
        left = currentSession()?.clock.running ? Date.now() : undefined;
        return;
      }
      void takeRemoteMarks().catch(() => 0);
      if (left && Date.now() - left > 2500) {
        if (returnMarks()) void mark(left);
        else setAway(left);
      }
      left = undefined;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  // Marks from a Shortcut (Back Tap, Action button) reach the laptop; pick them up while this screen is open.
  useEffect(() => {
    const id = setInterval(() => void takeRemoteMarks().catch(() => 0), 4000);
    return () => clearInterval(id);
  }, []);
  // The microphone only listens while this screen is open.
  useEffect(() => () => stopMic(), []);

  const clock = session.clock;
  const t = videoTime(clock);
  let now = -1;
  while (now + 1 < cues.length && cues[now + 1].start <= t) now++;
  const lines = now < 0 ? cues.slice(0, 3) : cues.slice(Math.max(0, now - 2), now + 3);
  const current = now >= 0 && cues[now].end >= t - 1 ? cues[now] : undefined;

  async function micOn(): Promise<void> {
    try {
      await startMic(MIC_SECONDS);
      setMic(true);
      setMicWanted(true);
    } catch (e) {
      setMessage((e as Error).name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it for Horu in the phone settings.' : `Microphone: ${(e as Error).message}`);
    }
  }

  function toggleMic() {
    if (!mic) return void micOn();
    stopMic();
    setMic(false);
    setMicWanted(false);
  }

  function startOrPause() {
    if (clock.running) return pauseClock();
    startClock();
    if (micWanted() && !micActive()) void micOn();
  }

  function editTime() {
    const typed = prompt('Time shown on the screen right now, e.g. 12:34', formatTime(t));
    const seconds = typed === null ? undefined : parseTime(typed);
    if (seconds !== undefined) setClock(seconds);
  }

  async function mark(at?: number) {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => (busy.current = false), 700);
    setFlash('ok');
    setAway(undefined);
    try {
      const m = await markPhone(at);
      setMessage(at ? `Marked ${formatTime(m.videoTime ?? 0)}, when you left.` : undefined);
    } catch (e) {
      setFlash('fail');
      setMessage((e as Error).message);
    }
    setTimeout(() => setFlash(undefined), 600);
  }

  async function undo() {
    setMessage((await undoPhone()) ? 'Last mark removed.' : 'Nothing to undo.');
  }

  async function upload(file: File) {
    try {
      setMessage(`Subtitles loaded: ${await loadSubtitleFile(file)} lines`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <div>
      <Nav>
        <button
          className="strong"
          onClick={() => {
            stopMic();
            endPhoneSession();
          }}
        >
          End
        </button>
      </Nav>
      <div className="now">
        <div className="eyebrow">Now watching · on this phone</div>
        <div className="title clamp">{session.title}</div>
        <div className="italic episode">Episode {session.episode}</div>
      </div>

      <div className="clock">
        <button className="ghost small" onClick={() => nudgeClock(-5)} aria-label="5 seconds back">
          −5 s
        </button>
        <button className="clock-time num" onClick={editTime} aria-label="Set the time">
          {formatTime(t)}
        </button>
        <button className="ghost small" onClick={() => nudgeClock(5)} aria-label="5 seconds ahead">
          +5 s
        </button>
      </div>
      {away !== undefined && (
        <div className="banner away">
          <div>
            Back from the video? Mark <b className="num">{formatTime(videoTimeAt(session, away))}</b>, the moment you left.
          </div>
          <div className="row">
            <button className="primary" onClick={() => mark(away)}>
              Mark {formatTime(videoTimeAt(session, away))}
            </button>
            <button className="ghost" onClick={() => setAway(undefined)}>
              Not now
            </button>
          </div>
        </div>
      )}
      {cues.length > 0 ? (
        <div className="live-lines" aria-label="Subtitles; tap the line you hear right now to sync the clock">
          {lines.map((c) => (
            <button key={`${c.start}-${c.text}`} className={`jp${c === current ? ' now' : ''}`} onClick={() => setClock(c.start + 0.4)}>
              {c.text}
            </button>
          ))}
        </div>
      ) : (
        <div className="clock-line jp"> </div>
      )}
      {cues.length > 0 && <p className="footnote center">Out of sync? Tap the line the moment you hear it.</p>}
      <button className={`block${clock.running ? '' : ' primary'}`} onClick={startOrPause} style={{ marginTop: 12 }}>
        <Icon name={clock.running ? 'stop' : 'play'} size={17} /> {clock.running ? 'Pause clock' : t ? 'Resume clock' : 'Start clock with the episode'}
      </button>
      {!clock.running && !t && (
        <p className="footnote">Already running on the TV? Tap the time and type what the screen shows, then nudge it until the line above matches what you hear.</p>
      )}

      <div className="group facts">
        <div className="cell">
          <span className="grow muted">Subtitles</span>
          <span className="status">{session.cueCount ? `${session.cueCount} lines` : 'None'}</span>
        </div>
        <button className="cell list-item" onClick={toggleMic}>
          <span className="grow muted">Microphone</span>
          <span className={`status ${mic ? 'rec' : ''}`}>
            {mic && <span className="dot" />}
            {mic ? `Keeps the last ${MIC_SECONDS} s` : 'Off · tap to listen'}
          </span>
        </button>
        <button
          className="cell list-item"
          onClick={() => {
            setReturnMarks(!autoMark);
            setAutoMark(!autoMark);
          }}
        >
          <span className="grow muted">Coming back to Horu</span>
          <span className="status">{autoMark ? 'Marks right away' : 'Asks to mark'}</span>
        </button>
        {player && (
          <button className="cell list-item" onClick={() => setFollow({ on: !follow.on })}>
            <span className="grow muted">Clock</span>
            <span className={`status ${follow.on ? 'rec' : ''}`}>
              {follow.on && <span className="dot" />}
              {follow.on ? `Follows ${player}${follow.note ? ` · ${follow.note}` : ''}` : `Follow ${player}`}
            </span>
          </button>
        )}
        {wake && (
          <div className="cell">
            <span className="grow muted">Screen</span>
            <span className="status">Stays on</span>
          </div>
        )}
      </div>

      <div className="mark-wrap">
        <MarkButton count={session.marks} flash={flash} onMark={() => mark()} />
        <div className="mark-actions">
          <button className="ghost" onClick={undo}>
            <Icon name="undo" size={19} /> Undo
          </button>
          {!session.cueCount && (
            <button className="ghost" onClick={() => uploadRef.current?.click()}>
              <Icon name="upload" size={19} /> Subtitles
            </button>
          )}
        </div>
        {message && <p className="footnote center">{message}</p>}
        <p className="footnote center">Marks stay on this phone and move to the laptop when it is reachable.</p>
        <details className="footnote help">
          <summary>Watching on this phone?</summary>
          <p>Start the clock here, then play the episode fullscreen in Safari or the streaming app. When a line catches you, swipe up: the video keeps playing small (picture-in-picture), and Horu offers a mark at the moment you left. Or keep Horu open with the video small on top and tap Mark.</p>
          <p>With the laptop on, a double tap on the back of the phone can mark without leaving the video: Settings → Laptop → Mark without opening Horu.</p>
        </details>
        <input ref={uploadRef} type="file" accept=".srt,.ass,.ssa,.vtt,.zip" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- start

type Recent = SessionInfo & { nextEpisode: number };

/** Laptop and phone history together, one entry per anime with the furthest episode. */
function mergeRecent(laptop: Recent[] = [], phone: Recent[] = []): Recent[] {
  const byKey = new Map<string, Recent>();
  for (const s of [...phone, ...laptop]) {
    const key = s.jimakuEntryId ? `j${s.jimakuEntryId}` : s.title;
    const seen = byKey.get(key);
    if (!seen || s.nextEpisode > seen.nextEpisode) byKey.set(key, s);
  }
  return [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function StartEpisode({ status, onStarted }: { status?: Status; onStarted: () => void }) {
  const recent = usePoll(() => api.recentSessions(), 60_000);
  const [chosen, setChosen] = useState<'laptop' | 'phone'>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JimakuEntry[]>();
  const [searching, setSearching] = useState(false);
  const [entry, setEntry] = useState<JimakuEntry>();
  const [episode, setEpisode] = useState(1);
  const [files, setFiles] = useState<JimakuFile[]>();
  const [fileIdx, setFileIdx] = useState(0);
  const [manualTitle, setManualTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();

  // Without a reachable laptop the phone watches on its own; with one, you pick where the episode runs.
  const mode = status ? (chosen ?? 'laptop') : 'phone';
  const ownKey = Boolean(phoneJimakuKey());
  const jimakuReady = mode === 'phone' ? ownKey || Boolean(status?.jimakuConfigured) : Boolean(status?.jimakuConfigured);
  const jimaku =
    mode === 'phone' && ownKey ? { search: phoneJimaku.searchEntries, files: phoneJimaku.listFiles } : { search: api.searchJimaku, files: api.jimakuFiles };
  const history = mergeRecent(recent.data, recentPhoneSessions());

  async function search() {
    setError(undefined);
    setEntry(undefined);
    setSearching(true);
    try {
      setResults(await jimaku.search(query));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  /** One tap on "Continue": the next episode with the subtitle file Jimaku lists first, no detour over the detail page. */
  async function continueWatching(s: Recent) {
    if (!s.jimakuEntryId) return void start({ title: s.title, episode: s.nextEpisode });
    setBusy(true);
    setError(undefined);
    let file: JimakuFile | undefined;
    try {
      file = (await jimaku.files(s.jimakuEntryId, s.nextEpisode))[0];
    } catch (e) {
      setBusy(false);
      return setError((e as Error).message);
    }
    await start({ title: s.title, entry: { id: s.jimakuEntryId, name: s.title, anilist_id: s.anilistId }, episode: s.nextEpisode, file });
  }

  function choose(e: JimakuEntry, ep?: number) {
    setEntry(e);
    const last = history.find((s) => s.jimakuEntryId === e.id);
    const nextEp = ep ?? last?.nextEpisode ?? 1;
    setEpisode(nextEp);
    void loadFiles(e.id, nextEp);
  }

  async function loadFiles(id: number, ep: number) {
    setFiles(undefined);
    setFileIdx(0);
    try {
      setFiles(await jimaku.files(id, ep));
    } catch (e) {
      setFiles([]);
      setError((e as Error).message);
    }
  }

  function changeEpisode(ep: number) {
    const next = Math.max(1, ep);
    setEpisode(next);
    if (entry) void loadFiles(entry.id, next);
  }

  async function start(body: { title: string; entry?: JimakuEntry; episode: number; file?: JimakuFile }) {
    setBusy(true);
    setError(undefined);
    try {
      const { warning } =
        mode === 'phone'
          ? await startPhoneSession(body)
          : await api.startSession({
              title: body.title,
              jimakuEntryId: body.entry?.id,
              anilistId: body.entry?.anilist_id ?? undefined,
              episode: body.episode,
              fileUrl: body.file?.url,
              fileName: body.file?.name,
            });
      setWarning(warning);
      onStarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = (e: JimakuEntry) => e.english_name || e.name;

  return (
    <div>
      <Nav />
      <h1>Watch</h1>
      {status && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Where the episode runs">
            {(['laptop', 'phone'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setChosen(m)}>
                {m === 'laptop' ? 'Laptop · Chrome' : 'TV or other screen'}
              </button>
            ))}
          </div>
          <p className="footnote">
            {mode === 'laptop'
              ? 'Chrome on the laptop records audio and a screenshot for every mark.'
              : 'The phone keeps time and can listen through its microphone. For TV apps, consoles, the cinema.'}
          </p>
        </>
      )}
      {!jimakuReady && (
        <div className="banner">
          {mode === 'phone'
            ? 'Add your free Jimaku API key in Settings → This phone to load Japanese subtitles. Without them, turn on the microphone: Whisper transcribes your marks once the laptop has them.'
            : 'Add your free Jimaku API key in Settings to load Japanese subtitles automatically. Until then Whisper transcribes what you mark.'}{' '}
          <a href="#/settings">Settings</a>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      {warning && <div className="banner">{warning}</div>}

      {entry ? (
        <>
          <h2>Episode</h2>
          <div className="group">
            <div className="cell">
              <div className="grow">
                <h3>{title(entry)}</h3>
                {entry.japanese_name && <div className="sub jp">{entry.japanese_name}</div>}
              </div>
              <button className="ghost small" onClick={() => setEntry(undefined)}>
                Change
              </button>
            </div>
            <EpisodeCell value={episode} onChange={setEpisode} onCommit={changeEpisode} />
            {files && files.length > 1 && (
              <label className="field">
                <span>Subtitles</span>
                <select value={fileIdx} onChange={(e) => setFileIdx(Number(e.target.value))}>
                  {files.map((f, i) => (
                    <option key={f.url} value={i}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="footnote">
            {files === undefined
              ? 'Looking for Japanese subtitles…'
              : files.length
                ? `Japanese subtitles found${files.length > 1 ? ` · ${files.length} files` : ''}.`
                : 'No Japanese subtitles for this episode. Whisper will transcribe what you mark.'}
          </p>
          {status && (
            <WordPrep
              key={`${entry.id}:${episode}`}
              load={() => api.episodeInsight(entry.id, episode)}
              source={`${title(entry)} · Ep ${episode}`}
              heading="Before you watch"
              setting="prepBeforeWatch"
              enabled={Boolean(files?.length)}
            />
          )}
          <button
            className="primary block"
            style={{ marginTop: 24 }}
            disabled={busy || files === undefined}
            onClick={() => start({ title: title(entry), entry, episode, file: files?.[fileIdx] })}
          >
            {busy ? 'Starting…' : `Start episode ${episode}`}
          </button>
        </>
      ) : (
        <>
          {!!history.length && (
            <>
              <h2>Continue</h2>
              <div className="group">
                {history.slice(0, 5).map((s) => (
                  <button
                    key={s.id}
                    className="list-item"
                    disabled={busy}
                    onClick={() => void continueWatching(s)}
                  >
                    <span className="grow ellipsis">{s.title}</span>
                    <span className="muted">Episode {s.nextEpisode}</span>
                    <Icon name="chevron" size={18} weight={2} className="chev" />
                  </button>
                ))}
              </div>
              <p className="footnote">One tap starts the next episode. For a different one, search below.</p>
            </>
          )}

          {jimakuReady && (
            <>
              <h2>Find an anime</h2>
              <form
                className="search-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <div className="search">
                  <Icon name="search" size={17} weight={2} />
                  <input type="search" enterKeyHint="search" placeholder="English, romaji or Japanese title" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <button className="ghost" disabled={!query.trim() || searching}>
                  {searching ? <span className="spinner" /> : 'Search'}
                </button>
              </form>
              {results && (
                <div className="group" style={{ marginTop: 12 }}>
                  {results.map((r) => (
                    <button key={r.id} className="list-item" onClick={() => choose(r)}>
                      <span className="grow">
                        <span className="ellipsis" style={{ display: 'block' }}>
                          {title(r)}
                        </span>
                        {r.japanese_name && (
                          <span className="sub jp ellipsis" style={{ display: 'block' }}>
                            {r.japanese_name}
                          </span>
                        )}
                      </span>
                      <Icon name="chevron" size={18} weight={2} className="chev" />
                    </button>
                  ))}
                  {!results.length && <div className="cell muted">No results. Try the Japanese or romaji title.</div>}
                </div>
              )}
            </>
          )}

          <h2>Without subtitles</h2>
          <div className="group">
            <div className="cell">
              <input placeholder="Title" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
            </div>
            <EpisodeCell value={episode} onChange={setEpisode} onCommit={(n) => setEpisode(Math.max(1, n))} />
          </div>
          <p className="footnote">
            {mode === 'phone'
              ? 'With the microphone on, Whisper transcribes your marks once they reach the laptop. A .srt or .ass file can still be added during the episode.'
              : 'Whisper transcribes each mark. You can still upload a .srt or .ass file later.'}
          </p>
          <button className="block" style={{ marginTop: 20 }} disabled={!manualTitle.trim() || busy} onClick={() => start({ title: manualTitle.trim(), episode })}>
            Start
          </button>
        </>
      )}
    </div>
  );
}

/** "Episode   7   [ - | + ]" row. */
function EpisodeCell({ value, onChange, onCommit }: { value: number; onChange: (n: number) => void; onCommit: (n: number) => void }) {
  return (
    <div className="cell">
      <span className="grow">Episode</span>
      <input
        className="inline-num num"
        type="number"
        inputMode="numeric"
        aria-label="Episode"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={() => onCommit(value)}
      />
      <span className="stepper">
        <button onClick={() => onCommit(value - 1)} disabled={value <= 1} aria-label="Previous episode">
          <Icon name="minus" size={18} />
        </button>
        <i />
        <button onClick={() => onCommit(value + 1)} aria-label="Next episode">
          <Icon name="plus" size={18} />
        </button>
      </span>
    </div>
  );
}
