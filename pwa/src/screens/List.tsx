import { useEffect, useState, type ReactNode } from 'react';
import { api, laptopUp } from '../lib/api.ts';
import { navigate } from '../lib/hooks.ts';
import { hasLaptop } from '../lib/laptop.ts';
import { anilistToken } from '../lib/phone.ts';
import {
  LIST_EVENT,
  addToList,
  chart,
  detail,
  forYou,
  loadList,
  markSeen,
  notInterested,
  readHref,
  removeFromList,
  search,
  startedIds,
  subtitlesFor,
  suggest,
  syncList,
  syncState,
  undoNotInterested,
  unmarkSeen,
  watchHref,
  type ForYou,
} from '../lib/watchlist.ts';
import { isMarked, liveItems, markedItems, onList, type MarkKind, type Media, type MediaKind, type Watchlist } from '../../../shared/watchlist.ts';
import type { Chart, MediaDetail } from '../../../shared/anilist.ts';
import type { Recommendation, SeedWhy } from '../../../shared/recommend.ts';
import type { JimakuEntry } from '../../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import { Sheet } from '../components/Sheet.tsx';

// The List tab: what you still want to watch or read, recommendations that fit what you watch and read, and the
// best rated titles overall. Everything comes from AniList (shared/anilist.ts, pwa/src/lib/watchlist.ts).

type View = 'mine' | 'foryou' | 'top';
const VIEWS: [View, string][] = [
  ['mine', 'My list'],
  ['foryou', 'For you'],
  ['top', 'Top'],
];
const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const FORMATS: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Film',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
  MANGA: 'Manga',
  NOVEL: 'Light novel',
  ONE_SHOT: 'One shot',
};

const TYPE_KEY = 'horu-list-type';
function storedType(): MediaKind {
  try {
    return localStorage.getItem(TYPE_KEY) === 'MANGA' ? 'MANGA' : 'ANIME';
  } catch {
    return 'ANIME';
  }
}

function useWatchlist(): Watchlist | undefined {
  const [list, setList] = useState<Watchlist>();
  useEffect(() => {
    const load = () => void loadList().then(setList);
    load();
    addEventListener(LIST_EVENT, load);
    return () => removeEventListener(LIST_EVENT, load);
  }, []);
  return list;
}

/** Everything you watched or read (Horu and AniList), to mark it in the lists. */
function useStarted(list?: Watchlist): Set<number> {
  const [ids, setIds] = useState<Set<number>>(new Set());
  useEffect(() => void startedIds().then(setIds, () => undefined), [list]);
  return ids;
}

export const metaLine = (m: Media): string =>
  [
    m.format && FORMATS[m.format],
    m.year,
    m.type === 'ANIME' ? m.episodes && `${m.episodes} ep` : m.chapters && `${m.chapters} ch`,
    m.score && `★ ${m.score}`,
  ]
    .filter(Boolean)
    .join(' · ');

const WHY: Record<SeedWhy, string> = { watched: 'You watched', read: 'You read', rated: 'You rated', listed: 'On your list:' };
const reason = (because?: Recommendation['because']) => (because?.length ? `${WHY[because[0].why]} ${because[0].title}` : undefined);

export function List({ route }: { route: string[] }) {
  if (route[0] === 'hidden') return <MarkedPage kind="dismissed" />;
  if (route[0] === 'seen') return <MarkedPage kind="seen" />;
  return <Lists route={route} />;
}

