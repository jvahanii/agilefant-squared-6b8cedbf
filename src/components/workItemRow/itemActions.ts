/**
 * What every place an item is shown — its row in the list, its card on the
 * board, its line in the search results — needs for the item's menu: which
 * features are switched on for it, and the actions that are the same wherever
 * it is. Each place adds what only it can do (rename in place, rank on the
 * board…) and hands both to ItemMenu and ItemDialogs.
 */
import { useAppStore } from "@/store/appStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { useOrgSettingsStore, useScramblingEnabled } from "@/store/orgSettingsStore";
import { useOrgStore } from "@/store/orgStore";
import { requestTopLevelRerank } from "@/store/rerankGuardStore";
import { useDeleteWithTimeGuard } from "@/hooks/useDeleteWithTimeGuard";
import { toast } from "@/hooks/use-toast";
import { usePointsVisibleForTree } from "@/lib/pointsVisibility";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { useDeadlinesEnabled } from "@/lib/workItemDeadline";
import { useCreatedDatesEnabled } from "@/lib/workItemCreated";
import { useStartEndDatesEnabled } from "@/lib/workItemStartEnd";
import { getEffectiveParentId, type WorkItem } from "@/types/models";
import { listAndSublists, type ActOn } from "./rowShared";
import { startScramble } from "./scrambleActions";
import type { RowDialogs } from "./useRowDialogs";

/** What the organization and the item's own list have switched on. */
export interface ItemFeatures {
  deadlines: boolean;
  /** The organization's switch and the item's list's, both. */
  createdDates: boolean;
  /** Offered in the menu where the organization uses them; shown on the item per startEndShown. */
  startEndDates: boolean;
  burnups: boolean;
  points: boolean;
  labels: boolean;
  timeLogging: boolean;
  scrambling: boolean;
  savingsIncome: boolean;
  /** The list can be shown as a board. */
  boards: boolean;
  /** Stars, and the start-to-end span, shown on the item: the organization's switch and its list's. */
  ratingsShown: boolean;
  startEndShown: boolean;
}

export function useItemFeatures(item: WorkItem | undefined, treeId: string): ItemFeatures {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const settings = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]);
  const points = usePointsVisibleForTree(treeId);
  const orgRatings = useRatingsEnabled();
  const deadlines = useDeadlinesEnabled();
  const orgCreatedDates = useCreatedDatesEnabled();
  const startEndDates = useStartEndDatesEnabled();
  const scrambling = useScramblingEnabled();
  // The list the item is in, in this tree, decides too, and starts off.
  const listId = item?.backlogAssignments?.[treeId];
  const listRatings = useAppStore((s) => (listId ? s.backlogs[listId]?.ratingsEnabled ?? false : false));
  const listCreatedDates = useAppStore((s) => (listId ? s.backlogs[listId]?.createdDatesEnabled ?? false : false));
  const listStartEnd = useAppStore((s) => (listId ? s.backlogs[listId]?.startEndDatesEnabled ?? false : false));
  return {
    deadlines,
    createdDates: orgCreatedDates && listCreatedDates,
    startEndDates,
    burnups: (settings as { burnupsEnabled?: boolean } | undefined)?.burnupsEnabled ?? false,
    points,
    labels: settings?.labelsEnabled ?? false,
    timeLogging: settings?.timeLoggingEnabled ?? false,
    scrambling,
    savingsIncome: settings?.savingsIncomeEnabled ?? false,
    boards: settings?.boardsEnabled ?? false,
    ratingsShown: orgRatings && listRatings,
    startEndShown: startEndDates && listStartEnd,
  };
}

/** The actions that are the same wherever the item is shown. */
export function useCommonItemActions({
  workItemId,
  actOn,
  dialogs,
  activeOrgId,
}: {
  workItemId: string;
  actOn: ActOn;
  dialogs: RowDialogs;
  activeOrgId: string | null;
}) {
  const guardedDeleteBulk = useDeleteWithTimeGuard();
  const { show } = dialogs;
  return {
    duplicate: () => {
      const newRootIds = useAppStore.getState().duplicateWorkItems([...actOn()]);
      // When a single item was duplicated, open its name for renaming.
      if (newRootIds.length === 1) {
        const newId = newRootIds[0];
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("shortcut:edit-title", { detail: { workItemId: newId } }));
        }, 50);
      }
    },
    remove: () => {
      const state = useAppStore.getState();
      if (!state.workItems[workItemId]) return;
      const ids = [...actOn()];
      // An item in several lists may be meant to go from this one only: ask.
      if (ids.some((id) => Object.keys(state.workItems[id]?.backlogAssignments ?? {}).length > 1)) {
        show("deleteChoice", ids);
        return;
      }
      const targets = ids.map((id) => ({ kind: "work_item" as const, id }));
      const label = ids.length === 1 ? (state.workItems[ids[0]]?.title ?? "this item") : `${ids.length} items`;
      guardedDeleteBulk(targets, label, () => state.deleteWorkItemsBulk(ids));
    },
    openMoveToList: () => show("moveToBacklog", actOn()),
    openReparent: () => show("moveToParent", actOn()),
    scramble: () => void startScramble(actOn(), activeOrgId, () => show("scramble", { kind: "scramble", mode: "set" })),
    snoozeUntil: async (until: Date) => {
      if (!activeOrgId) return;
      const { snoozeWorkItem } = useSnoozeStore.getState();
      try {
        await Promise.all(actOn().map((id) => snoozeWorkItem({ workItemId: id, organizationId: activeOrgId, snoozedUntil: until })));
      } catch (err) {
        console.error("Failed to snooze one or more items", err);
      }
    },
  };
}

/**
 * Rank the item first among its siblings in its list — asking first where
 * the list in view is sorted by something other than rank.
 */
export function rankToTopOfList(item: WorkItem, treeId: string, backlogId: string): void {
  const state = useAppStore.getState();
  const backlogIds = listAndSublists(backlogId);
  const viewedBacklogId = state.selectedBacklogIds[0] ?? backlogId;
  const inView = new Set(backlogIds);
  const parentId = getEffectiveParentId(item, treeId);
  requestTopLevelRerank({
    treeId,
    backlogId: viewedBacklogId,
    backlogIds,
    touchesTopLevel: parentId === null || !inView.has(state.workItems[parentId]?.backlogAssignments[treeId]),
    proceed: () => {
      useAppStore.getState().reorderWorkItemAmongSiblings(item.id, 0, treeId, backlogIds);
      toast({ title: "Moved item to top", description: item.title });
    },
  });
}
