/**
 * Every backlog's points, worked out once per change to the items or the
 * backlogs and shared by the tree panel's rows — as lib/timeTotals does for
 * logged time.
 *
 * Each row used to work out its own backlog's points over every item, and to
 * subscribe to the whole map of items to do it: after any change, every row in
 * the panel redrew and made its own pass over all of them. With 52 lists and
 * 5 000 items that held up every move out of a long list.
 *
 * A row now reads its own breakdown, which keeps its identity while its values
 * stay the same, so it redraws only when its own points change.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useAppStore } from "@/store/appStore";
import type { Backlog, WorkItem } from "@/types/models";
import { allBacklogPoints, type BacklogPoints } from "./backlogPoints";
import { itemFieldsChanged } from "./itemFieldsChanged";

let lastItems: Record<string, WorkItem> | null = null;
let lastBacklogs: Record<string, Backlog> | null = null;
let cache = new Map<string, BacklogPoints>();

const same = (a: BacklogPoints, b: BacklogPoints) =>
  a.own === b.own && a.itemsTotal === b.itemsTotal && a.contents === b.contents && a.effective === b.effective;

/** All that an item's points depend on. */
const POINTS_FIELDS = ["points", "parentId", "parentIds", "childrenIds", "backlogAssignments"] as const;

function ensureCache(): Map<string, BacklogPoints> {
  const { workItems, backlogs } = useAppStore.getState();
  if (backlogs === lastBacklogs && lastItems && !itemFieldsChanged(lastItems, workItems, POINTS_FIELDS)) {
    lastItems = workItems;
    return cache;
  }
  const next = allBacklogPoints(workItems, backlogs);
  // Unchanged values keep the object a row already has, so it does not redraw.
  for (const [id, points] of next) {
    const before = cache.get(id);
    if (before && same(before, points)) next.set(id, before);
  }
  lastItems = workItems;
  lastBacklogs = backlogs;
  cache = next;
  return cache;
}

const NONE: BacklogPoints = { own: undefined, itemsTotal: 0, contents: 0, effective: 0 };

/** A backlog's points, in its own tree, as backlogPoints gives them. */
export function useBacklogPointsCached(backlogId: string): BacklogPoints {
  const getSnapshot = useCallback(() => ensureCache().get(backlogId) ?? NONE, [backlogId]);
  return useSyncExternalStore(useAppStore.subscribe, getSnapshot, getSnapshot);
}
