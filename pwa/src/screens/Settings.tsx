import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { loadDictionary } from '../lib/japanese.ts';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import { LaptopConnect } from '../components/LaptopConnect.tsx';
import { PhoneSettings } from '../components/PhoneSettings.tsx';
import { PhoneCards } from '../components/PhoneCards.tsx';
import { Dictionaries, KnownWordsImport } from '../components/KnownWords.tsx';
import { AniList, ImportSentences, RemoteMark } from '../components/Integrations.tsx';
import { shareFile } from '../lib/cards.ts';
import { laptopUrl } from '../lib/laptop.ts';
import { Doctor } from '../components/Doctor.tsx';
import { AiLog, AiOrder } from '../components/AiOrder.tsx';
import { hasLaptop, laptopBase } from '../lib/laptop.ts';
import { disablePush, enablePush, pushEnabled, pushSupported } from '../lib/push.ts';
import { readTheme, setTheme as saveTheme, type ThemePref } from '../lib/theme.ts';
import { readerPrefs, setReaderPrefs } from '../lib/readerPrefs.ts';
import { useEventTick } from '../lib/hooks.ts';
import type { Settings as S, Status } from '../../../shared/types.ts';

const MPV_PIPE = String.raw`\\.\pipe\mpvsocket`;

type Toggle = 'jlptBaseline' | 'autoMatchWhisper' | 'kanjiCards' | 'animeScreenshot' | 'voiceCards' | 'voiceOnline' | 'reminderEnabled' | 'prepBeforeWatch' | 'prepBeforeRead' | 'showAdultSources';

