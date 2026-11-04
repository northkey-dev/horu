import { useState } from 'react';
import { useEventTick } from '../lib/hooks.ts';
import { localMoments, phoneJimakuKey, quickContinue, setPhoneJimakuKey, setQuickContinue } from '../lib/phone.ts';

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
        {waiting > 0 && (
          <div className="cell">
            <span className="grow">Marks waiting for the laptop</span>
            <span className="value">{waiting}</span>
          </div>
        )}
      </div>
      <p className="footnote">Used when the episode runs on a TV or the laptop is off: the phone loads subtitles itself and keeps your marks until the laptop is back.</p>
    </>
  );
}
