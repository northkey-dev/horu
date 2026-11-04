import { useEffect, useRef, useState } from 'react';
import { navigate, usePoll } from '../lib/hooks.ts';
import { api } from '../lib/api.ts';
import {
  flushPending,
  mangaApi,
  offlineChaptersOf,
  canCache,
  describeError,
  offlineIndex,
  pendingCount,
  removeOfflineChapter,
  saveChapterOffline,
  remoteThumbUrl,
  syncOffline,
  thumbUrl,
  type LibraryManga,
  type RemoteChapter,
  type Source,
  type SyncProgress,
} from '../lib/manga.ts';
import { Reader } from './Reader.tsx';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import { WordPrep } from '../components/WordPrep.tsx';

const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** Trailing status of a chapter row. */
function ChapterState({ status, offline, idle, rereading }: { status?: string; offline?: boolean; idle?: string; rereading?: boolean }) {
  if (rereading) return <span className="trail meta-row"><span className="spinner" />Reading again</span>;
  if (offline) return <span className="trail label-ok">On phone</span>;
  if (status === 'ready') return <span className="trail">Ready</span>;
  if (status === 'error') return <span className="trail label-bad">Error</span>;
  if (!status || status === 'cancelled') return <span className="trail label-warn">{idle ?? 'Not downloaded'}</span>;
  if (status === 'paused') return <span className="trail">Paused</span>;
  return (
    <span className="trail meta-row">
      <span className="spinner" />
      {status === 'ocr' ? 'Reading' : status === 'queued' ? 'Queued' : 'Loading'}
    </span>
  );
}

export function Manga({ route, online }: { route: string[]; online: boolean }) {
  const [view, arg] = route;
  if (view === 'read' && arg) return <Reader chapterKey={arg} />;
  if (view === 'browse') return <Browse />;
  if (view === 'server') return <ServerBrowse />;
  if (view === 'remote' && arg) return <RemoteDetail id={Number(arg)} />;
  if (view === 'm' && arg) return <LocalDetail mangaKey={arg} online={online} />;
  return <Home online={online} />;
}

