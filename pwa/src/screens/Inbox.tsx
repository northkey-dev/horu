import { useEffect, useState } from 'react';
import { api, imageUrl, laptopMakesCards, laptopUp } from '../lib/api.ts';
import { flash, navigate, useMedia, usePoll } from '../lib/hooks.ts';
import { defaultLine, haveCards, planFor, planKey, requestFor, sendCard } from '../lib/inbox.ts';
import { inboxView, setInboxView } from '../lib/phone.ts';
import { InboxStack } from './InboxStack.tsx';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import type { Moment } from '../../../shared/types.ts';
import { aiRoute, cardRoute } from '../lib/cards.ts';
import { SearchBox } from '../components/SearchBox.tsx';
import { matchesQuery } from '../../../shared/search.ts';

const STATUS_LABEL: Record<string, string> = {
  capturing: 'Capturing audio',
  transcribing: 'Listening',
  creating: 'Creating card',
  error: 'Needs attention',
};

const KIND_ICON: Record<string, string> = { anime: 'watch', manga: 'book', screen: 'phone', text: 'text' };

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** The word each moment would get, and which of those words already have a card. */
function useWords(moments?: Moment[]) {
  const [found, setFound] = useState<{ words: Record<string, string>; cards: Set<string> }>({ words: {}, cards: new Set() });
  useEffect(() => {
    let alive = true;
    void (async () => {
      const words: Record<string, string> = {};
      for (const m of moments ?? []) {
        if (m.status !== 'ready' && m.status !== 'error') continue;
        const form = (await planFor(m)).target?.form;
        if (form) words[m.id] = form;
      }
      if (!alive) return;
      setFound((f) => ({ ...f, words }));
      const cards = await haveCards([...new Set(Object.values(words))]);
      if (alive) setFound({ words, cards });
    })();
    return () => {
      alive = false;
    };
  }, [moments?.map(planKey).join()]);
  return found;
}