function Lists({ route }: { route: string[] }) {
  const view: View = route[0] === 'foryou' || route[0] === 'top' ? route[0] : 'mine';
  const [type, setTypeState] = useState<MediaKind>(storedType);
  const list = useWatchlist();
  const started = useStarted(list);
  const [open, setOpen] = useState<{ media: Media; because?: Recommendation['because'] }>();

  useEffect(() => void syncList(), []);

  function setType(t: MediaKind) {
    setTypeState(t);
    try {
      localStorage.setItem(TYPE_KEY, t);
    } catch {
      // private mode: back to anime next time
    }
  }

  const show = (media: Media, because?: Recommendation['because']) => setOpen({ media, because });
  const ctx = { type, list, started, show };

  return (
    <div>
      <Nav />
      <h1>List</h1>
      <div className="segmented" role="tablist" aria-label="Part of the list">
        {VIEWS.map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => navigate(v === 'mine' ? 'list' : `list/${v}`)}>
            {label}
          </button>
        ))}
      </div>
      <div className="segmented list-type" role="radiogroup" aria-label="Anime or manga">
        {(['ANIME', 'MANGA'] as const).map((t) => (
          <button key={t} role="radio" aria-checked={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
            {t === 'ANIME' ? 'Anime' : 'Manga'}
          </button>
        ))}
      </div>

      {view === 'mine' && <Mine {...ctx} />}
      {view === 'foryou' && <ForYouView {...ctx} />}
      {view === 'top' && <Top {...ctx} />}

      {open && list && <MediaSheet media={open.media} because={open.because} list={list} started={started.has(open.media.id)} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

type Ctx = { type: MediaKind; list?: Watchlist; started: Set<number>; show: (m: Media, because?: Recommendation['because']) => void };

// ---------------------------------------------------------------- pieces

function Cover({ m, big, small }: { m: Media; big?: boolean; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cls = `cover${big ? ' lg' : small ? ' sm' : ''}`;
  return m.cover && !failed ? (
    <img className={cls} src={m.cover} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ background: m.color }} onError={() => setFailed(true)} />
  ) : (
    <div className={`${cls} jp`}>{(m.native ?? m.title).slice(0, 2)}</div>
  );
}

/** The + on a poster or row: puts the title on the list, or takes it off. */
function AddButton({ m, list, className = 'list-add' }: { m: Media; list?: Watchlist; className?: string }) {
  const on = Boolean(list && onList(list, m.id));
  return (
    <button
      className={`${className}${on ? ' on' : ''}`}
      aria-label={on ? `Take ${m.title} off your list` : `Put ${m.title} on your list`}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        void (on ? removeFromList(m.id) : addToList(m));
      }}
    >
      <Icon name={on ? 'check' : 'plus'} size={16} weight={2.2} />
    </button>
  );
}

function MediaRow({ m, ctx, note }: { m: Media; ctx: Ctx; note?: ReactNode }) {
  return (
    <div className="media-row">
      <button className="list-item media-open" onClick={() => ctx.show(m)}>
        <Cover m={m} />
        <span className="grow">
          <span className="media-title">{m.title}</span>
          {m.native && m.native !== m.title && <span className="sub jp ellipsis">{m.native}</span>}
          <span className="sub">{metaLine(m)}</span>
          {note && <span className="sub media-note">{note}</span>}
        </span>
      </button>
      <AddButton m={m} list={ctx.list} />
    </div>
  );
}

function Poster({ m, ctx, rank, because }: { m: Media; ctx: Ctx; rank?: number; because?: Recommendation['because'] }) {
  const seen = ctx.started.has(m.id);
  return (
    <div className={`poster${seen ? ' seen' : ''}`}>
      <button className="grid-item" onClick={() => ctx.show(m, because)}>
        <Cover m={m} />
        <span className="small poster-title">{m.title}</span>
        <span className="poster-meta">
          {seen ? 'Seen · ' : ''}
          {[m.score && `★ ${m.score}`, m.year].filter(Boolean).join(' · ')}
        </span>
        {because && <span className="poster-why">{reason(because)}</span>}
      </button>
      {rank !== undefined && <span className="poster-rank">{rank}</span>}
      <AddButton m={m} list={ctx.list} className="poster-add" />
    </div>
  );
}

// ---------------------------------------------------------------- my list

