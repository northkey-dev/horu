import { useEffect, useRef, useState } from 'react';
import { anilistLoginUrl, anilistViewer } from '../../../shared/anilist.ts';
import { parseImport } from '../../../shared/importLines.ts';
import { api, laptopUp } from '../lib/api.ts';
import { useEventTick } from '../lib/hooks.ts';
import { laptopUrl } from '../lib/laptop.ts';
import { anilistToken, mineText, setAnilistToken } from '../lib/phone.ts';

// Settings → AniList and Import sentences. Both work from the phone alone; a reachable laptop gets the
// AniList token too (it ticks off what the extension recorded) and takes imports into its inbox.

const CLIENT = 'horu-anilist-client';

export function AniList() {
  useEventTick('horu-phone');
  const token = anilistToken();
  const [client, setClient] = useState(() => localStorage.getItem(CLIENT) ?? '');
  const [paste, setPaste] = useState('');
  const [viewer, setViewer] = useState<string>();
  const [note, setNote] = useState<string>();

  useEffect(() => {
    setViewer(undefined);
    if (token) anilistViewer(token).then(setViewer, (e: Error) => setNote(e.message));
  }, [token]);

  async function save(t: string) {
    setAnilistToken(t);
    setPaste('');
    if (laptopUp()) await api.saveSettings({ anilistToken: t.trim() }).catch(() => undefined);
  }

  if (token)
    return (
      <>
        <div className="group">
          <div className="cell">
            <span className="grow">AniList</span>
            <span className="value">{viewer ?? 'Connected'}</span>
          </div>
          <button className="list-item action-row" onClick={() => save('')}>
            Disconnect
          </button>
        </div>
        <p className="footnote">{note ?? 'Episodes are ticked off in your list once about two thirds of them played (extension or episode clock).'}</p>
      </>
    );

  return (
    <>
      <div className="group">
        <label className="field stacked">
          <span>AniList client ID</span>
          <input
            inputMode="numeric"
            value={client}
            onChange={(e) => {
              setClient(e.target.value);
              localStorage.setItem(CLIENT, e.target.value.trim());
            }}
          />
          <div className="hint">
            Once: anilist.co → Settings → Developer → Create client, redirect URL <code>{location.origin + location.pathname}</code>. Copy its ID here.
          </div>
        </label>
        <button className="list-item action-row" disabled={!client.trim()} onClick={() => (location.href = anilistLoginUrl(client.trim()))}>
          Connect AniList
        </button>
        <label className="field stacked">
          <span>Or paste a token</span>
          <input type="password" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={paste} onChange={(e) => setPaste(e.target.value)} onBlur={() => paste.trim() && save(paste)} />
        </label>
      </div>
      <p className="footnote">{note ?? 'Ticks off watched episodes. MyAnimeList users can sync AniList to MAL with a tool like MAL-Sync.'}</p>
    </>
  );
}

export function ImportSentences() {
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(f: File) {
    setBusy(true);
    setNote(undefined);
    try {
      const text = await f.text();
      const name = f.name.replace(/\.[^.]+$/, '');
      if (laptopUp()) {
        const { count } = await api.importLines(text, name);
        setNote(`${count} sentences added to the inbox.`);
      } else {
        const lines = parseImport(text).slice(0, 500);
        if (!lines.length) throw new Error('No Japanese sentences found in that file');
        for (const l of lines) mineText(l.sentence, l.word ?? '', l.source ?? name, name);
        setNote(`${lines.length} sentences added to the inbox on this phone.`);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="group">
        <button className="list-item action-row" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? 'Importing…' : 'Import sentences (CSV, TSV, JSON)…'}
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void run(f);
        }}
      />
      <p className="footnote">{note ?? 'Saved items from Language Reactor, asbplayer or Migaku exports, or any list with a sentence column. They land in the inbox like mined lines.'}</p>
    </>
  );
}

/** Settings → Laptop: an iOS Shortcut that marks without leaving the video (Back Tap, Action button, Siri). */
export function RemoteMark() {
  const [copied, setCopied] = useState(false);
  // A Shortcut needs the full address, also when the laptop serves this app itself (then the path alone is relative).
  const url = new URL(laptopUrl('/api/mark/remote'), location.href).href;
  const startUrl = new URL(laptopUrl('/api/recording/start'), location.href).href;
  return (
    <details className="group remote-mark">
      <summary className="cell list-item">
        <span className="grow">Mark without opening Horu</span>
        <span className="value">Back Tap, Siri</span>
      </summary>
      <div className="cell stacked-text">
        <p>A Shortcut sends the mark to the laptop: the extension takes it while it records, otherwise this phone places it on the episode clock. It counts only while Chrome records the tab or an episode is running on this phone, so a knock in your pocket does nothing.</p>
        <ol>
          <li>Shortcuts app → + → <i>Get Contents of URL</i>.</li>
          <li>
            URL:{' '}
            <button
              className="link"
              onClick={() =>
                navigator.clipboard.writeText(url).then(
                  () => setCopied(true),
                  () => prompt('Copy this address', url),
                )
              }
            >
              {copied ? 'copied' : 'copy the address'}
            </button>
            , Method <b>POST</b>. Name the shortcut “Horu mark”.
          </li>
          <li>Settings → Accessibility → Touch → Back Tap → Double Tap → Horu mark. Or put it on the Action button, or say “Hey Siri, Horu mark”.</li>
        </ol>
        <p>
          Start the recording from the couch the same way: a second Shortcut with <i>Get Contents of URL</i>, Method <b>POST</b>, named “Horu record”, URL{' '}
          <button
            className="link"
            onClick={() => navigator.clipboard.writeText(startUrl).catch(() => prompt('Copy this address', startUrl))}
          >
            copy
          </button>
          . Say “Hey Siri, Horu record”. The video's tab must be the one open in Chrome on the laptop (Windows).
        </p>
        <p className="muted">Needs Tailscale on the phone. Without the laptop, switch to Horu instead: it offers a mark at the moment you left the video.</p>
      </div>
    </details>
  );
}
