import { useOrgStore } from "@/store/orgStore";

/**
 * Lightweight event bus for debug persist notifications.
 * Only fires when the active org slug is "agilefant".
 */

export type PersistEventKind = 'workitem' | 'backlogRank' | 'boardRank';

export type PersistEvent = {
  id: string;
  kind: PersistEventKind;
  title: string;
  timestamp: number;
};

type Listener = (e: PersistEvent) => void;
const listeners = new Set<Listener>();

function isAgilefantOrg(): boolean {
  try {
    const m = useOrgStore.getState().getActiveOrg();
    return m?.organization_slug === 'agilefant';
  } catch {
    return false;
  }
}

export function subscribePersistDebug(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyPersistDebug(kind: PersistEventKind, title: string) {
  if (!isAgilefantOrg()) return;
  const event: PersistEvent = {
    id: crypto.randomUUID().slice(0, 8),
    kind,
    title,
    timestamp: Date.now(),
  };
  for (const fn of listeners) fn(event);
}