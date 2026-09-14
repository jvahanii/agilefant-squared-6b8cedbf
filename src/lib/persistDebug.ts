import { useOrgStore } from "@/store/orgStore";
import { isPersistNotificationsEnabled } from "@/store/orgSettingsStore";

/**
 * Lightweight event bus for debug persist notifications.
 * Only fires when the active organization has the Labs
 * "Persist notifications" setting enabled.
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
const MAX_PERSIST_TOAST_TITLE_LENGTH = 120;

function truncatePersistTitle(title: string): string {
  if (title.length <= MAX_PERSIST_TOAST_TITLE_LENGTH) return title;
  return `${title.slice(0, MAX_PERSIST_TOAST_TITLE_LENGTH - 1)}…`;
}

function isEnabled(): boolean {
  try {
    return isPersistNotificationsEnabled(useOrgStore.getState().activeOrgId);
  } catch {
    return false;
  }
}

export function subscribePersistDebug(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyPersistDebug(kind: PersistEventKind, title: string) {
  if (!isEnabled()) return;
  const event: PersistEvent = {
    id: crypto.randomUUID().slice(0, 8),
    kind,
    title: truncatePersistTitle(title),
    timestamp: Date.now(),
  };
  for (const fn of listeners) fn(event);
}