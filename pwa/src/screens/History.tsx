import { api } from '../lib/api.ts';
import { navigate, usePoll } from '../lib/hooks.ts';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import type { Moment } from '../../../shared/types.ts';

// Everything that was ever marked, newest first. Finished and discarded moments keep their audio for a
// few days (Settings → keep days) and can be put back in the inbox from here.

const KIND_ICON: Record<string, string> = { anime: 'watch', manga: 'book', screen: 'phone' };

function statusOf(m: Moment): { label: string; cls: string } {
  if (m.status === 'done') return { label: 'Card', cls: 'label-ok' };
  if (m.status === 'discarded') return { label: 'Discarded', cls: 'faint' };
  if (m.status === 'error') return { label: 'Error', cls: 'label-bad' };
  return { label: 'Inbox', cls: 'label-warn' };
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export function History() {
  const { data, error } = usePoll(() => api.moments(300), 5000);
  const groups: { day: string; items: Moment[] }[] = [];
  for (const m of data ?? []) {
    const day = dayLabel(m.createdAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }
  return (
    <div>
      <Nav back="Inbox" to="inbox" />
      <h1>History</h1>
      {error && <div className="banner error">{error.message}</div>}
      {data && !data.length && (
        <div className="empty">
          <span className="glyph jp" aria-hidden="true">
            無
          </span>
          <b>Nothing marked yet</b>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.day}>
          <h2>{g.day}</h2>
          <div className="group">
            {g.items.map((m) => {
              const status = statusOf(m);
              const idx = m.matchedIndex ?? (m.kind === 'anime' ? m.candidates.length - 1 : 0);
              const text = m.cardSentence ?? m.candidates[idx]?.text ?? m.candidates[0]?.text;
              return (
                <button key={m.id} className="list-item" onClick={() => navigate(`inbox/${m.id}`)}>
                  <div className="inbox-row">
                    <div className="symbol">
                      <Icon name={KIND_ICON[m.kind] ?? 'inbox'} size={18} />
                    </div>
                    <div className="grow">
                      <div className="line jp ellipsis">{text ?? <span className="faint">No text</span>}</div>
                      <div className="meta ellipsis">
                        {new Date(m.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {m.sourceLabel}
                        {m.cardTarget ? ` · ${m.cardTarget}` : ''}
                      </div>
                    </div>
                    <span className={`trail ${status.cls}`}>{status.label}</span>
                    <Icon name="chevron" size={18} weight={2} className="chev" />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
