// Reading Japanese aloud. First choice is the laptop's voice (the neural voice of Microsoft Edge, else Kokoro): it sounds
// far better than the Japanese voice a phone ships with. It is fetched in advance (`prefetchVoice`, when the sheet with the
// text opens), so a tap plays it at once, which iOS requires of a sound: it starts from a tap, not seconds later.
// Without the laptop (away from home, no voice installed) the voice of the phone or browser reads.

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

/** One second of silence as a WAV file (8 kHz, 8 bit, mono; 128 is silence). */
function silence(): string {
  const rate = 8000;
  const bytes = new Uint8Array(44 + rate).fill(128);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + rate, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, 'data');
  view.setUint32(40, rate, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

// ---- the laptop's voice, fetched in advance

const MAX_KEPT = 40;
const ready = new Map<string, string>(); // text -> object URL of its audio, oldest first
const fetching = new Map<string, Promise<string | undefined>>();
/** After "no voice there" the laptop is not asked again for a while */
let offUntil = 0;

const laptopOk = () => laptopUp() && Date.now() >= offUntil;

function fetchVoice(text: string, readings?: Printed[]): Promise<string | undefined> {
  const known = fetching.get(text);
  if (known) return known;
  const job = (async () => {
    try {
      const res = await fetch(laptopUrl('/api/tts'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, readings, listen: true }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) {
        offUntil = Date.now() + 5 * 60_000;
        return undefined;
      }
      if (!res.ok) return undefined;
      const url = URL.createObjectURL(await res.blob());
      ready.set(text, url);
      if (ready.size > MAX_KEPT) {
        const [oldest] = ready.keys();
        URL.revokeObjectURL(ready.get(oldest)!);
        ready.delete(oldest);
      }
      return url;
    } catch {
      return undefined;
    } finally {
      fetching.delete(text);
    }
  })();
  fetching.set(text, job);
  return job;
}

/** Fetches the voice for `text` in the background, so reading it later starts at once. */
export function prefetchVoice(text: string, readings?: Printed[]): void {
  const t = text.trim();
  if (t && laptopOk() && !ready.has(t)) void fetchVoice(t, readings);
}

// Kept in the open: a browser may drop an utterance nobody refers to while it is being read.
let reading: SpeechSynthesisUtterance | undefined;

const NO_VOICE = 'No Japanese voice on this device, and the laptop is not reachable. Install a Japanese voice in the device settings.';

type Options = {
  /** Furigana the page prints, for the laptop's voice */
  readings?: Printed[];
  /** Ends the reading: with a sentence on what went wrong when nothing could be read */
  done: (problem?: string) => void;
};

/** Reads `text`. Returns what stops it. Call it from a tap. */
export function speak(rawText: string, { readings, done }: Options): () => void {
  const text = rawText.trim();
  let over = false;
  let stopNow: () => void = () => undefined;
  const finish = (problem?: string) => {
    if (over) return;
    over = true;
    audio.pause();
    URL.revokeObjectURL(quiet);
    done(problem);
  };
  const stop = () => {
    stopNow();
    finish();
  };

  // Inside the tap, before anything is waited for, and for the whole reading: a silent sound that plays all the
  // time. iOS then treats the page as one that plays audio, so the silent switch does not mute the voice, and it
  // keeps allowing the laptop's voice to start when it is ready.
  try {
    (navigator as Navigator & { audioSession?: { type: string } }).audioSession!.type = 'playback';
  } catch {
    // older iOS and other browsers do not have it
  }
  const quiet = silence();
  const audio = new Audio(quiet);
  audio.loop = true;
  void audio.play().catch(() => undefined);

  async function viaLaptop(fallback: (why: string) => void): Promise<void> {
    if (over) return;
    try {
      // Prefetched: nothing is awaited, play() is still inside the tap.
      const url = ready.get(text) ?? (await fetchVoice(text, readings));
      if (over) return;
      if (!url) return fallback(offUntil > Date.now() ? 'No voice on the laptop. Switch on the voice module there, or install a Japanese voice on this device.' : 'The laptop did not deliver the voice. Check that it is reachable.');
      stopNow = () => audio.pause();
      audio.onended = () => finish();
      audio.loop = false;
      audio.src = url;
      await audio.play();
    } catch (e) {
      fallback(`The voice could not be played (${(e as Error).name || 'error'}).`);
    }
  }

  const browserHasOne = () => canSpeak() && !(speechSynthesis.getVoices().length > 0 && !japaneseVoice());

  function viaBrowser(fallback: () => void): void {
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
      fallback();
    }, 3000);
    utterance.onstart = () => (started = Date.now());
    utterance.onend = () => {
      clearTimeout(silent);
      if (over) return;
      if (started && Date.now() - started < 150 && text.length > 3) return fallback();
      finish();
    };
    utterance.onerror = (e) => {
      clearTimeout(silent);
      if (over || e.error === 'canceled' || e.error === 'interrupted') return;
      fallback();
    };
    stopNow = () => {
      clearTimeout(silent);
      if (reading === utterance) speechSynthesis.cancel();
      audio.pause();
    };
    speechSynthesis.speak(utterance);
  }

  if (laptopOk()) {
    void viaLaptop((why) => (browserHasOne() ? viaBrowser(() => finish(why)) : finish(why)));
  } else if (browserHasOne()) {
    viaBrowser(() => finish(NO_VOICE));
  } else {
    finish(NO_VOICE);
  }
  return stop;
}