export function Settings({ status }: { status?: Status }) {
  const [s, setS] = useState<S>();
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [dict, setDict] = useState<string>('checking…');
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const [backupNote, setBackupNote] = useState<string>();
  const [backupDays, setBackupDays] = useState<string[]>([]);
  const [restoreDay, setRestoreDay] = useState('');
  const [push, setPush] = useState<boolean>();
  const [pushNote, setPushNote] = useState<string>();

  useEffect(() => {
    pushEnabled().then(setPush, () => setPush(false));
  }, []);

  async function togglePush() {
    setPushNote(undefined);
    try {
      if (push) await disablePush();
      else await enablePush();
      setPush(await pushEnabled());
    } catch (e) {
      setPushNote((e as Error).message);
    }
  }

  useEffect(() => {
    api.backups().then(
      (b) => {
        setBackupDays(b.days);
        setRestoreDay((d) => d || b.days[0] || '');
      },
      () => undefined,
    );
  }, [backupNote, status?.version]);

  async function restoreBackup() {
    if (!restoreDay || !confirm(`Replace your current data with the backup from ${restoreDay}? Horu restarts. The current state is kept as a safety copy.`)) return;
    try {
      await api.restoreBackup(restoreDay);
      setBackupNote('Restored. Horu is restarting…');
      setTimeout(() => location.reload(), 8000);
    } catch (e) {
      setBackupNote((e as Error).message);
    }
  }

  async function backup() {
    setBackupNote(undefined);
    try {
      // Save a changed folder first so the copy goes there.
      if (dirty) await save();
      const { written } = await api.backupNow();
      setBackupNote(`Saved to ${written.join(' and ')}`);
    } catch (e) {
      setBackupNote((e as Error).message);
    }
  }

  async function testPush() {
    setPushNote(undefined);
    try {
      await api.pushTest();
      setPushNote('Sent. It should arrive in a few seconds.');
    } catch (e) {
      setPushNote((e as Error).message);
    }
  }

  // Again whenever the laptop comes back (or gets connected), unless there are unsaved edits.
  const online = Boolean(status);
  useEffect(() => {
    if (dirty) return;
    api.settings().then(
      (v) => (setS(v), setError(undefined)),
      (e: Error) => setError(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    loadDictionary().then(
      (m) => setDict(`${m.size.toLocaleString()} word forms · works offline`),
      (e: Error) => setDict(e.message),
    );
  }, []);

  useEffect(() => saveTheme(theme), [theme]);

  const [modules, setModules] = useState<Awaited<ReturnType<typeof api.modules>>>();
  useEffect(() => {
    if (online) api.modules().then(setModules, () => undefined);
  }, [online]);

  function update(patch: Partial<S>) {
    if (!s) return;
    setS({ ...s, ...patch });
    setDirty(true);
  }

  async function save() {
    if (!s) return;
    setError(undefined);
    try {
      await api.saveSettings(s);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const field = <K extends keyof S>(key: K, label: string, type: 'text' | 'number' = 'text', hint?: string, stacked = false) =>
    s && (
      <label className={`field${stacked ? ' stacked' : ''}`}>
        <span>{label}</span>
        <input
          type={type}
          inputMode={type === 'number' ? 'numeric' : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={String(s[key])}
          onChange={(e) => update({ [key]: type === 'number' ? Number(e.target.value) : e.target.value } as Partial<S>)}
        />
        {hint && <div className="hint">{hint}</div>}
      </label>
    );

  const toggle = (key: Toggle, label: string, hint?: string) =>
    s && (
      <label className="toggle">
        <input type="checkbox" checked={s[key]} onChange={(e) => update({ [key]: e.target.checked } as Partial<S>)} />
        <span className="grow">
          {label}
          {hint && <span className="hint">{hint}</span>}
        </span>
      </label>
    );

  return (
    <div>
      <Nav />
      <h1>Settings</h1>
      <VersionLine laptop={status?.version} online={Boolean(status)} />
      {error && <div className="banner error">{error}</div>}

      <h2>Laptop</h2>
      <LaptopConnect online={Boolean(status)} />
      {hasLaptop() && <RemoteMark />}

      <h2>This phone</h2>
      <PhoneSettings />

      <h2>Cards on this phone</h2>
      <PhoneCards />

      <h2>Manga reader</h2>
      <ReaderSettings />

      <h2>Known words</h2>
      <KnownWordsImport online={online} />

      <h2>Dictionaries</h2>
      <Dictionaries online={online} />

      <h2>AniList</h2>
      <AniList />

      <h2>Import sentences</h2>
      <ImportSentences />

      <h2>Status</h2>
      <div className="group">
        <StatusRow label="Laptop" ok={Boolean(status)} value={status ? `v${status.version}` : 'Offline'} />
        <StatusRow label="Anki" ok={status?.anki === 'ok'} warn={status?.anki === 'starting'} value={status?.anki === 'ok' ? 'Connected' : status?.anki === 'starting' ? 'Starting' : 'Offline'} />
        <StatusRow
          label="Chrome extension"
          ok={status?.extensionRecording}
          warn={status?.extensionConnected && !status.extensionRecording}
          value={status?.extensionRecording ? 'Recording' : status?.extensionConnected ? 'Idle' : 'Not connected'}
        />
        <StatusRow label="Jimaku" ok={status?.jimakuConfigured} value={status?.jimakuConfigured ? 'Ready' : 'No API key'} />
        <StatusRow label="Whisper" ok={status?.whisperAvailable} value={status?.whisperAvailable ? 'Ready' : 'Unavailable'} />
      </div>
      <p className="footnote">Dictionary: {dict}. Anki is started automatically when a card is created.</p>
      <Doctor online={Boolean(status)} />

      {modules && (
        <>
          <h2>Laptop modules</h2>
          <div className="group">
            <StatusRow label="Whisper" ok={modules.whisper} value={modules.whisper ? 'Installed' : 'Not installed'} />
            <StatusRow label="Manga sources" ok={modules.manga} value={modules.manga ? 'Installed' : 'Not installed'} />
            <StatusRow label="Text recognition" ok={modules.ocr} value={modules.ocr ? 'Installed' : 'Not installed'} />
            <StatusRow label="Voice for cards" ok={modules.voice} value={modules.voice ? 'Installed' : 'Not installed'} />
            <StatusRow label="Claude Code" ok={modules.claude} value={modules.claude ? 'Installed' : 'Not installed'} />
            <StatusRow label="Ollama" ok={modules.ollama} value={modules.ollama ? 'Running' : 'Not running'} />
          </div>
          <p className="footnote">
            Add one later on the laptop: <code>scripts\install.ps1 -Modules whisper,manga,tts,claude,ollama</code> (pick the ones you want).
          </p>
        </>
      )}

      {s && (
        <>
          <h2>Progress</h2>
          <div className="group">{field('dailyGoalXp', 'Daily goal (XP)', 'number', 'Fills the ring on Insights. About 40 XP is 20 reviews and a few marks; a card is worth 10.')}</div>

          <h2>Reminder</h2>
          <div className="group">
            {toggle('reminderEnabled', 'Remind me when the goal is open', 'One notification a day, only if you have not reached your goal. The laptop has to be on.')}
            <label className="field">
              <span>Time</span>
              <input type="time" value={s.reminderTime} onChange={(e) => update({ reminderTime: e.target.value || '19:00' })} />
            </label>
            {pushSupported() ? (
              <>
                <button className="list-item action-row" onClick={togglePush} disabled={push === undefined}>
                  {push ? 'Stop notifications on this device' : 'Allow notifications on this device'}
                </button>
                {push && (
                  <button className="list-item action-row" onClick={testPush}>
                    Send a test notification
                  </button>
                )}
              </>
            ) : (
              <div className="cell">
                <span className="grow muted">On iPhone: Share → Add to Home Screen, then open Horu from there (iOS 16.4 or newer).</span>
              </div>
            )}
          </div>
          {pushNote && <p className="footnote">{pushNote}</p>}

          <h2>Subtitles</h2>
          <div className="group">{field('jimakuApiKey', 'Jimaku API key', 'text', 'Free: create an account on jimaku.cc, then copy the key from your account page.', true)}</div>

          <h2>Cards on the laptop</h2>
          <div className="group">
            {field('deckName', 'Anki deck')}
            {field('newCardsPerDay', 'New cards per day', 'number', 'Applied when the deck is created; later change it in Anki’s deck options.')}
            <AiOrder s={s} update={update} />
            <AiLog online={online} />
            <label className="field stacked">
              <span>About you (for the AI)</span>
              <textarea rows={3} value={s.learnerProfile} onChange={(e) => update({ learnerProfile: e.target.value })} />
              <div className="hint">Level and goals, so explanations fit. Phones use it too unless they set their own.</div>
            </label>
            {toggle('animeScreenshot', 'Screenshot on anime cards', 'Off: anime cards only get sentence and audio. Manga cards always get their panel.')}
            {modules?.voice && toggle('voiceCards', 'Voice on cards without sound', 'Manga, text and photo cards get a computer voice reading the sentence. It runs on the laptop and costs nothing. It can misread a word: the furigana on the card count.')}
            {modules?.voice && toggle('voiceOnline', 'Natural voice for Listen', 'The Listen buttons in the reader use the neural Japanese voice of Microsoft Edge (free, needs internet on the laptop). The sentence is sent to Microsoft for that. Off: the voice of this computer (Kokoro) or the phone.')}
            {toggle('kanjiCards', 'Kanji cards', 'Also add one card per new kanji of a target word (subdeck “::Kanji”).')}
          </div>

          <h2>Preparation</h2>
          <div className="group">
            {toggle('prepBeforeWatch', 'Before you watch', 'On the Watch screen: how much of the episode you will understand and its key new words.')}
            {toggle('prepBeforeRead', 'Before you read', 'On a manga page: the same for the chapter you are about to read.')}
            {field('prepWordCount', 'Words in the list', 'number', '5 to 30. More words cover more of the text, but each extra word adds less.')}
          </div>

          <h2>Listening</h2>
          <div className="group">
            {field('bufferSeconds', 'Audio per mark (s)', 'number')}
            {field('keepDays', 'Keep finished (days)', 'number', 'After a card is made or a moment discarded, it stays in History and can be put back for this long.')}
            {field('whisperModel', 'Whisper model', 'text', 'small is fast · medium is better (default) · large-v3 is best, slow on this CPU')}
            {toggle('autoMatchWhisper', 'Pick the line by ear', 'Whisper listens to every mark and preselects the subtitle line that was actually spoken.')}
          </div>

          <h2>Backup</h2>
          <div className="group">
            {field('backupFolder', 'Extra copy to', 'text', 'Optional, e.g. a OneDrive folder. Horu keeps the last 7 days and one per week for the 4 weeks before in data/backups. The extra copy leaves out your Jimaku key, access token and push keys.', true)}
            <button className="list-item action-row" onClick={backup}>
              Back up now
            </button>
            {backupDays.length > 0 && (
              <div className="cell restore-row">
                <span>Restore</span>
                <select value={restoreDay} onChange={(e) => setRestoreDay(e.target.value)}>
                  {backupDays.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
                <button className="small danger" onClick={restoreBackup}>
                  Restore
                </button>
              </div>
            )}
          </div>
          {backupNote && <p className="footnote">{backupNote}</p>}

          <h2>Known words from Anki</h2>
          <div className="group">
            {field('knownWordsQuery', 'Anki search', 'text', 'Which reviewed cards count as known. Empty means all decks. Example: deck:Japanisch*', true)}
            {toggle('jlptBaseline', 'Count JLPT N5 and N4 as known')}
          </div>

          <h2>Media player</h2>
          <div className="group">
            <label className="field">
              <span>Player</span>
              <select value={s.playerKind} onChange={(e) => update({ playerKind: e.target.value as S['playerKind'] })}>
                <option value="none">None</option>
                <option value="jellyfin">Jellyfin</option>
                <option value="plex">Plex</option>
                <option value="kodi">Kodi</option>
                <option value="mpv">mpv on this laptop</option>
              </select>
            </label>
            {s.playerKind !== 'none' &&
              field(
                'playerUrl',
                s.playerKind === 'mpv' ? 'IPC pipe' : 'Server address',
                'text',
                s.playerKind === 'mpv'
                  ? `Empty = ${MPV_PIPE}. Start mpv with --input-ipc-server=${MPV_PIPE} (or put it in mpv.conf).`
                  : s.playerKind === 'kodi'
                    ? 'e.g. http://192.168.1.20:8080 (Kodi → Settings → Services → Control → Allow remote control via HTTP).'
                    : s.playerKind === 'plex'
                      ? 'e.g. http://192.168.1.20:32400'
                      : 'e.g. http://192.168.1.20:8096',
                true,
              )}
            {(s.playerKind === 'jellyfin' || s.playerKind === 'plex' || s.playerKind === 'kodi') &&
              field(
                'playerToken',
                s.playerKind === 'jellyfin' ? 'API key' : s.playerKind === 'plex' ? 'Plex token' : 'User:password',
                'text',
                s.playerKind === 'jellyfin' ? 'Jellyfin → Dashboard → API keys.' : s.playerKind === 'plex' ? 'See “Finding an authentication token” in Plex’s help.' : 'Only if Kodi asks for a login.',
                true,
              )}
          </div>
          <p className="footnote">Watching on a TV through one of these? Start the episode under Watch → TV or other screen and switch on “Follow” there: the phone’s clock then runs with the player.</p>

          <h2>More from other tools</h2>
          <div className="group">
            {field('jpdbDeckId', 'jpdb deck ID', 'text', 'Also add each card’s word with its sentence to this jpdb.io deck (the number in the deck’s address). Uses the jpdb key below.', true)}
            {field('jpdbApiKey', 'jpdb API key', 'text', 'jpdb.io → Settings. Also keeps the words jpdb knows in your known words.', true)}
            {field('webhookUrl', 'Webhook', 'text', 'Every new mark and card is POSTed here as JSON (n8n, Zapier, Home Assistant, a script of yours).', true)}
            <button
              className="list-item action-row"
              onClick={async () => {
                const res = await fetch(laptopUrl('/api/export'));
                if (res.ok) await shareFile(new File([await res.blob()], `horu-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' }));
              }}
            >
              Export everything as JSON
            </button>
          </div>

          <h2>Manga server</h2>
          <div className="group">
            <label className="field">
              <span>Server</span>
              <select value={s.mangaServerKind} onChange={(e) => update({ mangaServerKind: e.target.value as S['mangaServerKind'] })}>
                <option value="none">None</option>
                <option value="komga">Komga</option>
                <option value="kavita">Kavita</option>
              </select>
            </label>
            {s.mangaServerKind !== 'none' && field('mangaServerUrl', 'Address', 'text', 'e.g. http://192.168.1.20:25600', true)}
            {s.mangaServerKind !== 'none' && field('mangaServerKey', 'API key', 'text', s.mangaServerKind === 'komga' ? 'Komga → Account → API keys.' : 'Kavita → User settings → 3rd party clients.', true)}
          </div>
          <p className="footnote">Volumes from your server are imported into Horu’s manga library (Read → Manga → Server) and get text recognition like an uploaded file. A volume that comes with a .mokuro file needs none.</p>

          <h2>Games</h2>
          <div className="group">{field('hookUrl', 'Text hooker', 'text', 'WebSocket of Textractor (its WebSocket extension, port 6677) or LunaTranslator. Lines show under Read → Texts → Game text.', true)}</div>

          <h2>Manga</h2>
          <div className="group">
            {field('mangaPrefetchChapters', 'Chapters prepared at once', 'number', 'From the chapter you are on. 1 prepares one chapter at a time: the next one starts when you finish this one, or when you tap it in the chapter list.')}
            {field('mangaMaxActive', 'Manga read in parallel', 'number')}
            {field('mangaKeepReadDays', 'Remove read chapters after (days)', 'number')}
            {toggle('showAdultSources', 'Show 18+ sources', 'The extension store marks most Japanese raw sites 18+ (Rawkuma, Pixiv Comic, Piccoma …), so they are hidden until this is on.')}
            {field('mangaExtensionRepo', 'Extension repository', 'text', 'Address of a Suwayomi/Mihon extension repository (its index URL). Horu ships none; sources and what you read through them are your responsibility.', true)}
            {field('suwayomiUrl', 'Suwayomi server', 'text', 'Started automatically from tools/suwayomi.', true)}
          </div>

          <div className="action-bar" style={{ display: dirty || saved ? 'flex' : 'none' }}>
            <button className="primary" onClick={save} disabled={!dirty}>
              {saved ? (
                <>
                  <Icon name="check" size={18} weight={2.2} /> Saved
                </>
              ) : (
                'Save changes'
              )}
            </button>
          </div>
        </>
      )}

      <h2>Appearance</h2>
      <div className="segmented" role="radiogroup" aria-label="Appearance">
        {(['system', 'dark', 'light'] as const).map((t) => (
          <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>
            {t === 'system' ? 'Automatic' : t === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>

      <h2>Install on iPhone</h2>
      <div className="card small">
        <ol className="steps">
          <li>
            Open <code>{location.host + location.pathname.replace(/\/$/, '')}</code> in Safari → Share → Add to Home Screen.
          </li>
          <li>
            With a laptop: install Tailscale on both, run <code>tailscale serve --bg 7317</code> on the laptop, then scan the code from its tray icon → Connect phone… under Laptop above.
          </li>
        </ol>
      </div>

      <h2>Japanese text anywhere on the iPhone</h2>
      <div className="card small">
        <p style={{ marginTop: 0 }}>Set up once, then tap the back of the iPhone twice on any Japanese text (Instagram, games, websites):</p>
        <ol className="steps">
          <li>
            Shortcuts app → <b>+</b> → add <b>Take Screenshot</b>.
          </li>
          <li>
            Add <b>Get Contents of URL</b>: URL <code>{laptopBase() || location.origin}/api/screen?format=text</code>, Method <b>POST</b>, Request Body <b>File</b> → Screenshot.
          </li>
          <li>
            Add <b>Show Result</b> (Contents of URL). Name it “Horu”.
          </li>
          <li>
            Settings → Accessibility → Touch → <b>Back Tap</b> → Double Tap → <b>Horu</b>.
          </li>
        </ol>
      </div>
      <p className="footnote">You get the text with readings and new words in a few seconds; the screenshot also lands in the inbox. Needs the laptop to be on.</p>
    </div>
  );
}

function StatusRow({ label, value, ok, warn }: { label: string; value: string; ok?: boolean; warn?: boolean }) {
  return (
    <div className="cell">
      <span className="grow">{label}</span>
      <span className={`status ${ok ? 'ok' : warn ? 'warn' : 'bad'}`} style={{ fontSize: 17, lineHeight: '22px' }}>
        {value}
        <span className="dot" />
      </span>
    </div>
  );
}

/** Release numbers of the app and the laptop, so an outdated one stands out after an update. */
function VersionLine({ laptop, online }: { laptop?: string; online: boolean }) {
  const order = (v: string) => v.split('.').map(Number).reduce((n, part) => n * 1000 + (part || 0), 0);
  const app = __APP_VERSION__;
  return (
    <p className="version-line">
      <span>App v{app}</span>
      {online && <span>Laptop v{laptop ?? 'unknown'}</span>}
      {laptop && laptop !== app && (
        <span className="label-warn">
          {order(laptop) < order(app) ? 'The laptop runs older code: restart Horu there.' : 'This app is older than the laptop: reopen it (it updates itself), or run npm run deploy.'}
        </span>
      )}
    </p>
  );
}

/** Reader options that live on this phone. */
function ReaderSettings() {
  useEventTick('horu-reader');
  const prefs = readerPrefs();
  return (
    <>
      <div className="group">
        <label className="toggle">
          <input type="checkbox" checked={prefs.bubbleTint} onChange={(e) => setReaderPrefs({ bubbleTint: e.target.checked })} />
          <span className="grow">
            Tint speech bubbles by new words
            <span className="hint">Bubbles with words you do not know yet get a colour: the more new words, the stronger. Off by default. Takes effect when you open a chapter.</span>
          </span>
        </label>
      </div>
    </>
  );
}
