/**
 * How a backlog's list orders its top-level items.
 *
 * Rank is the order stored for everyone. Every other mode is a view: it
 * rearranges what this browser shows and writes nothing, until someone chooses
 * to save the order as rank. Only the top level is ever resorted — children
 * always keep their rank order.
 *
 * Every mode falls back on rank, then id, so items that tie keep the order they
 * already had, and the result is the same on every render.
 */
import type { WorkItem } from "@/types/models";
import { byRank } from "@/lib/workItemRows";

export type ListSortMode = "rank" | "name-asc" | "name-desc" | "status" | "team";

export const LIST_SORT_MODES: { mode: ListSortMode; label: string }[] = [
  { mode: "rank", label: "Rank" },
  { mode: "name-asc", label: "Name A→Z" },
  { mode: "name-desc", label: "Name Z→A" },
  { mode: "status", label: "Status" },
  { mode: "team", label: "Team A→Z" },
];

export function isListSortMode(value: unknown): value is ListSortMode {
  return LIST_SORT_MODES.some((m) => m.mode === value);
}

export function listSortLabel(mode: ListSortMode): string {
  return LIST_SORT_MODES.find((m) => m.mode === mode)?.label ?? "Rank";
}

/** What the non-rank modes need to know beyond the items themselves. */
export interface ListSortContext {
  /** Team ids per work item. */
  teamsByItem: Record<string, string[]>;
  /** Team name per team id. */
  teamNames: Record<string, string>;
  /**
   * An item's status position in its own backlog's status list, or null when
   * the status is not in that list.
   */
  statusPosition: (item: WorkItem) => number | null;
}

// Natural order, so "Item 2" comes before "Item 10", and case is ignored.
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The alphabetically first team name on an item, or null for none. */
function firstTeamName(item: WorkItem, ctx: ListSortContext): string | null {
  const names = (ctx.teamsByItem[item.id] ?? [])
    .map((id) => ctx.teamNames[id])
    .filter((name): name is string => !!name);
  if (names.length === 0) return null;
  return names.sort(collator.compare)[0];
}

/** Put nulls last, compare the rest with `compare`. */
function nullsLast<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
}

/** The top-level items in the order the mode puts them. Returns a new array. */
export function sortTopLevel(
  items: readonly WorkItem[],
  mode: ListSortMode,
  treeId: string,
  ctx: ListSortContext,
): WorkItem[] {
  const rank = byRank(treeId);
  const primary = ((): ((a: WorkItem, b: WorkItem) => number) => {
    switch (mode) {
      case "name-asc":
        return (a, b) => collator.compare(a.title ?? "", b.title ?? "");
      case "name-desc":
        return (a, b) => collator.compare(b.title ?? "", a.title ?? "");
      case "status": {
        const positions = new Map(items.map((item) => [item.id, ctx.statusPosition(item)]));
        return (a, b) => nullsLast(positions.get(a.id) ?? null, positions.get(b.id) ?? null, (x, y) => x - y);
      }
      case "team": {
        const names = new Map(items.map((item) => [item.id, firstTeamName(item, ctx)]));
        return (a, b) => nullsLast(names.get(a.id) ?? null, names.get(b.id) ?? null, collator.compare);
      }
      default:
        return () => 0;
    }
  })();
  return [...items].sort((a, b) => primary(a, b) || rank(a, b));
}
