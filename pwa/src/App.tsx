import { useEffect, useState } from 'react';
import { api, flushOutbox } from './lib/api.ts';
import { flash, navigate, useEventTick, usePoll, useRoute } from './lib/hooks.ts';
import { currentSession, pendingPhone, setAnilistToken, syncPhone } from './lib/phone.ts';
import { hasLaptop, parseLaptop, setLaptop } from './lib/laptop.ts';
import { preloadJapanese } from './lib/japanese.ts';
import { learnFromLaptop, queuedCount } from './lib/cards.ts';
import { Icon } from './components/Icon.tsx';
import { Watch } from './screens/Watch.tsx';
import { Inbox } from './screens/Inbox.tsx';
import { History } from './screens/History.tsx';
import { InboxItem } from './screens/InboxItem.tsx';
import { Settings } from './screens/Settings.tsx';
import { Manga } from './screens/Manga.tsx';
import { Insights } from './screens/Insights.tsx';
import { Texts } from './screens/Texts.tsx';
import { Camera } from './screens/Camera.tsx';

// Once per start: the laptop's Anki note type, deck and learner profile, for cards the phone builds itself.
let learned = false;

const TABS = [
  { path: 'watch', label: 'Watch', icon: 'watch' },
  { path: 'inbox', label: 'Inbox', icon: 'inbox' },
  { path: 'manga', label: 'Read', icon: 'book' },
  { path: 'insights', label: 'Insights', icon: 'chart' },
  { path: 'settings', label: 'Settings', icon: 'settings' },
];

export function App() {
  const route = useRoute();
  const { data: status, error, refresh } = usePoll(() => api.status(), 2500);

  const [toast, setToast] = useState<string>();
  useEffect(() => {
    let timer: number | undefined;
    const onFlash = (e: Event) => {
      setToast((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = window.setTimeout(() => setToast(undefined), 3500);
    };
    addEventListener('horu-flash', onFlash);
    return () => removeEventListener('horu-flash', onFlash);
  }, []);

  useEffect(() => {
    preloadJapanese();
    if (!location.hash) navigate('watch');
  }, []);

  // Pairing link from the laptop's QR code: #/pair?laptop=https://name.tailnet.ts.net
  useEffect(() => {
    // Back from AniList's login: #access_token=…&token_type=Bearer
    const token = /^#access_token=([^&]+)/.exec(location.hash)?.[1];
    if (token) {
      setAnilistToken(decodeURIComponent(token));
      void api.saveSettings({ anilistToken: decodeURIComponent(token) }).catch(() => undefined);
      navigate('settings');
      return flash('AniList connected');
    }
    const m = /^#\/pair\?(.*)$/.exec(location.hash);
    if (!m) return;
    const url = parseLaptop(m[1]);
    if (url) setLaptop(url);
    navigate('settings');
    flash(url ? 'Laptop connected' : 'That link has no laptop address');
  }, [route]);

  useEffect(() => {
    addEventListener('horu-laptop', refresh);
    return () => removeEventListener('horu-laptop', refresh);
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    void flushOutbox();
    void syncPhone().catch(() => undefined);
    if (!learned) {
      learned = true;
      void Promise.all([api.ankiNoteType(), api.settings()]).then(([info, settings]) => learnFromLaptop(info, settings), () => (learned = false));
    }
  }, [status]);
  useEventTick('horu-phone');
  useEventTick('horu-cards');

  const [page = 'watch', arg] = route;
  // One missed check is not "away": over a relayed Tailscale link, or while the phone wakes its VPN, a single
  // poll can fail. Only two misses in a row count.
  const [misses, setMisses] = useState(0);
  useEffect(() => setMisses((m) => (error ? m + 1 : 0)), [error]);
  const offline = misses >= 2;
  const paired = hasLaptop();
  const inboxCount = (status?.inboxCount ?? 0) + pendingPhone();

  return (
    <>
      <main className="app">
        {offline && paired && page !== 'manga' && page !== 'texts' && page !== 'camera' && !(page === 'watch' && currentSession()) && (
          <div className="banner error" style={{ marginTop: 8 }}>
            <b>Laptop not reachable</b>
            {page === 'settings' ? '' : ' · Is it switched on? Showing what this phone saved.'}
          </div>
        )}
        {page === 'watch' && <Watch status={status} refreshStatus={refresh} />}
        {page === 'inbox' && !arg && <Inbox />}
        {page === 'history' && <History />}
        {page === 'inbox' && arg && <InboxItem id={arg} />}
        {page === 'manga' && <Manga route={route.slice(1)} online={!offline} />}
        {page === 'texts' && <Texts id={arg} />}
        {page === 'camera' && <Camera />}
        {page === 'insights' && <Insights />}
        {page === 'settings' && <Settings status={status} />}
      </main>
      {toast && <div className="toast top">{toast}</div>}
      <nav className="tabbar">
        <div className="tabbar-inner">
          {TABS.map((t) => {
            const active = page === t.path || (t.path === 'inbox' && page === 'history') || (t.path === 'manga' && (page === 'texts' || page === 'camera'));
            return (
              <a key={t.path} href={`#/${t.path}`} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
                <Icon name={t.icon} size={25} weight={1.5} />
                {t.label}
                {t.path === 'inbox' && inboxCount > 0 && <span className="badge">{inboxCount}</span>}
                {t.path === 'settings' && queuedCount() > 0 && <span className="badge quiet">{queuedCount()}</span>}
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
}
