import { useEffect, useRef } from 'react';
import {
  ensureSocketConnected,
  isSocketConnected,
  requestResync,
} from '@/lib/realtimeHealth';

/** Minimum hidden/offline duration before a wake triggers a catch-up fetch. */
const STALE_AFTER_MS = 20_000;
/** How often (while visible) to verify the realtime socket is still alive. */
const HEARTBEAT_MS = 60_000;

/**
 * Keeps a long-lived session in sync with changes made on other devices.
 *
 * The realtime socket dies silently when a tab is backgrounded, the machine
 * sleeps, or the network drops; nothing then re-delivers the events that were
 * broadcast in the meantime.  This hook reconnects the socket and re-fetches
 * data whenever the tab wakes up, regains focus, comes back online, or when a
 * periodic check finds the socket closed.
 */
export function useResyncOnWake() {
  const hiddenSinceRef = useRef<number | null>(
    typeof document !== 'undefined' && document.visibilityState === 'hidden' ? Date.now() : null,
  );
  const wasOfflineRef = useRef(typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const wake = (reason: string) => {
      ensureSocketConnected();
      requestResync(reason);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        return;
      }
      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      if (hiddenSince === null || Date.now() - hiddenSince < STALE_AFTER_MS) {
        // Short blur — just make sure the socket is still up.
        ensureSocketConnected();
        return;
      }
      wake('visible-after-hidden');
    };

    const onFocus = () => {
      const hiddenSince = hiddenSinceRef.current;
      if (hiddenSince !== null && Date.now() - hiddenSince >= STALE_AFTER_MS) {
        hiddenSinceRef.current = null;
        wake('focus-after-hidden');
        return;
      }
      if (!isSocketConnected()) wake('focus-socket-closed');
    };

    const onOffline = () => {
      wasOfflineRef.current = true;
    };

    const onOnline = () => {
      wasOfflineRef.current = false;
      wake('back-online');
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const heartbeat = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!navigator.onLine) return;
      if (isSocketConnected()) return;
      wake('heartbeat-socket-closed');
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(heartbeat);
    };
  }, []);
}