function Cover({ src, title, big }: { src?: string; title: string; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cls = `cover${big ? ' lg' : ''}`;
  return src && !failed ? (
    <img className={cls} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <div className={`${cls} jp`}>{title.slice(0, 2)}</div>
  );
}

// ---------------------------------------------------------------- home

function Home({ online }: { online: boolean }) {
  const [library, setLibrary] = useState<LibraryManga[]>(() => mangaApi.cachedLibrary());
  const [sync, setSync] = useState<SyncProgress>();
  const syncAbort = useRef<AbortController>();
  const [storage, setStorage] = useState<{ bytes: number; chapters: number; readBytes: number; readChapters: number; phone?: number }>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const [server, setServer] = useState<string>();
  useEffect(() => {
    api.settings().then((s) => setServer(s.mangaServerKind === 'komga' ? 'Komga' : s.mangaServerKind === 'kavita' ? 'Kavita' : undefined), () => undefined);
  }, [online]);

  const loadStorage = () => {
    if (!online) return;
    mangaApi.storage().then(
      async (st) => setStorage({ ...st, phone: (await navigator.storage?.estimate?.().catch(() => undefined))?.usage }),
      () => undefined,
    );
  };
  useEffect(loadStorage, [online]);

  async function freeRead() {
    if (!storage || !confirm(`Delete ${storage.readChapters} read chapter${storage.readChapters > 1 ? 's' : ''} (${size(storage.readBytes)}) from the laptop and this phone?`)) return;
    try {
      const freed = await mangaApi.freeReadChapters();
      setMessage(`Deleted read chapters, ${size(freed)} freed on the laptop.`);
      loadStorage();
      void refresh();
      force((n) => n + 1);
    } catch (e) {
      setError(describeError(e));
    }
  }

  const refresh = () =>
    mangaApi.library().then(
      (l) => {
        setLibrary(l);
        setError(undefined);
      },
      () => setLibrary(mangaApi.cachedLibrary()),
    );

  useEffect(() => {
    void refresh();
    if (online) void flushPending().then((n) => n && setMessage(`${n} offline action${n > 1 ? 's' : ''} sent to the laptop.`));
    const id = setInterval(() => document.visibilityState === 'visible' && refresh(), 5000);
    return () => clearInterval(id);
  }, [online]);

  async function runSync() {
    setError(undefined);
    setSync({ done: 0, total: 0 });
    syncAbort.current = new AbortController();
    try {
      const { added, removed } = await syncOffline(setSync, undefined, syncAbort.current.signal);
      setMessage(added || removed ? `Offline: ${added} chapter(s) saved, ${removed} removed.` : 'Everything is already on this phone.');
    } catch (e) {
      if (syncAbort.current.signal.aborted) setMessage('Stopped. The chapters saved so far stay; Sync carries on with the rest.');
      else setError(describeError(e));
    } finally {
      setSync(undefined);
      force((n) => n + 1);
    }
  }

  async function importFile(file: File) {
    setMessage(`Importing ${file.name}…`);
    try {
      await mangaApi.importFile(file);
      setMessage('Imported. Text recognition runs on the laptop now.');
      void refresh();
    } catch (e) {
      setError(describeError(e));
      setMessage(undefined);
    }
  }

  const offline = offlineIndex();
  const pending = pendingCount();
  // Where you stopped last, one tap away
  const last = library.filter((m) => m.chapterKey && m.lastReadAt).sort((a, b) => Date.parse(b.lastReadAt!) - Date.parse(a.lastReadAt!))[0];
  const lastChapter = last && offlineChaptersOf(last.key).find((c) => c.key === last.chapterKey);
  const reading = library.filter((m) => m.status === 'reading');
  const paused = library.filter((m) => m.status === 'paused');

  return (
    <div>
      <Nav>
        <button onClick={() => navigate('camera')}>Camera</button>
        <button onClick={() => navigate('texts')}>Texts</button>
        {online && server && <button onClick={() => navigate('manga/server')}>{server}</button>}
        {online && (
          <button onClick={() => navigate('manga/browse')} aria-label="Find manga">
            <Icon name="plus" size={24} weight={2} />
          </button>
        )}
      </Nav>
      <h1>Manga</h1>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner info">{message}</div>}
      {pending > 0 && <div className="banner">{pending} offline action(s) waiting for the laptop.</div>}

      {last && (
        <button className="primary block continue" onClick={() => navigate(`manga/read/${last.chapterKey}`)}>
          <span className="jp ellipsis">Continue: {last.title}</span>
          <span className="small">
            {lastChapter ? `${lastChapter.name} · ` : ''}page {(last.page ?? 0) + 1}
          </span>
        </button>
      )}

      {online && (
        <div className="group">
          <div className="cell">
            {sync ? (
              <>
                <div className="grow">
                  <div className="sub ellipsis">Saving for offline… {sync.current ?? ''}</div>
                  <div className="progress" style={{ marginTop: 8 }}>
                    <div style={{ width: `${sync.total ? (100 * sync.done) / sync.total : 5}%` }} />
                  </div>
                </div>
                <button className="small" onClick={() => syncAbort.current?.abort()}>
                  Stop
                </button>
              </>
            ) : (
              <>
                <div className="grow">
                  <div>On this phone</div>
                  <div className="sub">
                    <span className="num">{Object.keys(offline).length}</span> chapters · sync before you leave
                  </div>
                </div>
                <button className="small" onClick={runSync}>
                  Sync
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {online && storage && storage.chapters > 0 && (
        <div className="group">
          <div className="cell">
            <div className="grow">
              <div>Storage</div>
              <div className="sub">
                Laptop <span className="num">{size(storage.bytes)}</span> · {storage.chapters} chapters
                {storage.phone ? (
                  <>
                    {' '}· Phone <span className="num">{size(storage.phone)}</span>
                  </>
                ) : null}
              </div>
            </div>
            {storage.readChapters > 0 && (
              <button className="small danger" onClick={freeRead}>
                Free {size(storage.readBytes)}
              </button>
            )}
          </div>
        </div>
      )}
      {online && storage && storage.readChapters > 0 && (
        <p className="footnote">
          Free deletes the {storage.readChapters} chapter{storage.readChapters > 1 ? 's' : ''} you have already read, on the laptop and on this phone.
        </p>
      )}

      {!library.length && (
        <div className="empty">
          <span className="glyph jp" aria-hidden="true">
            本
          </span>
          <b>No manga yet</b>
          <p>{online ? 'Tap + to find a manga, pick a Japanese source and start reading.' : 'Connect to the laptop to add manga.'}</p>
        </div>
      )}

      {reading.length > 0 && <h2>Reading</h2>}
      {reading.length > 0 && (
        <div className="group">
          {reading.map((m) => (
            <MangaRow key={m.key} m={m} offlineCount={offlineChaptersOf(m.key).length} />
          ))}
        </div>
      )}
      {paused.length > 0 && <h2>Paused</h2>}
      {paused.length > 0 && (
        <div className="group">
          {paused.map((m) => (
            <MangaRow key={m.key} m={m} offlineCount={offlineChaptersOf(m.key).length} />
          ))}
        </div>
      )}

      {online && (
        <>
          <div className="group" style={{ marginTop: 32 }}>
            <button className="list-item action-row" onClick={() => importRef.current?.click()}>
              Import a .cbz or .zip file
            </button>
          </div>
          <input ref={importRef} type="file" accept=".cbz,.zip" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </>
      )}
    </div>
  );
}

function MangaRow({ m, offlineCount }: { m: LibraryManga; offlineCount: number }) {
  const chapters = offlineChaptersOf(m.key);
  const current = chapters.find((c) => c.key === m.chapterKey);
  return (
    <button className="list-item manga-row" onClick={() => navigate(`manga/m/${m.key}`)}>
      <Cover src={m.hasThumb ? thumbUrl(m.key) : undefined} title={m.title} />
      <div className="grow" style={{ paddingTop: 2 }}>
        <div className="title jp clamp">{m.title}</div>
        <div className="sub ellipsis">{current ? `${current.name}${m.page ? ` · p. ${m.page + 1}` : ''}` : m.source}</div>
        <div className="meta meta-row" style={{ marginTop: 4 }}>
          <span className={offlineCount ? 'label-ok' : ''}>{offlineCount} on phone</span>
          {m.preparing > 0 && (
            <>
              <span>·</span>
              <span className="spinner" />
              <span>{m.preparing} preparing</span>
            </>
          )}
        </div>
      </div>
      <Icon name="chevron" size={18} weight={2} className="chev" />
    </button>
  );
}

// ---------------------------------------------------------------- local manga

function LocalDetail({ mangaKey, online }: { mangaKey: string; online: boolean }) {
  const manga = mangaApi.cachedLibrary().find((m) => m.key === mangaKey);
  const { data: serverChapters, refresh } = usePoll(() => (online ? mangaApi.chapters(mangaKey) : Promise.resolve(undefined)), 4000, [mangaKey, online]);
  const offline = offlineChaptersOf(mangaKey);
  const offlineKeys = new Set(offline.map((c) => c.key));
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [acting, setActing] = useState<string>();
  // Chapters being saved on this phone, with the share done
  const [saving, setSaving] = useState<Record<string, number>>({});

  async function saveOnPhone(key: string) {
    setError(undefined);
    setSaving((m) => ({ ...m, [key]: 0 }));
    try {
      await saveChapterOffline(key, (share) => setSaving((m) => ({ ...m, [key]: share })));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving((m) => {
        const { [key]: _done, ...rest } = m;
        return rest;
      });
    }
  }

  /** Runs a download action and shows the new state right away. */
  async function act(key: string, fn: () => Promise<unknown>) {
    setActing(key);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setActing(undefined);
      refresh();
    }
  }

  const chapters: { key: string; name: string; order: number; status?: string; detail?: string; readAt?: string; rereading?: boolean }[] = serverChapters
    ? serverChapters.map((c) => ({
        key: c.key,
        name: c.name,
        order: c.order,
        status: c.status,
        readAt: c.readAt,
        rereading: c.rereading,
        detail: c.rereading
          ? c.rereadPages === undefined
            ? 'waiting to read the text again'
            : `reading the text again ${c.rereadPages}/${c.pageCount}`
          : c.status === 'downloading' || c.status === 'ocr'
            ? `${c.status === 'ocr' ? 'reading text' : 'downloading'} ${c.pagesDone}/${c.pageCount}`
            : c.status === 'error'
              ? c.error
              : c.status === 'queued'
                ? 'waiting'
                : c.status === 'paused' && c.pagesDone
                ? `paused at ${c.pagesDone}/${c.pageCount}`
                : undefined,
      }))
    : offline.map((c) => ({ key: c.key, name: c.name, order: c.order, status: 'ready' }));

  const active = chapters.filter((c) => c.status === 'queued' || c.status === 'downloading' || c.status === 'ocr').length;
  const paused = chapters.filter((c) => c.status === 'paused').length;
  const rereading = chapters.filter((c) => c.rereading).length;

  // The chapter being read and the first prepared one after it (chapters arrive sorted by their order).
  const sorted = chapters.slice().sort((x, y) => x.order - y.order);
  const current = sorted.find((c) => c.key === manga?.chapterKey);
  const next = current && sorted.find((c) => c.order > current.order && c.status === 'ready');

  async function setStatus(status: 'reading' | 'paused') {
    try {
      await mangaApi.setStatus(mangaKey, status);
      await mangaApi.library();
      navigate('manga');
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <div>
      <Nav back="Manga" to="manga" />
      <div className="manga-head">
        <Cover src={manga?.hasThumb ? thumbUrl(mangaKey) : undefined} title={manga?.title ?? ''} big />
        <div className="grow">
          <h1 className="jp">{manga?.title ?? 'Manga'}</h1>
          <div className="muted small">{manga?.source}</div>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      {manga?.notJapanese && (
        <div className="banner error">
          This edition is in Chinese, not Japanese: {manga.source} lists it as Japanese anyway. No more chapters are prepared. Remove it and look for the manga in another source.
        </div>
      )}

      {manga?.chapterKey && (
        <button className="primary block" onClick={() => navigate(`manga/read/${manga.chapterKey}`)}>
          Continue reading
        </button>
      )}

      {online && current?.status === 'ready' && (
        <WordPrep
          key={current.key}
          load={() => mangaApi.chapterInsight(current.key)}
          source={`${manga?.title ?? ''} · ${current.name}`}
          heading="Before you read"
          setting="prepBeforeRead"
          enabled
        />
      )}
      {online && next && (
        <WordPrep
          key={next.key}
          load={() => mangaApi.chapterInsight(next.key)}
          source={`${manga?.title ?? ''} · ${next.name}`}
          heading="Next chapter"
          setting="prepBeforeRead"
          enabled
        />
      )}

      <div className="row section-head">
        <h2 className="grow">Chapters</h2>
        {online && chapters.some((c) => c.status === 'ready') && (
          <button className="small ghost" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {!chapters.length && <p className="footnote">Preparing the first chapters on the laptop…</p>}
      {online && rereading > 0 && (
        <div className="group">
          <div className="cell">
            <span className="spinner" />
            <div className="grow">
              Reading the text again: {rereading} chapter{rereading > 1 ? 's' : ''} left
            </div>
          </div>
        </div>
      )}
      {editing && (
        <div className="group">
          <button className="list-item action-row" disabled={acting === 'reread'} onClick={() => act('reread', () => mangaApi.rereadManga(mangaKey))}>
            <span className="grow">Read the text of all chapters again</span>
          </button>
        </div>
      )}
      {editing && <p className="footnote">For chapters prepared by an older Horu. About eight seconds per page on the laptop; you can keep reading meanwhile. Corrections you made by hand stay.</p>}
      {online && active + paused > 1 && (
        <div className="group">
          <div className="cell">
            <div className="grow">
              {active > 0 ? `Downloading ${active} chapter${active > 1 ? 's' : ''}` : `${paused} download${paused > 1 ? 's' : ''} paused`}
              {active > 0 && paused > 0 && <div className="sub">{paused} paused</div>}
            </div>
            <button className="small" disabled={acting === 'all'} onClick={() => act('all', () => mangaApi.pauseDownloads(mangaKey, active > 0))}>
              {active > 0 ? 'Pause all' : 'Resume all'}
            </button>
          </div>
        </div>
      )}
      {chapters.length > 0 && (
        <div className="group">
          {chapters.map((c) => {
            const readable = c.status === 'ready' && (online || offlineKeys.has(c.key));
            const busy = c.status === 'queued' || c.status === 'downloading' || c.status === 'ocr';
            const actions = online && (busy || c.status === 'paused' || c.status === 'error' || c.status === 'cancelled' || (editing && c.status === 'ready'));
            const label = (
              <div className="grow">
                <div className="jp ellipsis">{c.name}</div>
                {c.detail && <div className="meta">{c.detail}</div>}
              </div>
            );
            const onPhone = offlineKeys.has(c.key);
            const canSave = online && canCache() && c.status === 'ready' && !onPhone && !editing;
            if (!actions && !canSave)
              return (
                <button key={c.key} className="list-item" disabled={!readable} onClick={() => navigate(`manga/read/${c.key}`)}>
                  {label}
                  <ChapterState status={c.status} offline={onPhone} rereading={c.rereading} />
                  {readable && <Icon name="chevron" size={18} weight={2} className="chev" />}
                </button>
              );
            if (!actions)
              return (
                <div key={c.key} className="cell">
                  <button className="list-item" style={{ flex: 1, minWidth: 0, padding: 0 }} onClick={() => navigate(`manga/read/${c.key}`)}>
                    {label}
                  </button>
                  {c.key in saving ? (
                    <span className="trail num">{Math.round(saving[c.key] * 100)}%</span>
                  ) : (
                    <button className="small" onClick={() => saveOnPhone(c.key)}>
                      Save on phone
                    </button>
                  )}
                </div>
              );
            return (
              <div key={c.key} className={`cell${editing && c.status === 'ready' ? ' wrap' : ''}`}>
                {label}
                {acting === c.key ? (
                  <span className="spinner" />
                ) : c.status === 'ready' ? (
                  <div className="chapter-edit">
                    <button className="small" onClick={() => act(c.key, () => mangaApi.markRead(c.key, !c.readAt))}>
                      {c.readAt ? 'Mark unread' : 'Mark read'}
                    </button>
                    {onPhone && (
                      <button className="small" onClick={() => act(c.key, () => removeOfflineChapter(c.key))}>
                        Off phone
                      </button>
                    )}
                    <button className="small" disabled={c.rereading} onClick={() => act(c.key, () => mangaApi.rereadChapter(c.key))}>
                      {c.rereading ? 'Reading again' : 'Read text again'}
                    </button>
                    <button
                      className="small danger"
                      onClick={() => confirm(`Delete “${c.name}”? Its pages are removed from the laptop and this phone.`) && act(c.key, () => mangaApi.stopChapter(c.key, 'cancel'))}
                    >
                      Delete
                    </button>
                  </div>
                ) : c.status === 'cancelled' ? (
                  <button className="small" onClick={() => act(c.key, () => mangaApi.resumeChapter(c.key))}>
                    Download
                  </button>
                ) : (
                  <>
                    {busy && <span className="spinner" />}
                    {c.status === 'error' && <span className="trail label-bad">Error</span>}
                    <button className="small" onClick={() => act(c.key, () => (busy ? mangaApi.stopChapter(c.key, 'pause') : mangaApi.resumeChapter(c.key)))}>
                      {busy ? 'Pause' : 'Resume'}
                    </button>
                    <button className="small danger" onClick={() => act(c.key, () => mangaApi.stopChapter(c.key, 'cancel'))}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {online && chapters.some((c) => c.status === 'cancelled') && (
        <p className="footnote">Deleted and cancelled chapters are not downloaded again by themselves. Tap Download to get one back.</p>
      )}

      {online && manga && (
        <div className="group" style={{ marginTop: 32 }}>
          {mangaKey.startsWith('s') && (
            <button className="list-item action-row" onClick={() => navigate(`manga/remote/${mangaKey.slice(1)}`)}>
              All chapters
            </button>
          )}
          <button className="list-item action-row" onClick={() => setStatus(manga.status === 'reading' ? 'paused' : 'reading')}>
            {manga.status === 'reading' ? 'Mark as paused' : 'Mark as reading'}
          </button>
          <button
            className="list-item action-row danger"
            onClick={async () => {
              if (!confirm(`Remove “${manga.title}” from Horu?`)) return;
              await mangaApi.remove(mangaKey);
              await mangaApi.library();
              navigate('manga');
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- browse

/** Komga / Kavita (Settings → Manga server): search series, import volumes into the library. */
function ServerBrowse() {
  const [query, setQuery] = useState('');
  const [series, setSeries] = useState<{ id: string; name: string; books?: number }[]>();
  const [open, setOpen] = useState<{ id: string; name: string }>();
  const [books, setBooks] = useState<{ id: string; name: string }[]>();
  const [state, setState] = useState<Record<string, 'busy' | 'done' | string>>({});
  const [error, setError] = useState<string>();

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setError(undefined);
    setOpen(undefined);
    mangaApi.serverSearch(query).then(setSeries, (err: Error) => setError(err.message));
  }
  useEffect(() => void search(), []);

  async function show(s: { id: string; name: string }) {
    setOpen(s);
    setBooks(undefined);
    mangaApi.serverBooks(s.id).then(setBooks, (err: Error) => setError(err.message));
  }

  async function add(b: { id: string; name: string }) {
    if (!open) return;
    setState((x) => ({ ...x, [b.id]: 'busy' }));
    try {
      await mangaApi.serverImport(open.id, open.name, b.id, b.name);
      setState((x) => ({ ...x, [b.id]: 'done' }));
    } catch (err) {
      setState((x) => ({ ...x, [b.id]: (err as Error).message }));
    }
  }

  return (
    <div>
      <Nav back={open ? 'Series' : 'Manga'} to={open ? undefined : 'manga'} />
      <h1>{open ? open.name : 'Manga server'}</h1>
      {error && <div className="banner error">{error}</div>}
      {!open && (
        <>
          <form className="search-row" onSubmit={search}>
            <input type="search" placeholder="Search your server" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="primary">Search</button>
          </form>
          <div className="group">
            {series?.map((s) => (
              <button key={s.id} className="list-item" onClick={() => show(s)}>
                <span className="grow jp">{s.name}</span>
                {s.books !== undefined && <span className="trail">{s.books}</span>}
                <Icon name="chevron" size={18} weight={2} className="chev" />
              </button>
            ))}
          </div>
          {series && !series.length && <p className="footnote">Nothing found.</p>}
        </>
      )}
      {open && (
        <>
          <button className="small ghost" onClick={() => setOpen(undefined)} style={{ marginBottom: 8 }}>
            All series
          </button>
          {!books && <p className="muted row small"><span className="spinner" /> Loading…</p>}
          <div className="group">
            {books?.map((b) => (
              <div key={b.id} className="cell">
                <span className="grow jp">{b.name}</span>
                {state[b.id] === 'busy' ? (
                  <span className="spinner" />
                ) : state[b.id] === 'done' ? (
                  <span className="trail label-ok">In library</span>
                ) : (
                  <button className="small" onClick={() => add(b)}>
                    Import
                  </button>
                )}
              </div>
            ))}
          </div>
          {Object.values(state).some((v) => v !== 'busy' && v !== 'done') && <p className="footnote">{Object.values(state).find((v) => v !== 'busy' && v !== 'done')}</p>}
          <p className="footnote">Imported volumes get text recognition on the laptop, then show up under Manga.</p>
        </>
      )}
    </div>
  );
}

function Browse() {
  const [sources, setSources] = useState<Source[]>();
  const [source, setSource] = useState<string>(() => localStorage.getItem('horu-source') ?? '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: number; title: string; inLibrary: boolean }[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showExtensions, setShowExtensions] = useState(false);

  const loadSources = () =>
    mangaApi.sources().then(
      (s) => {
        setSources(s);
        if (!s.some((x) => x.id === source)) setSource(s[0]?.id ?? '');
        if (!s.length) setShowExtensions(true);
      },
      (e: Error) => setError(describeError(e)),
    );

  useEffect(() => {
    void loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (source) localStorage.setItem('horu-source', source);
    } catch {
      // ignore
    }
  }, [source]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!source) return;
    setBusy(true);
    setError(undefined);
    try {
      setResults((await mangaApi.search(source, query)).mangas);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Nav back="Manga" to="manga" />
      <h1>Find manga</h1>
      {!sources && !error && (
        <p className="muted row small">
          <span className="spinner" /> Starting the manga server on the laptop… (first time ~30 s)
        </p>
      )}
      {error && <div className="banner error">{error}</div>}

      {sources && sources.length > 0 && (
        <>
          <div className="group">
            <label className="field">
              <span>Source</span>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <form className="search-row" style={{ marginTop: 12 }} onSubmit={search}>
            <div className="search">
              <Icon name="search" size={17} weight={2} />
              <input type="search" enterKeyHint="search" placeholder="Title (Japanese works best)" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className="ghost" disabled={busy}>
              {busy ? <span className="spinner" /> : 'Search'}
            </button>
          </form>
          <p className="footnote">Leave empty to see what is popular.</p>
        </>
      )}

      {results && (
        <div className="grid" style={{ marginTop: 20 }}>
          {results.map((m) => (
            <button key={m.id} className="grid-item" onClick={() => navigate(`manga/remote/${m.id}`)}>
              <Cover src={remoteThumbUrl(m.id)} title={m.title} />
              <div className="small jp clamp">{m.title}</div>
            </button>
          ))}
          {!results.length && <p className="muted">Nothing found.</p>}
        </div>
      )}

      <div className="group" style={{ marginTop: 32 }}>
        <button className="list-item action-row" onClick={() => setShowExtensions(!showExtensions)}>
          {showExtensions ? 'Hide sources' : 'Manage sources'}
        </button>
      </div>
      {showExtensions && <Extensions onChange={loadSources} />}
    </div>
  );
}

function Extensions({ onChange }: { onChange: () => void }) {
  const [list, setList] = useState<{ pkgName: string; name: string; lang: string; isInstalled: boolean; iconUrl: string; isNsfw?: boolean }[]>();
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = () => mangaApi.extensions().then(setList, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  async function toggle(pkg: string, install: boolean) {
    setBusy(pkg);
    try {
      await mangaApi.setExtension(pkg, install);
      await load();
      onChange();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(undefined);
    }
  }

  const shown = list
    ?.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(b.isInstalled) - Number(a.isInstalled) || Number(b.lang === 'ja') - Number(a.lang === 'ja') || a.name.localeCompare(b.name));

  return (
    <div style={{ marginTop: 20 }}>
      <div className="search">
        <Icon name="search" size={17} weight={2} />
        <input type="search" placeholder="Filter sources" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}
      {!list && <p className="footnote">Loading…</p>}
      {shown && (
        <div className="group" style={{ marginTop: 12, maxHeight: 420, overflow: 'auto' }}>
          {shown.map((e) => (
            <div key={e.pkgName} className="cell">
              <div className="grow ellipsis">
                {e.name} <span className="tag">{e.lang}</span>
                {e.isNsfw && <span className="tag">18+</span>}
              </div>
              <button className={`small ${e.isInstalled ? 'danger' : 'primary'}`} disabled={busy === e.pkgName} onClick={() => toggle(e.pkgName, !e.isInstalled)}>
                {busy === e.pkgName ? '…' : e.isInstalled ? 'Remove' : 'Install'}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="footnote">Japanese sources are community extensions via Suwayomi. Official free sites such as Shōnen Jump+, Comic Days or Magazine Pocket work well.</p>
    </div>
  );
}

// ---------------------------------------------------------------- remote detail

function RemoteDetail({ id }: { id: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof mangaApi.remote>>>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [find, setFind] = useState('');

  const load = (refresh = false) => mangaApi.remote(id, refresh).then(setData, (e: Error) => setError(e.message));
  useEffect(() => {
    void load(true);
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function startReading(chapterKey?: string) {
    setBusy('add');
    setError(undefined);
    try {
      await mangaApi.addToLibrary(id, chapterKey);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function open(c: RemoteChapter, order: number) {
    if (c.prepared?.status === 'ready') return navigate(`manga/read/${c.key}`);
    setBusy(c.key);
    setError(undefined);
    try {
      if (!data?.manga.active) await mangaApi.addToLibrary(id, c.key);
      await mangaApi.prepare(c.key, `s${id}`, c.name, order);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(undefined);
    }
  }

  if (!data)
    return (
      <>
        <Nav back="Back" />
        <p className="muted">{error ?? 'Loading…'}</p>
      </>
    );
  const { manga, chapters } = data;
  return (
    <div>
      <Nav back="Back" />
      <div className="manga-head">
        <Cover src={remoteThumbUrl(id)} title={manga.title} big />
        <div className="grow">
          <h1 className="jp">{manga.title}</h1>
          {manga.author && <div className="muted small jp">{manga.author}</div>}
        </div>
      </div>
      {manga.description && <p className="small muted jp clamp-3" style={{ margin: '0 0 16px' }}>{manga.description}</p>}
      {error && <div className="banner error">{error}</div>}

      {!manga.active ? (
        <button className="primary block" disabled={busy === 'add'} onClick={() => startReading()}>
          {busy === 'add' ? 'Adding…' : 'Start reading'}
        </button>
      ) : (
        <div className="banner info">In your library ({manga.active.status}). The next chapters are prepared automatically while the laptop is on.</div>
      )}

      <h2>{chapters.length} chapters</h2>
      {chapters.length > 12 && (
        <div className="search-row">
          <div className="search">
            <Icon name="search" size={17} weight={2} />
            <input type="search" inputMode="search" placeholder="Find a chapter, e.g. 120" value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          {manga.active?.chapterKey && (
            <button className="ghost" onClick={() => document.getElementById(`ch-${manga.active!.chapterKey}`)?.scrollIntoView({ block: 'center' })}>
              My place
            </button>
          )}
          <button className="ghost" onClick={() => document.getElementById(`ch-${chapters[chapters.length - 1].key}`)?.scrollIntoView({ block: 'center' })}>
            Latest
          </button>
        </div>
      )}
      <div className="group">
        {chapters.map((c, i) => {
          const p = c.prepared;
          if (find.trim() && !c.name.toLowerCase().includes(find.trim().toLowerCase())) return null;
          return (
            <button key={c.id} id={`ch-${c.key}`} className="list-item" disabled={busy === c.key} onClick={() => open(c, i)}>
              <div className="grow">
                <div className="jp ellipsis">{c.name}</div>
                {p && (p.status === 'downloading' || p.status === 'ocr' || p.status === 'error') && (
                  <div className="meta">{p.status === 'error' ? p.error : `${p.status === 'ocr' ? 'Reading text' : 'Downloading'} ${p.pagesDone}/${p.pageCount}`}</div>
                )}
              </div>
              {busy === c.key ? <span className="spinner" /> : <ChapterState status={p?.status} idle="Prepare" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
