// Reading Japanese aloud with the voice of the phone (or the browser): instant, free, works without the laptop.
// Started from a tap, which iOS requires.

export const canSpeak = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

const isJapanese = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase().startsWith('ja');

/** The best Japanese voice there is: the better ones iOS and Chrome offer are named so. */
function japaneseVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter(isJapanese);
  return voices.find((v) => /enhanced|premium|natural|neural|google/i.test(v.name)) ?? voices[0];
}

/** Reads `text`; `done` is called when it ends, is stopped or cannot be read. Returns what stops it. */
export function speak(text: string, done?: () => void): () => void {
  if (!canSpeak()) {
    done?.();
    return () => undefined;
  }
  speechSynthesis.cancel(); // whatever was being read
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = 0.9;
  const voice = japaneseVoice();
  if (voice) utterance.voice = voice;
  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    done?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  speechSynthesis.speak(utterance);
  return () => {
    if (ended) return;
    speechSynthesis.cancel();
    finish();
  };
}
