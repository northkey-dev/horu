import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { shareFile } from '../lib/cards.ts';
import { AI_ENGINES, DEFAULT_MODELS, ENGINE_LABELS, aiChain, type AiEngine } from '../../../shared/ai.ts';
import type { Settings as S } from '../../../shared/types.ts';

// Settings → AI on the laptop: which AIs write explanations and translations, and in which order. The first is
// asked first; when it fails (down, out of quota, no key) the next one answers.

const KEY_OF = { gemini: 'aiKeyGemini', anthropic: 'aiKeyAnthropic', openai: 'aiKeyOpenai' } as const;
const MODEL_OF = { gemini: 'aiModelGemini', anthropic: 'aiModelAnthropic', openai: 'aiModelOpenai', ollama: 'aiModelOllama' } as const;

export function AiOrder({ s, update }: { s: S; update: (patch: Partial<S>) => void }) {
  const chain = aiChain(s.aiEngine, s.aiFallback);
  const unused = AI_ENGINES.filter((e) => !chain.includes(e));

  const set = (next: AiEngine[]) => update({ aiEngine: next[0] ?? 'claude', aiFallback: next.slice(1).join(',') });
  const move = (i: number, by: -1 | 1) => {
    const next = [...chain];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set(next);
  };
  const text = (label: string, key: keyof S, placeholder = '', hint?: string) => (
    <label className="field stacked">
      <span>{label}</span>
      <input autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={placeholder} value={String(s[key])} onChange={(e) => update({ [key]: e.target.value } as Partial<S>)} />
      {hint && <div className="hint">{hint}</div>}
    </label>
  );

  return (
    <>
      <div className="hint" style={{ padding: '0 16px 8px' }}>
        Explanations on cards and translations come from the first AI below. If it fails or is not set up, the next one answers. Put the one whose answers you like best on top.
      </div>
      {chain.map((engine, i) => (
        <div key={engine} className="ai-engine">
          <div className="cell">
            <span className="grow">
              <b>{i + 1}.</b> {ENGINE_LABELS[engine]}
            </span>
            <button className="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </button>
            <button className="small" disabled={i === chain.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ↓
            </button>
            <button className="small" disabled={chain.length === 1} onClick={() => set(chain.filter((e) => e !== engine))}>
              Remove
            </button>
          </div>
          {engine === 'claude' && text('Claude model', 'claudeModel', 'sonnet', 'sonnet, opus or haiku.')}
          {engine !== 'claude' && engine !== 'ollama' && text('API key', KEY_OF[engine], '', 'Stays on the laptop and is left out of the extra backup copy.')}
          {engine !== 'claude' && text('Model', MODEL_OF[engine], DEFAULT_MODELS[engine], 'Empty uses the default.')}
          {engine === 'ollama' && text('Ollama address', 'ollamaUrl', 'http://127.0.0.1:11434', 'Ollama runs models on this laptop for free (ollama.com).')}
        </div>
      ))}
      {unused.map((engine) => (
        <button key={engine} className="list-item action-row" onClick={() => set([...chain, engine])}>
          Add {ENGINE_LABELS[engine]}
        </button>
      ))}
    </>
  );
}

/** What the laptop's AI log holds, and the way to take it out as training examples. */
export function AiLog({ online }: { online: boolean }) {
  const [stats, setStats] = useState<{ count: number; good: number; bad: number }>();
  const [note, setNote] = useState<string>();
  useEffect(() => {
    if (online) api.aiStats().then(setStats, () => undefined);
  }, [online]);
  if (!stats) return null;

  async function download(rated: boolean) {
    setNote(undefined);
    try {
      const blob = await api.aiExamples(rated);
      await shareFile(new File([blob], `horu-ai-examples${rated ? '-good' : ''}.jsonl`, { type: 'application/x-ndjson' }));
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  return (
    <>
      <div className="cell">
        <span className="grow muted">
          {stats.count} answers kept · {stats.good} marked good · {stats.bad} marked poor
        </span>
      </div>
      <button className="list-item action-row" disabled={!stats.count} onClick={() => download(false)}>
        Download all as training examples
      </button>
      <button className="list-item action-row" disabled={!stats.good} onClick={() => download(true)}>
        Download only the ones marked good
      </button>
      {note && <div className="hint label-bad">{note}</div>}
    </>
  );
}
