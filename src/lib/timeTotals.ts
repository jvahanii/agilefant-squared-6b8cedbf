/**
 * Cached time-totals rollups.
 *
 * Long lists in the tree panel used to compute `computeWorkItemTotalMinutes`
 * (an O(subtree)-per-call subtree walk) once per work-item row on every render
 * of every row. With 200 items and a full-map subscription to `timeEntries` /
 * `workItems`, that's O(N²) work per keystroke plus a re-render of every row
 * whenever any time entry / work item mutates.
 *
 * This module builds the rollups once per store snapshot, caches them keyed by
 * store reference identity, and exposes React hooks backed by
 * `useSyncExternalStore` so subscribers only re-render when the *scalar total*
 * for their specific id changes.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useAppStore } from '@/store/appStore';
import { useTimeEntryStore, type TimeEntry } from '@/store/timeEntryStore';
import type { Backlog, WorkItem } from '@/types/models';
import { computeTimeTotals } from './timeTotalsCore';

type TotalsCache = {
  wi: Map<string, number>;
  bl: Map<string, number>; // key = `${treeId}::${backlogId}`
  tree: Map<string, number>;
};

let lastEntries: Record<string, TimeEntry> | null = null;
let lastWorkItems: Record<string, WorkItem> | null = null;
let lastBacklogs: Record<string, Backlog> | null = null;
let cache: TotalsCache | null = null;


function ensureCache(): TotalsCache {
  const entries = useTimeEntryStore.getState().timeEntries;
  const workItems = useAppStore.getState().workItems;
  const backlogs = useAppStore.getState().backlogs;
  if (
    cache &&
    entries === lastEntries &&
    workItems === lastWorkItems &&
    backlogs === lastBacklogs
  ) {
    return cache;
  }
  lastEntries = entries;
  lastWorkItems = workItems;
  lastBacklogs = backlogs;
  cache = computeTimeTotals(entries, workItems, backlogs);
  return cache;
}

function subscribe(cb: () => void): () => void {
  const u1 = useTimeEntryStore.subscribe(cb);
  const u2 = useAppStore.subscribe(cb);
  return () => { u1(); u2(); };
}

/** Total logged minutes for a work item and its entire subtree. Cached. */
export function useWorkItemTotalMinutes(workItemId: string): number {
  const getSnapshot = useCallback(
    () => ensureCache().wi.get(workItemId) ?? 0,
    [workItemId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Total logged minutes for a backlog subtree within a specific tree. Cached. */
export function useBacklogTotalMinutesCached(backlogId: string, treeId: string): number {
  const getSnapshot = useCallback(
    () => ensureCache().bl.get(`${treeId}::${backlogId}`) ?? 0,
    [backlogId, treeId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Total logged minutes for an entire backlog tree. Cached. */
export function useTreeTotalMinutesCached(treeId: string): number {
  const getSnapshot = useCallback(
    () => ensureCache().tree.get(treeId) ?? 0,
    [treeId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
