import { api, imageUrl } from '../lib/api.ts';
import { navigate, useMedia, usePoll } from '../lib/hooks.ts';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import type { Moment } from '../../../shared/types.ts';

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

export function Inbox() {
  const { data, error } = usePoll(() => api.inbox(), 3000);
  return (
    <div>
      <Nav>
        <button onClick={() => navigate('history')}>History</button>
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
          <div className="group">
            {data.map((m) => (
              <InboxRow key={m.id} m={m} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function InboxRow({ m }: { m: Moment }) {
  const idx = m.matchedIndex ?? (m.kind === 'anime' ? m.candidates.length - 1 : 0);
  const preview = m.candidates[idx]?.text ?? m.candidates[0]?.text;
  const status = STATUS_LABEL[m.status];
  const busy = Boolean(status) && m.status !== 'error';
  return (
    <button className="list-item" onClick={() => navigate(`inbox/${m.id}`)}>
      <div className="inbox-row">
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
            <span className="ellipsis">
              {m.status === 'error' && <span className="label-bad">{status} · </span>}
              {busy && `${status} · `}
              {m.sourceLabel} · {ago(m.createdAt)}
            </span>
          </div>
        </div>
        <Icon name="chevron" size={18} weight={2} className="chev" />
      </div>
    </button>
  );
}

function Thumb({ id }: { id: string }) {
  return <img className="thumb" src={useMedia(imageUrl(id))} alt="" loading="lazy" />;
}
