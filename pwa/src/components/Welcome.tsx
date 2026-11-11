import { useState } from 'react';
import { navigate } from '../lib/hooks.ts';
import { Sheet } from './Sheet.tsx';

// First start: one question (phone only, or with a laptop) and what to do next. Shown once, never to a phone
// that is already paired with a laptop.

const KEY = 'horu-welcome';

export const showWelcome = (): boolean => {
  try {
    return !localStorage.getItem(KEY);
  } catch {
    return false;
  }
};

const done = () => {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // shown again next time
  }
};

export function Welcome({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'ask' | 'phone'>('ask');
  const close = (to?: string) => {
    done();
    if (to) {
      try {
        localStorage.setItem('horu-settings-tab', to);
      } catch {
        // the tab is just not preselected
      }
      navigate('settings');
    }
    onClose();
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={() => close()} />
      <Sheet onClose={() => close()}>
        {step === 'ask' ? (
          <>
            <h1 style={{ fontSize: 32, margin: '4px 0 10px' }}>Welcome to Horu</h1>
            <p>
              Mark the Japanese lines that catch you while you watch or read, without pausing. Later you pick the word, and Horu makes an Anki card with furigana, audio and a short explanation.
            </p>
            <p className="muted">How do you want to use it?</p>
            <div className="group">
              <button className="list-item" onClick={() => setStep('phone')}>
                <span className="grow">
                  <b>Phone only</b>
                  <span className="hint" style={{ display: 'block' }}>
                    Works at once, offline too. Cards leave as a file for AnkiMobile or AnkiDroid.
                  </span>
                </span>
              </button>
              <button className="list-item" onClick={() => close('laptop')}>
                <span className="grow">
                  <b>With a laptop</b>
                  <span className="hint" style={{ display: 'block' }}>
                    Adds recording from Chrome, Whisper, manga text recognition and your Anki on the laptop. Needs the Horu service running there.
                  </span>
                </span>
              </button>
            </div>
            <button className="small" style={{ marginTop: 12 }} onClick={() => close()}>
              Not now
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 30, margin: '4px 0 10px' }}>Phone only: three steps</h1>
            <ol className="steps">
              <li>
                <b>Subtitles:</b> create a free account on jimaku.cc and paste your key under Settings → Phone → Jimaku API key.
              </li>
              <li>
                <b>Cards:</b> Settings → Phone → Cards on this phone. The default makes a file you open in AnkiMobile (iPhone) or AnkiDroid (Android). For explanations add a free Gemini key, or use “Copy prompt” with any chat app.
              </li>
              <li>
                <b>Start:</b> Watch → pick an episode and start the clock, or Read → Texts to paste text, a photo's text (Live Text / Google Lens) or an EPUB.
              </li>
            </ol>
            <p className="footnote">A laptop can join later at any time (Settings → Laptop). Save a backup file now and then under Settings → Phone → Backup of this phone.</p>
            <button className="primary" onClick={() => close('phone')}>
              Open settings
            </button>
            <button className="small" style={{ marginTop: 12 }} onClick={() => close()}>
              Later
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}