function Mine(ctx: Ctx) {
  const { type, list, started } = ctx;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Media[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    addEventListener(LIST_EVENT, on);
    return () => removeEventListener(LIST_EVENT, on);
  }, []);
  useEffect(() => setResults(undefined), [type]);

  // Suggestions while typing, for a title you only half remember. A short pause first, and only the answer to what
  // is typed now is shown.
  const [hints, setHints] = useState<Media[]>();
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || results) return setHints(undefined);
    let stale = false;
    const timer = setTimeout(() => void suggest(q, type).then((r) => !stale && setHints(r), () => undefined), 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, type, results]);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setResults(await search(query.trim(), type));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const items = list ? liveItems(list).filter((i) => i.type === type) : [];
  const waiting = items.filter((i) => !started.has(i.id));
  const begun = items.filter((i) => started.has(i.id));
  const sync = syncState();
  const noun = type === 'ANIME' ? 'anime' : 'manga';

  return (
    <>
      <form className="search-row" style={{ marginTop: 18 }} onSubmit={find}>
        <div className="search">
          <Icon name="search" size={17} weight={2} />
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={`Add ${type === 'ANIME' ? 'an anime' : 'a manga'}: any title`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setResults(undefined);
            }}
            onKeyDown={(e) => e.key === 'Escape' && setHints(undefined)}
          />
        </div>
        <button className="ghost" disabled={!query.trim() || busy}>
          {busy ? <span className="spinner" /> : 'Search'}
        </button>
      </form>
      {hints && !results && (
        <div className="group suggest" role="listbox" aria-label="Suggestions">
          {hints.map((m) => (
            <div key={m.id} className="media-row" role="option" aria-selected={false}>
              <button className="list-item media-open" onClick={() => ctx.show(m)}>
                <Cover m={m} small />
                <span className="grow">
                  <span className="ellipsis">{m.title}</span>
                  <span className="sub ellipsis">
                    {[m.romaji && m.romaji !== m.title ? m.romaji : m.native, m.year, m.format && FORMATS[m.format], started.has(m.id) && 'Seen'].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
              <AddButton m={m} list={ctx.list} />
            </div>
          ))}
          {!hints.length && <div className="cell muted small">No match yet. Keep typing, or try the romaji or Japanese title.</div>}
        </div>
      )}
      {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}
      {results && (
        <>
          <div className="group" style={{ marginTop: 12 }}>
            {results.map((m) => (
              <MediaRow key={m.id} m={m} ctx={ctx} note={started.has(m.id) ? 'Seen' : undefined} />
            ))}
            {!results.length && <div className="cell muted">Nothing found. Try the romaji or Japanese title.</div>}
          </div>
          <button className="ghost small" style={{ marginTop: 6 }} onClick={() => setResults(undefined)}>
            Close search
          </button>
        </>
      )}

      <h2>{type === 'ANIME' ? 'To watch' : 'To read'}</h2>
      {list && !items.length && (
        <p className="footnote">
          No {noun} on your list yet. Search above, or tap + on anything in <a href="#/list/foryou">For you</a> and <a href="#/list/top">Top</a>.
        </p>
      )}
      {!!waiting.length && (
        <div className="group">
          {waiting.map((m) => (
            <MediaRow key={m.id} m={m} ctx={ctx} />
          ))}
        </div>
      )}
      {!!begun.length && (
        <>
          <h2>Already started</h2>
          <div className="group">
            {begun.map((m) => (
              <MediaRow key={m.id} m={m} ctx={ctx} note="Watched or read in Horu or on AniList: done with it on the list?" />
            ))}
          </div>
        </>
      )}

      <p className="footnote" style={{ marginTop: 18 }}>
        {sync.anilist
          ? sync.error
            ? `AniList sync failed: ${sync.error}`
            : 'Same list as your AniList Planning list. Starting a title on AniList takes it off here.'
          : 'Kept on this phone' + (hasLaptop() ? ' and the laptop' : '') + '. Connect AniList in Settings → Services to keep it in sync with your AniList Planning list.'}{' '}
        {sync.anilist && (
          <button className="ghost small" onClick={() => void syncList()}>
            Sync now
          </button>
        )}
      </p>
      <MarkLinks list={list} />
    </>
  );
}

// ---------------------------------------------------------------- for you

