import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { useEventTick } from '../lib/hooks.ts';
import { importDictionary, importKnown, knownSummary, phoneDicts, removePhoneDict, type KnownSource } from '../lib/words.ts';
import type { DictInfo } from '../../../shared/yomitan.ts';

// Settings → Known words and Dictionaries: import known words from other tools, and Yomitan dictionaries
// (Jitendex, frequency lists, pitch accent). Both go to the laptop when it is reachable, else stay on the phone.

const SOURCES: { value: KnownSource; label: string; hint: string }[] = [
  { value: 'wanikani', label: 'WaniKani', hint: 'API token from wanikani.com → Settings → API tokens (read-only is enough). Vocabulary at Guru and above counts.' },
  { value: 'jpdb', label: 'jpdb.io', hint: 'API key from jpdb.io → Settings. Words jpdb considers known count.' },
  { value: 'list', label: 'Word list', hint: 'One word per line, or a CSV/TSV whose first column is the word (e.g. exported from Anki, Migaku, Language Reactor).' },
];

export function KnownWordsImport({ online }: { online: boolean }) {
  useEventTick('horu-words');
  const [source, setSource] = useState<KnownSource>('wanikani');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof knownSummary>>>();
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    knownSummary().then(setSummary, () => undefined);
  }, [busy, online]);

  async function run(text = input) {
    setBusy(true);
    setNote(undefined);
    try {
      const { count, where } = await importKnown(source, text);
      setNote(`${count.toLocaleString()} words imported${where === 'laptop' ? ' on the laptop (kept up to date from there)' : ' on this phone'}.`);
      setInput('');
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hint = SOURCES.find((s) => s.value === source)!.hint;
  return (
    <>
      <div className="group">
        {summary && (
          <div className="cell">
            <span className="grow">Known words on this phone</span>
            <span className="value num">{summary.total.toLocaleString()}</span>
          </div>
        )}
        <label className="field">
          <span>Import from</span>
          <select value={source} onChange={(e) => setSource(e.target.value as KnownSource)}>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field stacked">
          <span>{source === 'list' ? 'Words' : 'Key'}</span>
          {source === 'list' ? (
            <textarea rows={3} className="jp" value={input} onChange={(e) => setInput(e.target.value)} placeholder={'食べる\n見る\n…'} />
          ) : (
            <input type="password" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} />
          )}
          <div className="hint">{hint}</div>
        </label>
        {source === 'list' && (
          <button className="list-item action-row" disabled={busy} onClick={() => file.current?.click()}>
            Choose a file…
          </button>
        )}
        <button className="list-item action-row" disabled={busy || !input.trim()} onClick={() => run()}>
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".txt,.csv,.tsv,text/plain,text/csv"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await run(await f.text());
        }}
      />
      <p className="footnote">{note ?? 'Anki stays the main source while the laptop runs. Tap a word anywhere to set its status (1–4, known, ignore).'}</p>
    </>
  );
}

export function Dictionaries({ online }: { online: boolean }) {
  const [laptop, setLaptop] = useState<DictInfo[]>([]);
  const [phone, setPhone] = useState<DictInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const file = useRef<HTMLInputElement>(null);

  const reload = () => {
    if (online) api.dicts().then(setLaptop, () => undefined);
    phoneDicts().then(setPhone, () => undefined);
  };
  useEffect(reload, [online]);

  async function add(f: File) {
    setBusy(true);
    setNote(`Reading ${f.name}…`);
    try {
      const { info, where } = await importDictionary(f);
      const c = info.counts;
      setNote(`${info.title}: ${[c.terms && `${c.terms.toLocaleString()} entries`, c.freq && `${c.freq.toLocaleString()} frequencies`, c.pitch && `${c.pitch.toLocaleString()} pitch accents`].filter(Boolean).join(', ')} · on the ${where}.`);
      reload();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: DictInfo, where: 'laptop' | 'phone') {
    if (!confirm(`Remove ${d.title}?`)) return;
    if (where === 'laptop') await api.removeDict(d.id).catch((e: Error) => setNote(e.message));
    else await removePhoneDict(d.id);
    reload();
  }

  const row = (d: DictInfo, where: 'laptop' | 'phone') => (
    <div key={`${where}:${d.id}`} className="cell">
      <span className="grow">
        {d.title}
        <span className="hint">
          {where === 'laptop' ? 'Laptop' : 'This phone'} · {d.counts.terms ? 'definitions' : d.counts.freq ? 'frequency' : 'pitch accent'}
        </span>
      </span>
      <button className="small danger" onClick={() => remove(d, where)}>
        Remove
      </button>
    </div>
  );

  return (
    <>
      <div className="group">
        {laptop.map((d) => row(d, 'laptop'))}
        {phone.map((d) => row(d, 'phone'))}
        <button className="list-item action-row" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? 'Importing…' : 'Add a Yomitan dictionary (.zip)…'}
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void add(f);
        }}
      />
      <p className="footnote">
        {note ??
          'Shown under JMdict when you tap a word. Good ones: Jitendex (definitions), JPDB or Innocent Corpus (frequency), Kanjium (pitch accent). Big dictionaries belong on the laptop; without it they go into this phone.'}
      </p>
    </>
  );
}
