import { useEffect, useState } from 'react';
import { AI_LABELS, DEFAULT_MODELS } from '../../../shared/ai.ts';
import { cardPrefs, deckName, exportCards, markExported, queueSummary, setCardPrefs, shareFile, type CardTarget, type ExportFormat, type PhoneAi } from '../lib/cards.ts';
import { useEventTick } from '../lib/hooks.ts';

// Settings → Cards on this phone: where cards go and who explains them when the phone makes them itself.
// Stored on the phone only (API keys never reach the laptop).

const TARGETS: { value: CardTarget; label: string; hint: string }[] = [
  { value: 'auto', label: 'Laptop, else collect on the phone', hint: 'The laptop’s Anki when it is reachable. Otherwise cards wait here as a file for AnkiMobile or AnkiDroid.' },
  { value: 'laptop', label: 'Always the laptop', hint: 'Cards wait in the inbox until the laptop is on.' },
  { value: 'apkg', label: 'Collect on the phone (.apkg)', hint: 'With audio and picture. Export below and open the file in AnkiMobile, AnkiDroid or Anki.' },
  { value: 'ankiconnect', label: 'AnkiConnect on this device', hint: 'AnkiDroid with the AnkiConnect Android app, or Anki on this computer. Adds each card right away.' },
  { value: 'ankimobile', label: 'AnkiMobile, one by one', hint: 'Opens AnkiMobile for each card. Text only, no audio. The Horu note type must exist there (import one .apkg first).' },
];

const AIS: { value: PhoneAi; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'gemini', label: AI_LABELS.gemini },
  { value: 'anthropic', label: AI_LABELS.anthropic },
  { value: 'openai', label: AI_LABELS.openai },
  { value: 'copy', label: 'Copy prompt into a chat app' },
  { value: 'none', label: 'No explanation' },
];

const KEY_HINTS = {
  gemini: 'Free: aistudio.google.com → Get API key. Stays on this phone.',
  anthropic: 'console.anthropic.com → API keys. Paid per card (a fraction of a cent).',
  openai: 'platform.openai.com → API keys. Paid per card.',
} as const;

export function PhoneCards() {
  useEventTick('horu-cards');
  const p = cardPrefs();
  const [draft, setDraft] = useState(p);
  const [summary, setSummary] = useState<{ waiting: number; exported: number; words: string[] }>();
  const [format, setFormat] = useState<ExportFormat>('apkg');
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    queueSummary().then(setSummary, () => undefined);
  }, [p.target, busy]);

  const target = TARGETS.find((t) => t.value === p.target) ?? TARGETS[0];
  const service = p.ai === 'gemini' || p.ai === 'anthropic' || p.ai === 'openai' ? p.ai : p.ai === 'auto' ? 'gemini' : undefined;

  async function exportNow(again: boolean) {
    setBusy(true);
    setNote(undefined);
    try {
      const { file, count } = await exportCards(format, again);
      if (await shareFile(file)) {
        if (!again) await markExported(count);
        setNote(`${count} card${count === 1 ? '' : 's'} exported as ${file.name}.`);
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
        <label className="field stacked">
          <span>Cards go to</span>
          <select value={p.target} onChange={(e) => setCardPrefs({ target: e.target.value as CardTarget })}>
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="hint">{target.hint}</div>
        </label>
        <label className="field stacked">
          <span>Explanation when the phone makes the card</span>
          <select value={p.ai} onChange={(e) => setCardPrefs({ ai: e.target.value as PhoneAi })}>
            {AIS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <div className="hint">
            {p.ai === 'auto'
              ? 'The laptop’s AI when the laptop makes the card; otherwise the first key below, else copy prompt.'
              : p.ai === 'copy'
                ? 'Copy the prompt, ask Claude, ChatGPT or Gemini, paste the answer back. No key needed.'
                : p.ai === 'none'
                  ? 'Cards get sentence, reading, audio and picture, no translation.'
                  : 'Called straight from this phone with your key.'}
          </div>
        </label>
        {service && (
          <label className="field stacked">
            <span>{AI_LABELS[service].replace(/ \(.*\)$/, '')} key</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              type="password"
              value={draft.keys[service] ?? ''}
              onChange={(e) => setDraft({ ...draft, keys: { ...draft.keys, [service]: e.target.value } })}
              onBlur={() => setCardPrefs({ keys: { ...cardPrefs().keys, [service]: (draft.keys[service] ?? '').trim() } })}
            />
            <div className="hint">{KEY_HINTS[service]}</div>
          </label>
        )}
        {service && (
          <label className="field">
            <span>Model</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={DEFAULT_MODELS[service]}
              value={draft.models[service] ?? ''}
              onChange={(e) => setDraft({ ...draft, models: { ...draft.models, [service]: e.target.value } })}
              onBlur={() => setCardPrefs({ models: { ...cardPrefs().models, [service]: (draft.models[service] ?? '').trim() } })}
            />
          </label>
        )}
        {p.target !== 'laptop' && (
          <label className="field">
            <span>Deck</span>
            <input value={draft.deck} placeholder={deckName({ ...p, deck: '' })} onChange={(e) => setDraft({ ...draft, deck: e.target.value })} onBlur={() => setCardPrefs({ deck: draft.deck.trim() })} />
          </label>
        )}
        {p.target === 'ankiconnect' && (
          <label className="field stacked">
            <span>AnkiConnect address</span>
            <input
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={draft.ankiConnectUrl}
              onChange={(e) => setDraft({ ...draft, ankiConnectUrl: e.target.value })}
              onBlur={() => setCardPrefs({ ankiConnectUrl: draft.ankiConnectUrl.trim() })}
            />
            <div className="hint">In AnkiConnect’s settings, add {location.origin} to the allowed origins (webCorsOriginList).</div>
          </label>
        )}
        <label className="field stacked">
          <span>About you (for the AI)</span>
          <textarea
            rows={2}
            value={draft.profile}
            placeholder={p.laptopProfile || 'Around JLPT N4, learned from a textbook, weak kanji. Goal: anime by ear.'}
            onChange={(e) => setDraft({ ...draft, profile: e.target.value })}
            onBlur={() => setCardPrefs({ profile: draft.profile.trim() })}
          />
          <div className="hint">Level and goals, so explanations fit. Empty uses the laptop’s.</div>
        </label>
      </div>

      {summary && (summary.waiting > 0 || summary.exported > 0) && (
        <>
          <h2>Cards to export</h2>
          <div className="group">
            <div className="cell">
              <span className="grow">{summary.waiting ? 'Waiting' : 'All exported'}</span>
              <span className="value jp">{summary.waiting ? `${summary.waiting} · ${summary.words.join('、')}` : ''}</span>
            </div>
            <label className="field">
              <span>File type</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                <option value="apkg">Anki package (.apkg)</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </label>
            <button className="list-item action-row" disabled={busy} onClick={() => exportNow(!summary.waiting)}>
              {busy ? 'Building…' : summary.waiting ? `Export ${summary.waiting} card${summary.waiting === 1 ? '' : 's'}` : 'Export the last batch again'}
            </button>
          </div>
          <p className="footnote">
            {note ?? 'iPhone: share the .apkg to AnkiMobile. Android: open it with AnkiDroid. Importing the same card twice updates it instead of adding a copy.'}
          </p>
        </>
      )}
    </>
  );
}