function ForYouView(ctx: Ctx) {
  const { type, list } = ctx;
  const [data, setData] = useState<{ type: MediaKind; value: ForYou }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [all, setAll] = useState(false);

  async function load(fresh = false) {
    setBusy(true);
    setError(undefined);
    try {
      setData({ type, value: await forYou(type, fresh) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setAll(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const value = data?.type === type ? data.value : undefined;
  // Taken onto the list or said no to since the picks were made: out of the way at once.
  const fresh = (id: number) => !list || (!onList(list, id) && !isMarked(list, 'dismissed', id) && !isMarked(list, 'seen', id));
  const picks = value?.picks.filter((p) => fresh(p.media.id)) ?? [];
  const inGenres = value?.inGenres.filter((m) => fresh(m.id)) ?? [];
  const shown = all ? picks : picks.slice(0, 18);

  return (
    <>
      {error && <div className="banner error" style={{ marginTop: 18 }}>{error}</div>}
      {!value && busy && (
        <p className="muted row small" style={{ marginTop: 22 }}>
          <span className="spinner" /> Asking AniList what fits you…
        </p>
      )}
      {value && !value.seeds.length && (
        <div className="banner" style={{ marginTop: 18 }}>
          Recommendations grow from what you watch and read in Horu, the titles on your list and, with AniList connected, everything you rated there. Put a few
          titles you liked on your list to start, or look at <a href="#/list/top">Top</a>.
        </div>
      )}
      {!!picks.length && (
        <>
          <h2>Fits what you like</h2>
          <div className="grid">
            {shown.map((p) => (
              <Poster key={p.media.id} m={p.media} ctx={ctx} because={p.because} />
            ))}
          </div>
          {picks.length > shown.length && (
            <button className="block" style={{ marginTop: 18 }} onClick={() => setAll(true)}>
              Show {picks.length - shown.length} more
            </button>
          )}
        </>
      )}
      {value && !!value.seeds.length && !picks.length && <p className="footnote">No new {type === 'ANIME' ? 'anime' : 'manga'} picks right now. Rate or add a few more titles.</p>}
      {!!inGenres.length && (
        <>
          <h2>Highly rated in {value!.genres.join(' & ')}</h2>
          <div className="grid">
            {inGenres.map((m) => (
              <Poster key={m.id} m={m} ctx={ctx} />
            ))}
          </div>
        </>
      )}
      {value && !!value.seeds.length && (
        <p className="footnote" style={{ marginTop: 22 }}>
          From {value.seeds.length} title{value.seeds.length === 1 ? '' : 's'} you watched, read{anilistToken() ? ', rated' : ''} or listed, among them{' '}
          {value.seeds
            .slice(0, 4)
            .map((s) => s.title)
            .join(', ')}
          . Tap a title and choose <i>Not interested</i> to see fewer like it.{' '}
          <button className="ghost small" disabled={busy} onClick={() => void load(true)}>
            {busy ? <span className="spinner" /> : 'Refresh'}
          </button>
        </p>
      )}
      <MarkLinks list={list} />
    </>
  );
}

// ---------------------------------------------------------------- top

function Top(ctx: Ctx) {
  const { type } = ctx;
  const [which, setWhich] = useState<Chart>('top');
  const [genre, setGenre] = useState('');
  const [pages, setPages] = useState<{ key: string; media: Media[]; more: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const key = `${which}:${type}:${genre}`;

  async function load(page: number) {
    setBusy(true);
    setError(undefined);
    try {
      const r = await chart(which, type, page, genre);
      setPages((p) => ({ key, media: page > 1 && p?.key === key ? [...p.media, ...r.media.filter((m) => !p.media.some((x) => x.id === m.id))] : r.media, more: r.more }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => void load(1), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = pages?.key === key ? pages : undefined;
  const charts: [Chart, string][] = [
    ['top', 'All time'],
    ['trending', 'Trending'],
    ['now', type === 'ANIME' ? 'Airing' : 'Publishing'],
  ];

  return (
    <>
      <div className="row list-top-bar">
        <div className="segmented grow" role="radiogroup" aria-label="Which chart">
          {charts.map(([c, label]) => (
            <button key={c} role="radio" aria-checked={which === c} className={which === c ? 'on' : ''} onClick={() => setWhich(c)}>
              {label}
            </button>
          ))}
        </div>
        <select aria-label="Genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">All genres</option>
          {GENRES.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      {error && <div className="banner error" style={{ marginTop: 14 }}>{error}</div>}
      {!current && busy && (
        <p className="muted row small" style={{ marginTop: 22 }}>
          <span className="spinner" /> Loading…
        </p>
      )}
      {current && (
        <>
          <div className="grid" style={{ marginTop: 18 }}>
            {current.media.map((m, i) => (
              <Poster key={m.id} m={m} ctx={ctx} rank={i + 1} />
            ))}
          </div>
          {!current.media.length && <p className="footnote">Nothing here.</p>}
          {current.more && (
            <button className="block" style={{ marginTop: 18 }} disabled={busy} onClick={() => void load(Math.floor(current.media.length / 30) + 1)}>
              {busy ? 'Loading…' : 'Show more'}
            </button>
          )}
          <p className="footnote">
            {which === 'top' ? 'By AniList average score, titles with enough votes. ' : ''}Japanese titles only. Scores and charts from AniList.
          </p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- seen and not interested

const MARKED: Record<MarkKind, { title: string; text: string; undo: (id: number) => Promise<unknown> }> = {
  seen: {
    title: 'Seen',
    text: 'Titles you marked as already watched or read. They count for your recommendations and stay out of them; with AniList connected they are Completed there. Marked one by mistake? Tap Undo.',
    undo: unmarkSeen,
  },
  dismissed: {
    title: 'Not interested',
    text: 'Titles you said no to stay out of the recommendations. Changed your mind? Tap Undo and the title can be recommended again.',
    undo: undoNotInterested,
  },
};

/** The quiet way in to the titles you marked: footnote links, only when there are some. */
function MarkLinks({ list }: { list?: Watchlist }) {
  const links = (['seen', 'dismissed'] as const).map((k) => ({ k, n: list ? markedItems(list, k).length : 0 })).filter((l) => l.n);
  if (!links.length) return null;
  return (
    <p className="footnote" style={{ marginTop: 14 }}>
      {links.map((l, i) => (
        <span key={l.k}>
          {i > 0 && ' · '}
          <a href={`#/list/${l.k === 'seen' ? 'seen' : 'hidden'}`}>
            {MARKED[l.k].title} ({l.n})
          </a>
        </span>
      ))}
    </p>
  );
}

function MarkedPage({ kind }: { kind: MarkKind }) {
  const list = useWatchlist();
  useEffect(() => void syncList(), []);
  const items = list ? markedItems(list, kind) : [];
  const info = MARKED[kind];
  return (
    <div>
      <Nav back="List" />
      <h1>{info.title}</h1>
      <p className="footnote">{info.text}</p>
      {list && !items.length && (
        <p className="footnote" style={{ marginTop: 18 }}>
          Nothing here.
        </p>
      )}
      {!!items.length && (
        <div className="group" style={{ marginTop: 18 }}>
          {items.map(({ media: m, at }) => (
            <div key={m.id} className="media-row">
              <div className="list-item media-open" style={{ cursor: 'default' }}>
                <Cover m={m} />
                <span className="grow">
                  <span className="media-title">{m.title}</span>
                  {m.native && m.native !== m.title && <span className="sub jp ellipsis">{m.native}</span>}
                  <span className="sub">{[m.type === 'ANIME' ? 'Anime' : m.format === 'MANGA' ? '' : 'Manga', metaLine(m)].filter(Boolean).join(' · ')}</span>
                  <span className="sub">Since {new Date(at).toLocaleDateString()}</span>
                </span>
              </div>
              <button className="small" onClick={() => void info.undo(m.id)}>
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- one title

function MediaSheet({ media, because, list, started, onClose }: { media: Media; because?: Recommendation['because']; list: Watchlist; started: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<MediaDetail>();
  const [more, setMore] = useState(false);
  const [subs, setSubs] = useState<JimakuEntry | null | undefined | 'checking' | 'failed'>('checking');
  const [coverage, setCoverage] = useState<number>();
  const m = info ?? media;
  const on = onList(list, media.id);
  const dismissed = isMarked(list, 'dismissed', media.id);
  const seen = isMarked(list, 'seen', media.id);
  const anime = media.type === 'ANIME';

  useEffect(() => {
    void detail(media.id).then(setInfo, () => undefined);
    if (media.type !== 'ANIME') return;
    subtitlesFor(media).then(
      (entry) => {
        setSubs(entry);
        if (entry && laptopUp()) void api.episodeInsight(entry.id, 1).then((i) => setCoverage(i.coverage), () => undefined);
      },
      () => setSubs('failed'),
    );
  }, [media]);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <Sheet onClose={onClose} className="media-sheet">
        <div className="manga-head">
          <Cover m={m} big />
          <div className="grow">
            <div className="media-sheet-title">{m.title}</div>
            {m.native && m.native !== m.title && <div className="jp muted">{m.native}</div>}
            <div className="sub" style={{ marginTop: 4 }}>
              {metaLine(m)}
            </div>
            {!!info?.creators.length && (
              <div className="media-creators">
                {info.creators.map((c) => (
                  <div key={c.name} className="sub">
                    {!anime && c.roles.includes('Story & Art') ? 'Mangaka' : c.roles.join(' & ')}: {c.native && <span className="jp">{c.native} </span>}
                    {c.native ? `(${c.name})` : c.name}
                  </div>
                ))}
              </div>
            )}
            {started && !seen && <div className="sub">You watched or read this already (in Horu or on AniList).</div>}
          </div>
        </div>
        {because?.length ? <p className="footnote">Because: {because.map((b) => `${WHY[b.why].replace(':', '')} ${b.title}`).join('; ')}.</p> : null}
        {!!m.genres.length && (
          <div className="media-genres">
            {m.genres.map((g) => (
              <span key={g} className="tag">
                {g}
              </span>
            ))}
          </div>
        )}

        <button className={`block${on ? '' : ' primary'}`} style={{ marginTop: 16 }} onClick={() => void (on ? removeFromList(m.id) : addToList(media))}>
          {on ? 'On your list · take it off' : media.type === 'ANIME' ? 'Put on my list to watch' : 'Put on my list to read'}
        </button>
        <div className="row" style={{ marginTop: 10 }}>
          {anime ? (
            <a className="btn grow" href={watchHref(media, subs === 'checking' || subs === 'failed' ? undefined : subs)} onClick={onClose}>
              Watch in Horu
            </a>
          ) : (
            hasLaptop() && (
              <a className="btn grow" href={readHref(media)} onClick={onClose}>
                Find in your sources
              </a>
            )
          )}
          <button className={`grow${seen ? ' known-on' : ''}`} aria-pressed={seen} onClick={() => void (seen ? unmarkSeen(media.id) : markSeen(media))}>
            {seen && <Icon name="check" size={16} weight={2.2} />}
            {seen ? (anime ? 'Watched' : 'Read') : anime ? 'Already watched' : 'Already read'}
          </button>
        </div>
        {!on && !seen && (
          <button className="ghost small" style={{ marginTop: 8 }} onClick={() => void (dismissed ? undoNotInterested(media.id) : notInterested(media).then(onClose))}>
            {dismissed ? 'Interested again' : 'Not interested'}
          </button>
        )}

        {media.type === 'ANIME' && (
          <>
            <h2>Japanese in Horu</h2>
            <div className="group">
              <div className="cell">
                <span className="grow">Japanese subtitles</span>
                <span className="value">
                  {subs === 'checking'
                    ? 'Checking Jimaku…'
                    : subs === 'failed'
                      ? 'Jimaku did not answer'
                      : subs === undefined
                        ? 'Add a Jimaku key to check'
                        : subs
                          ? 'On Jimaku'
                          : 'Not on Jimaku'}
                </span>
              </div>
              {coverage !== undefined && (
                <div className="cell">
                  <span className="grow">Words you know in episode 1</span>
                  <span className="value">{Math.round(coverage * 100)}%</span>
                </div>
              )}
            </div>
            <p className="footnote">
              {subs === null
                ? 'Without subtitles, Whisper transcribes what you mark.'
                : subs && coverage === undefined && laptopUp()
                  ? 'Working out how many words you know…'
                  : subs && coverage !== undefined
                    ? coverage >= 0.9
                      ? 'Comfortable: few new words per line.'
                      : coverage >= 0.8
                        ? 'A good stretch: a new word in most lines.'
                        : 'Hard for now: many new words per line.'
                    : ''}
            </p>
          </>
        )}

        {info?.description && (
          <>
            <h2>Story</h2>
            <p className={`media-desc${more ? ' open' : ''}`} onClick={() => setMore(true)}>
              {info.description}
            </p>
          </>
        )}
        {info?.url && (
          <p className="footnote">
            <a href={info.url} target="_blank" rel="noreferrer">
              Open on AniList
            </a>
          </p>
        )}
      </Sheet>
    </>
  );
}
