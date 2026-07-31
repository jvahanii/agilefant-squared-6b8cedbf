import { useEffect, useRef } from 'react';
import {
  ensureSocketConnected,
  isSocketConnected,
  requestResync,
  FULL_RESYNC_OUTAGE_MS,
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
 * data whenever the tab wakes up after a stale period, comes back online, or
 * when the socket is still closed on a second heartbeat tick.
 *
 * It deliberately does *not* resync on every focus or on the first sign of a
 * closed socket: the socket also reads "closed" during a normal reconnect, and
 * eager refetching there is what made the app feel sluggish.
 */
export function useResyncOnWake() {
  const hiddenSinceRef = useRef<number | null>(
    typeof document !== 'undefined' && document.visibilityState === 'hidden' ? Date.now() : null,
  );
  const wasOfflineRef = useRef(typeof navigator !== 'undefined' && !navigator.onLine);
  const offlineSinceRef = useRef<number | null>(null);
  const socketDownSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const wake = (reason: string, full = false) => {
      ensureSocketConnected();
      requestResync(reason, { full });
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
      const hiddenFor = Date.now() - hiddenSince;
      wake('visible-after-hidden', hiddenFor >= FULL_RESYNC_OUTAGE_MS);
    };

    const onFocus = () => {
      const hiddenSince = hiddenSinceRef.current;
      if (hiddenSince !== null && Date.now() - hiddenSince >= STALE_AFTER_MS) {
        const hiddenFor = Date.now() - hiddenSince;
        hiddenSinceRef.current = null;
        wake('focus-after-hidden', hiddenFor >= FULL_RESYNC_OUTAGE_MS);
        return;
      }
      // A closed socket on focus is usually a reconnect in progress; let the
      // heartbeat decide instead of refetching immediately.
      if (!isSocketConnected()) ensureSocketConnected();
    };

    const onOffline = () => {
      wasOfflineRef.current = true;
      offlineSinceRef.current = Date.now();
    };

    const onOnline = () => {
      wasOfflineRef.current = false;
      const offlineFor = offlineSinceRef.current ? Date.now() - offlineSinceRef.current : 0;
      offlineSinceRef.current = null;
      wake('back-online', offlineFor >= FULL_RESYNC_OUTAGE_MS);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const heartbeat = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!navigator.onLine) return;
      if (isSocketConnected()) {
        socketDownSinceRef.current = null;
        return;
      }
      // First tick: try to reconnect and wait. Only resync if it's still down
      // on a later tick, i.e. the socket really died rather than reconnecting.
      if (socketDownSinceRef.current === null) {
        socketDownSinceRef.current = Date.now();
        ensureSocketConnected();
        return;
      }
      const downFor = Date.now() - socketDownSinceRef.current;
      wake('heartbeat-socket-closed', downFor >= FULL_RESYNC_OUTAGE_MS);
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
