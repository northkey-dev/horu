import { useEffect, useRef, useState } from 'react';
import { canSpeak, speak } from '../lib/speak.ts';
import { Icon } from './Icon.tsx';

// A button that reads Japanese text aloud; pressed again while it reads, it stops. Reading stops when it goes away.

export function SpeakButton({ text, label, className = 'ghost small' }: { text: string; label?: string; className?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);
  if (!canSpeak() || !text.trim()) return null;

  function toggle() {
    if (speaking) return stop.current?.();
    setSpeaking(true);
    stop.current = speak(text, () => setSpeaking(false));
  }

  return (
    <button className={className} onClick={toggle} aria-label={speaking ? 'Stop reading' : 'Listen'} aria-pressed={speaking}>
      <Icon name={speaking ? 'stop' : 'speaker'} size={18} weight={2} />
      {label && <span style={{ marginLeft: 6 }}>{speaking ? 'Stop' : label}</span>}
    </button>
  );
}
