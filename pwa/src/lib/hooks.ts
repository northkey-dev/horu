import { useCallback, useEffect, useRef, useState } from 'react';
import { mirroredMedia } from './mirror.ts';

/** Current hash route split into segments, e.g. "#/inbox/abc" -> ["inbox", "abc"]. */
export function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function navigate(path: string): void {
  location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

/** Polls `fn` every `ms` while the page is visible. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []): { data?: T; error?: Error; refresh: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(() => {
    fnRef.current().then(
      (d) => {
        setData(d);
        setError(undefined);
      },
      (e: Error) => setError(e),
    );
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => document.visibilityState === 'visible' && refresh(), ms);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, refresh, ...deps]);

  return { data, error, refresh };
}

/** Keeps the screen on while `active` (re-acquired when the page becomes visible again). */
export function useWakeLock(active: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) return void lock.release();
        setHeld(true);
        lock.addEventListener('release', () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
      setHeld(false);
    };
  }, [active]);
  return held;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Short message at the bottom of the screen (shown by App), e.g. after a card was queued. */
export function flash(message: string): void {
  window.dispatchEvent(new CustomEvent('horu-flash', { detail: message }));
}

/** The phone's copy of a laptop file (inbox audio/screenshot) when it has one, so it also plays offline. */
export function useMedia(url: string): string {
  const [local, setLocal] = useState<string>();
  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    void mirroredMedia(url).then((u) => {
      objectUrl = u;
      if (alive) setLocal(u);
      else if (u) URL.revokeObjectURL(u);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setLocal(undefined);
    };
  }, [url]);
  return local ?? url;
}

/** Re-renders whenever the named window event fires (e.g. "horu-phone" when phone-side data changed). */
export function useEventTick(name: string): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onEvent = () => setTick((n) => n + 1);
    addEventListener(name, onEvent);
    return () => removeEventListener(name, onEvent);
  }, [name]);
}
