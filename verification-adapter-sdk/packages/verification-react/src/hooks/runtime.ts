import { useCallback, useEffect, useState } from 'react';
import { isBrowserOnline, subscribeOnlineStatus } from '@splitin/verification-web';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(isBrowserOnline);
  useEffect(() => subscribeOnlineStatus(setOnline), []);
  return online;
}

export function useFocusRecovery(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { previous?.focus(); };
  }, [active]);
}

export function useBusy<T extends string>(): [T | null, (key: T, task: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState<T | null>(null);
  const run = useCallback(async (key: T, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await task(); } finally { setBusy(null); }
  }, [busy]);
  return [busy, run];
}
