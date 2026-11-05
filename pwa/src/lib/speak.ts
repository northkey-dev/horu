// Reading Japanese aloud. First choice is the voice of the phone or browser: instant, free, works without the laptop.
// A device without a Japanese voice (a Windows PC usually has none) or one that stays silent gets the laptop's voice
// instead (Kokoro, the one on the cards). Started from a tap, which iOS requires.

import type { Printed } from '../../../shared/readings.ts';
import { laptopUp } from './api.ts';
import { laptopUrl } from './laptop.ts';

export const canSpeak = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

const isJapanese = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase().startsWith('ja');

/** The best Japanese voice there is: the better ones iOS and Chrome offer are named so. */
function japaneseVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter(isJapanese);
  return voices.find((v) => /enhanced|premium|natural|neural|google/i.test(v.name)) ?? voices[0];
}

/** A tiny silent sound. Played inside the tap, it lets iOS play the laptop's voice a moment later. */
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// Kept in the open: a browser may drop an utterance nobody refers to while it is being read.
let reading: SpeechSynthesisUtterance | undefined;

type Options = {
  /** Furigana the page prints, for the laptop's voice */
  readings?: Printed[];
  /** Ends the reading: with a sentence on what went wrong when nothing could be read */
  done: (problem?: string) => void;
};

/** Reads `text`. Returns what stops it. */
export function speak(text: string, { readings, done }: Options): () => void {
  let over = false;
  let stopNow: () => void = () => undefined;
  const finish = (problem?: string) => {
    if (over) return;
    over = true;
    done(problem);
  };
  const stop = () => {
    stopNow();
    finish();
  };

  const audio = new Audio(SILENCE); // made inside the tap
  void audio.play().catch(() => undefined);

  async function withLaptop(): Promise<void> {
    if (over) return;
    if (!laptopUp()) return finish('No Japanese voice on this device, and the laptop is not reachable. Install a Japanese voice in the device settings.');
    try {
      const res = await fetch(laptopUrl('/api/tts'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, readings }),
        signal: AbortSignal.timeout(30_000),
      });
      if (over) return;
      if (res.status === 404) return finish('No Japanese voice here. Install one in the device settings, or switch on the voice module on the laptop.');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (over) return URL.revokeObjectURL(url);
      stopNow = () => {
        audio.pause();
        URL.revokeObjectURL(url);
      };
      audio.onended = () => {
        URL.revokeObjectURL(url);
        finish();
      };
      audio.src = url;
      await audio.play();
    } catch {
      finish('The voice could not be played. Check that the laptop is reachable.');
    }
  }

  const browserHasNone = canSpeak() && speechSynthesis.getVoices().length > 0 && !japaneseVoice();
  if (!canSpeak() || browserHasNone) {
    void withLaptop();
    return stop;
  }

  // Not cancelled when nothing is being read: some browsers lose a sound started right after a cancel.
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = 0.9;
  const voice = japaneseVoice();
  if (voice) utterance.voice = voice;
  reading = utterance;
  let started = 0;
  // A voice that never starts, or "reads" a sentence in a blink, is a voice that is not there.
  const silent = setTimeout(() => {
    if (started || over) return;
    speechSynthesis.cancel();
    void withLaptop();
  }, 3000);
  utterance.onstart = () => (started = Date.now());
  utterance.onend = () => {
    clearTimeout(silent);
    if (over) return;
    if (started && Date.now() - started < 150 && text.length > 3) return void withLaptop();
    finish();
  };
  utterance.onerror = (e) => {
    clearTimeout(silent);
    if (over || e.error === 'canceled' || e.error === 'interrupted') return;
    void withLaptop();
  };
  stopNow = () => {
    clearTimeout(silent);
    if (reading === utterance) speechSynthesis.cancel();
    audio.pause();
  };
  speechSynthesis.speak(utterance);
  return stop;
}
