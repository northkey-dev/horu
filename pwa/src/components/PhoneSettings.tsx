import { useState } from 'react';
import { useEventTick } from '../lib/hooks.ts';
import { buildBackup, restoreBackup } from '../lib/backup.ts';
import { shareFile } from '../lib/cards.ts';
import { localMoments, phoneJimakuKey, quickContinue, setPhoneJimakuKey, setQuickContinue, setTranslatesAhead, setWordByWord, translatesAhead, wordByWord } from '../lib/phone.ts';

// Settings → This phone: what the phone needs to watch without the laptop. Stored on the phone only.

export function PhoneSettings() {
  useEventTick('horu-phone');
  const [key, setKey] = useState(phoneJimakuKey);
  const saved = key.trim() === phoneJimakuKey();
  const waiting = localMoments().length;

  return (
    <>
      <div className="group">
        <label className="field stacked">
          <span>Jimaku API key</span>
          <input autoCapitalize="off" autoCorrect="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => setPhoneJimakuKey(key)} />
          <div className="hint">
            {saved && key ? 'Saved on this phone.' : 'Free: create an account on jimaku.cc and copy the key from your account page. A connected laptop hands its key over by itself.'}
          </div>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={quickContinue()} onChange={(e) => setQuickContinue(e.target.checked)} />
          <span className="grow">
            Continue starts at once
            <span className="hint">Watch → Continue: one tap starts the next episode with the first subtitle file. Off: the tap opens the episode page, where you can pick another one.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={translatesAhead()} onChange={(e) => setTranslatesAhead(e.target.checked)} />
          <span className="grow">
            Translate ahead
            <span className="hint">A speech bubble or photo line starts translating when you open it, so Translate answers at once. Costs one AI request per line you open, also if you never press Translate.</span>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={wordByWord()} onChange={(e) => setWordByWord(e.target.checked)} />
          <span className="grow">
            Word by word
            <span className="hint">A translation also lists every word of the line with its reading and meaning. Makes the answer a little longer.</span>
          </span>
        </label>
        {waiting > 0 && (
          <div className="cell">
            <span className="grow">Marks waiting for the laptop</span>
            <span className="value">{waiting}</span>
          </div>
        )}
      </div>
      <p className="footnote">Used when the episode runs on a TV or the laptop is off: the phone loads subtitles itself and keeps your marks until the laptop is back.</p>
      <PhoneBackup />
    </>
  );
}

/** Everything that lives only on this phone, as one file: for a new phone, or if the browser clears its storage. */
function PhoneBackup() {
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setNote(undefined);
    try {
      const { file, summary } = await buildBackup();
      if (await shareFile(file)) setNote(`Saved ${file.name}: ${summary}.`);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restore(file?: File) {
    if (!file) return;
    setBusy(true);
    setNote(undefined);
    try {
      setNote(await restoreBackup(file));
      setTimeout(() => location.reload(), 1800);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Backup of this phone</h2>
      <div className="group">
        <button className="list-item action-row" onClick={save} disabled={busy}>
          Save a backup file
        </button>
        <label className="list-item action-row">
          Restore from a backup file
          <input type="file" accept="application/json,.json" hidden disabled={busy} onChange={(e) => void restore(e.target.files?.[0]).then(() => (e.target.value = ''))} />
        </label>
      </div>
      <p className="footnote">
        {note ?? 'Marks and sessions waiting for the laptop, texts, word status, kanji progress, cards waiting for an export, reader notes and these settings. Not in it: keys, the laptop pairing, dictionaries, downloaded manga and the recordings of audio texts. Restoring adds to what the phone has; nothing is deleted. Keep the file in Files or iCloud Drive.'}
      </p>
    </>
  );
}
