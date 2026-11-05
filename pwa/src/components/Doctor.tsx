import { useState } from 'react';
import { api } from '../lib/api.ts';

// Settings → Check everything: runs the laptop's checks and lists each part with what to do about it.

type Result = Awaited<ReturnType<typeof api.doctor>>;
const MARK = { ok: '✓', warn: '!', bad: '✕' } as const;
const CLASS = { ok: 'label-ok', warn: 'label-warn', bad: 'label-bad' } as const;

export function Doctor({ online }: { online: boolean }) {
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api.doctor());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const problems = result?.filter((c) => c.state !== 'ok').length ?? 0;
  return (
    <>
      <div className="group">
        <button className="list-item action-row" disabled={!online || busy} onClick={run}>
          {busy ? 'Checking…' : 'Check everything'}
        </button>
        {error && <div className="hint label-bad">{error}</div>}
        {result?.map((c) => (
          <div key={c.name} className="cell" style={{ alignItems: 'flex-start', gap: 10 }}>
            <span className={CLASS[c.state]} style={{ width: 16, textAlign: 'center', fontWeight: 700 }}>
              {MARK[c.state]}
            </span>
            <span className="grow">
              <b>{c.name}</b>
              <span className="muted small" style={{ display: 'block' }}>
                {c.detail}
              </span>
              {c.fix && (
                <span className="small" style={{ display: 'block' }}>
                  {c.fix}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {result && <p className="footnote">{problems ? `${problems} thing${problems === 1 ? '' : 's'} to look at.` : 'Everything is in order.'}</p>}
    </>
  );
}
