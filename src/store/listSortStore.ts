import { create } from "zustand";
import type { WorkItem } from "@/types/models";
import { isListSortMode, sortTopLevel, type ListSortContext, type ListSortMode } from "@/lib/listSort";
import { topLevelItems } from "@/lib/workItemRows";
import { useTeamStore } from "@/store/teamStore";
import { getEffectiveStatuses } from "@/store/backlogStatusesStore";
import { useAppStore } from "@/store/appStore";

/**
 * Which order each backlog's list shows, in this browser only.
 *
 * Kept per backlog — a list of job ads can sit sorted by name while another
 * backlog stays in rank order — and in local storage rather than the database,
 * because a view sort is one person's way of looking, not a change to the list.
 * Rank is what the list is in when nothing has been chosen.
 */
const STORAGE_KEY = "list-sort-v1";

function readStored(): Record<string, ListSortMode> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Anything unrecognised is dropped, so a stale or tampered value falls back
    // to rank rather than to an order the app does not know.
    return Object.fromEntries(Object.entries(parsed).filter(([, mode]) => isListSortMode(mode))) as Record<
      string,
      ListSortMode
    >;
  } catch {
    return {};
  }
}

interface ListSortState {
  modeByBacklog: Record<string, ListSortMode>;
  setMode: (backlogId: string, mode: ListSortMode) => void;
}

export const useListSortStore = create<ListSortState>((set, get) => ({
  modeByBacklog: readStored(),
  setMode: (backlogId, mode) => {
    const next = { ...get().modeByBacklog };
    // Rank is the default, so it is stored as the absence of a choice.
    if (mode === "rank") delete next[backlogId];
    else next[backlogId] = mode;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* The choice still applies for this session. */
    }
    set({ modeByBacklog: next });
  },
}));

export function listSortModeFor(backlogId: string | null | undefined): ListSortMode {
  if (!backlogId) return "rank";
  return useListSortStore.getState().modeByBacklog[backlogId] ?? "rank";
}

export function useListSortMode(backlogId: string | null | undefined): ListSortMode {
  return useListSortStore((s) => (backlogId ? s.modeByBacklog[backlogId] ?? "rank" : "rank"));
}

/** The team and status facts the non-rank sorts read, as they are now. */
export function currentListSortContext(treeId: string): ListSortContext {
  const { teams, workItemTeams } = useTeamStore.getState();
  const teamNames = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const positionsByBacklog = new Map<string, Map<string, number>>();
  return {
    teamsByItem: workItemTeams,
    teamNames,
    statusPosition: (item: WorkItem) => {
      const backlogId = item.backlogAssignments[treeId];
      if (!backlogId) return null;
      let positions = positionsByBacklog.get(backlogId);
      if (!positions) {
        positions = new Map(
          [...getEffectiveStatuses(backlogId)].sort((a, b) => a.rank - b.rank).map((s, i) => [s.key, i]),
        );
        positionsByBacklog.set(backlogId, positions);
      }
      return positions.get(item.status) ?? null;
    },
  };
}

/**
 * Store the order a backlog is currently shown in as its rank.
 *
 * Every top-level item is ranked — snoozed and filtered-out ones too, which are
 * sorted by the same rule — so an item hidden from view is not left holding a
 * rank that collides with the new ones. One undo step.
 */
export function saveTopLevelOrderAsRank(treeId: string, backlogId: string, backlogIds: string[]): void {
  const mode = listSortModeFor(backlogId);
  const app = useAppStore.getState();
  const items = topLevelItems(app.workItems, treeId, new Set(backlogIds));
  const ordered = sortTopLevel(items, mode, treeId, currentListSortContext(treeId));
  app.applySiblingOrder(null, treeId, backlogIds, ordered.map((item) => item.id), `Saved ${ordered.length} items in their shown order as rank`);
}
