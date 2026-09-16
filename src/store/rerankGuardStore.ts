import { create } from "zustand";
import { useAppStore } from "@/store/appStore";
import { listSortModeFor, saveTopLevelOrderAsRank, useListSortStore } from "@/store/listSortStore";

/**
 * Asking before a top-level move while the list is sorted by something other
 * than rank.
 *
 * In a list sorted by name, a top-level item's position on screen is not its
 * rank. Moving it can only mean something if the order on screen becomes the
 * rank first — so the move asks whether to do exactly that, and on yes saves the
 * shown order, makes the move, and switches the list back to rank, where the item
 * then sits where it was put. Staying sorted by name would snap it straight back.
 *
 * Children are never asked about: a sort only reorders the top level, so their
 * order on screen already is their rank.
 *
 * Kept in a store rather than a component because the moves come from several
 * places — drag and drop, keyboard shortcuts, a context menu — and all of them
 * need the same question.
 */
export interface TopLevelRerankRequest {
  treeId: string;
  /** The backlog in view; its sort choice is the one that applies. */
  backlogId: string;
  /** That backlog and every backlog beneath it. */
  backlogIds: string[];
  /** Whether this move changes the order of the top-level items. */
  touchesTopLevel: boolean;
  /** The move itself. Runs after the shown order has been saved, if it had to be. */
  proceed: () => void;
}

interface RerankGuardState {
  pending: Omit<TopLevelRerankRequest, "touchesTopLevel"> | null;
  confirm: () => void;
  cancel: () => void;
}

export const useRerankGuardStore = create<RerankGuardState>((set, get) => ({
  pending: null,

  confirm: () => {
    const request = get().pending;
    set({ pending: null });
    if (!request) return;
    // One undo step for both: undoing the move alone would leave the ranks
    // rewritten to an order nobody chose to keep.
    useAppStore.getState().runBulk(() => {
      saveTopLevelOrderAsRank(request.treeId, request.backlogId, request.backlogIds);
      request.proceed();
    });
    useListSortStore.getState().setMode(request.backlogId, "rank");
  },

  cancel: () => set({ pending: null }),
}));

/** Run a move now, or ask first if it re-ranks a list sorted by something else. */
export function requestTopLevelRerank(request: TopLevelRerankRequest): void {
  const { touchesTopLevel, ...rest } = request;
  const viewMode = useAppStore.getState().backlogs[request.backlogId]?.viewMode ?? "list";
  // The sort is a list-view order. On a board, or in rank order, or for a move
  // among children, there is nothing on screen that the move could contradict.
  if (!touchesTopLevel || viewMode === "board" || listSortModeFor(request.backlogId) === "rank") {
    request.proceed();
    return;
  }
  useRerankGuardStore.setState({ pending: rest });
}
