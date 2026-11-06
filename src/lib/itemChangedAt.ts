import type { WorkItem } from "@/types/models";

/**
 * When each item last changed, by the database's clock: for the search to put
 * recently changed items first among equally good matches.
 *
 * A load gives each item the time it was read with (WorkItem.changedAt). Live
 * updates bring newer times — but the echo of this page's own save is not
 * applied to the item when it changes nothing on screen, which keeps a move of
 * a hundred items from re-rendering a hundred times. So every live update's
 * time is noted here instead, where nothing re-renders for it.
 */
const latest = new Map<string, number>();

/** Note an item's change time from a live update; times arrive in either of Postgres's formats. */
export function noteItemChanged(itemId: string, changedAt: unknown): void {
  if (typeof changedAt !== "string") return;
  const at = Date.parse(changedAt.includes("T") ? changedAt : changedAt.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  if (Number.isNaN(at)) return;
  if (at > (latest.get(itemId) ?? 0)) latest.set(itemId, at);
}

/** The item's last change, in milliseconds, or undefined where none is known. */
export function itemChangedAt(item: Pick<WorkItem, "id" | "changedAt">): number | undefined {
  const loaded = item.changedAt ? Date.parse(item.changedAt) : NaN;
  const live = latest.get(item.id);
  if (Number.isNaN(loaded)) return live;
  return live !== undefined && live > loaded ? live : loaded;
}

/** For tests. */
export function forgetItemChanges(): void {
  latest.clear();
}
