import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { speak } from '../lib/speak.ts';
import type { Printed } from '../../../shared/readings.ts';
import { Icon } from './Icon.tsx';

// A button that reads Japanese text aloud; pressed again while it reads, it stops. Reading stops when it goes away.
// When nothing can be read, it says why.

export function SpeakButton({ text, readings, label, className = 'ghost small' }: { text: string; readings?: Printed[]; label?: string; className?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [problem, setProblem] = useState<string>();
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);
  useEffect(() => {
    if (!problem) return;
    const t = setTimeout(() => setProblem(undefined), 5000);
    return () => clearTimeout(t);
  }, [problem]);
  if (!text.trim()) return null;

  function toggle() {
    if (speaking) return stop.current?.();
    setProblem(undefined);
    setSpeaking(true);
    stop.current = speak(text, {
      readings,
      done: (why) => {
        setSpeaking(false);
        if (why) setProblem(why);
      },
    });
  }

  return (
    <>
      <button className={className} onClick={toggle} aria-label={speaking ? 'Stop reading' : 'Listen'} aria-pressed={speaking}>
        <Icon name={speaking ? 'stop' : 'speaker'} size={18} weight={2} />
        {label && <span style={{ marginLeft: 6 }}>{speaking ? 'Stop' : label}</span>}
      </button>
      {problem && createPortal(<div className="toast top" role="alert">{problem}</div>, document.body)}
    </>
  );
}