export function Inbox() {
  const { data, error, refresh } = usePoll(() => api.inbox(), 3000);
  const [view, setView] = useState(inboxView);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const { words, cards } = useWords(data);

  const canGo = (m: Moment) => m.status !== 'creating';
  const chosen = (data ?? []).filter((m) => picked.has(m.id) && canGo(m));
  const all = (data ?? []).filter(canGo);
  const shown = (data ?? []).filter((m) => matchesQuery(m, query));

  function show(next: 'list' | 'swipe') {
    setView(next);
    setInboxView(next);
    setEditing(false);
  }

  function edit(on: boolean) {
    setEditing(on);
    setPicked(new Set());
  }

  function toggle(id: string) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  }

  /** A card for each ticked moment, with the line and word Horu chose (the swipe view does the same one by one). */
  async function makeCards() {
    const route = cardRoute(laptopUp() && laptopMakesCards());
    const ai = aiRoute(route);
    if (ai === 'copy' || route === 'ankimobile') return flash('This card route needs a tap for each card: open them one by one.');
    setBusy(true);
    let made = 0;
    let looks = 0;
    for (const m of chosen.filter((m) => m.status === 'ready')) {
      try {
        const plan = await planFor(m);
        if (!plan?.target) throw new Error('no word chosen');
        await sendCard(m, requestFor(m, plan, plan.target), plan.target.form, route, ai);
        made++;
      } catch {
        looks++;
      }
    }
    flash(`${made} card${made === 1 ? '' : 's'} on the way${looks ? ` · ${looks} need a look` : ''}`);
    edit(false);
    setBusy(false);
    refresh();
  }

  async function discard() {
    setBusy(true);
    let done = 0;
    try {
      // One after the other: what cannot be sent yet is queued in order.
      for (const m of chosen) {
        await api.discard(m.id);
        done++;
      }
      flash(`${done} discarded · still in History for a few days`);
      edit(false);
    } catch (e) {
      flash((e as Error).message);
    }
    setBusy(false);
    refresh();
  }

  return (
    <div>
      <Nav>
        {!!data?.length && view === 'list' && <button onClick={() => edit(!editing)}>{editing ? 'Done' : 'Edit'}</button>}
        {!editing && <button onClick={() => navigate('history')}>History</button>}
      </Nav>
      <h1>Inbox</h1>
      {error && <div className="banner error">{error.message}</div>}
      {data && !data.length && (
        <div className="empty">
          <span className="glyph jp" aria-hidden="true">
            空
          </span>
          <b>All caught up</b>
          <p>Marked anime moments and mined manga and text lines show up here. Finished ones stay in History for a few days.</p>
        </div>
      )}
      {!!data?.length && (
        <>
          <h2>{data.length} to review</h2>
          {data.length > 5 && <SearchBox value={query} onChange={setQuery} placeholder="Search sentence, word or source" />}
          {!editing && (
            <div className="segmented inbox-view">
              <button className={view === 'list' ? 'on' : ''} onClick={() => show('list')}>
                List
              </button>
              <button className={view === 'swipe' ? 'on' : ''} onClick={() => show('swipe')}>
                Swipe
              </button>
            </div>
          )}
          {view === 'swipe' ? (
            <InboxStack moments={shown} refresh={refresh} />
          ) : (
            <div className="group">
              {shown.map((m) => (
                <InboxRow key={m.id} m={m} word={words[m.id]} hasCard={cards.has(words[m.id])} picking={editing} picked={picked.has(m.id)} disabled={editing && !canGo(m)} onPick={() => toggle(m.id)} />
              ))}
            </div>
          )}
          {editing && (
            <div className="action-bar">
              <button disabled={busy} onClick={() => setPicked(new Set(chosen.length === all.length ? [] : all.map((m) => m.id)))}>
                {chosen.length === all.length ? 'Select none' : 'Select all'}
              </button>
              <button className="primary" disabled={busy || !chosen.length} onClick={() => void makeCards()}>
                {chosen.length ? `Make ${chosen.length} card${chosen.length === 1 ? '' : 's'}` : 'Make cards'}
              </button>
              <button className="danger" disabled={busy || !chosen.length} onClick={() => void discard()}>
                {chosen.length ? `Discard ${chosen.length}` : 'Discard'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type RowProps = { m: Moment; word?: string; hasCard: boolean; picking: boolean; picked: boolean; disabled: boolean; onPick: () => void };

function InboxRow({ m, word, hasCard, picking, picked, disabled, onPick }: RowProps) {
  const preview = m.candidates[defaultLine(m, m.candidates)]?.text ?? m.candidates[0]?.text;
  const status = STATUS_LABEL[m.status];
  const busy = Boolean(status) && m.status !== 'error';
  return (
    <button className="list-item" disabled={disabled} aria-pressed={picking ? picked : undefined} onClick={() => (picking ? onPick() : navigate(`inbox/${m.id}`))}>
      <div className="inbox-row">
        {picking && <span className="pick">{picked && <Icon name="check" size={14} weight={2.4} />}</span>}
        {m.hasImage ? (
          <Thumb id={m.id} />
        ) : (
          <div className="thumb blank">
            <Icon name={KIND_ICON[m.kind] ?? 'inbox'} />
          </div>
        )}
        <div className="grow">
          <div className="line jp ellipsis">{preview ?? <span className="faint">No text yet</span>}</div>
          <div className="meta meta-row">
            {busy && <span className="spinner" />}
            {word && <span className="inbox-word jp">{word}</span>}
            {word && hasCard && <span className="has-card-tag">has a card</span>}
            <span className="ellipsis">
              {m.status === 'error' && <span className="label-bad">{status} · </span>}
              {busy && `${status} · `}
              {m.sourceLabel} · {ago(m.createdAt)}
            </span>
          </div>
        </div>
        {!picking && <Icon name="chevron" size={18} weight={2} className="chev" />}
      </div>
    </button>
  );
}

function Thumb({ id }: { id: string }) {
  return <img className="thumb" src={useMedia(imageUrl(id))} alt="" loading="lazy" />;
}
