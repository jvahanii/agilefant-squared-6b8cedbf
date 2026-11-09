/**
 * The app store's state and actions (useAppStore), and the part of it that
 * undo keeps. The actions are written in appStore.ts and, group by group, in
 * the slices beside this file.
 */
import type { StoreApi } from "zustand";
import type { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink } from "@/types/models";
import type { ChangeLogEntry } from "../changeLog";

export interface DataSnapshot {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  /** Maps workItemId -> ordered list of hyperlinks */
  hyperlinks: Record<string, Hyperlink[]>;
  selectedBacklogIds: string[];
  selectedTreeId: string | null;
  selectedWorkItemIds: string[];
  changeLog: ChangeLogEntry[];
  expandedWorkItems: Set<string>;
  expandedBacklogs: Set<string>;
}

export interface AppState extends DataSnapshot {
  undoStack: DataSnapshot[];
  redoStack: DataSnapshot[];
  isLoading: boolean;
  // True while the shell is already painted from trees + backlogs but the
  // work items are still in flight. Lets panels show a loading state instead
  // of an "empty backlog" message they would otherwise render.
  workItemsLoading: boolean;
  /**
   * A cached snapshot is on screen and the real data is still being fetched.
   * The cache can be older than the org (or missing a backlog's items), so a
   * list that looks empty may simply not have arrived yet — panels say
   * "loading" rather than "no items" while this is true.
   */
  workItemsRefreshing: boolean;
  /** The screen shows a copy kept from an earlier visit, old enough that it
   *  must not be edited, and the fresh data is on its way. Nothing can be
   *  changed until it lands (CatchingUpGuard) — or until a while has passed,
   *  so that being offline does not lock the app. */
  catchingUp: boolean;
  loadingProgress: number;
  organizationId: string | null;
  userId: string | null;
  userEmail: string | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  setOrganizationId: (orgId: string) => void;
  setUser: (userId: string, userEmail: string) => void;
  loadFromSupabase: () => Promise<void>;
  logChange: (entry: Omit<ChangeLogEntry, "timestamp" | "id" | "userEmail">) => void;
  clearChangeLog: () => void;
  selectTree: (treeId: string) => void;
  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  /** Select a range at once — a shift-click's — in order, added to the selection or in place of it. */
  selectWorkItemRange: (ids: string[], add: boolean) => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  expandWorkItemsRecursive: (workItemId: string) => void;
  collapseWorkItemsRecursive: (workItemId: string) => void;
  expandBacklogsRecursive: (backlogId: string) => void;
  collapseBacklogsRecursive: (backlogId: string) => void;
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  reorderWorkItemInBoard: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[], statusKey?: string) => void;
  sortChildrenAlphabetically: (parentId: string | null, treeId: string, backlogIds: string[]) => void;
  /**
   * Rank a group of siblings in exactly the given order: list ranks 0..n, board
   * ranks kept consistent within each status, persisted, and one undo step.
   */
  applySiblingOrder: (
    parentId: string | null,
    treeId: string,
    backlogIds: string[],
    orderedIds: string[],
    logDetails: string,
  ) => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, targetTreeId: string, strategy?: "move" | "mirror", sourceTreeId?: string) => void;
  /** Batched multi-item variant of `moveWorkItemToBacklog` — a single state
   *  update, a single DB batch and a single undo entry, and it leaves the
   *  source backlogs' remaining ranks untouched (no re-densification). */
  moveWorkItemsToBacklog: (workItemIds: string[], targetBacklogId: string, targetTreeId: string, strategy?: "move" | "mirror", sourceTreeId?: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string, rank?: number, initialStatus?: WorkItemStatus, boardRank?: number) => void;
  bulkAddWorkItems: (titles: string[], parentId: string | null, backlogId: string, treeId: string, initialStatus?: WorkItemStatus) => void;
  deleteWorkItem: (workItemId: string, direction?: 'up' | 'down') => void;
  deleteWorkItemsBulk: (workItemIds: string[], direction?: 'up' | 'down') => void;
  /** Duplicate work items (deep — includes descendants). Each new root is
   *  inserted directly below its source, lives in the same backlogs/parents,
   *  and inherits hyperlinks. Labels, team assignments, financials, and
   *  respawn settings are copied asynchronously via their respective stores.
   *  Returns the new root IDs. The new roots become the selection. */
  duplicateWorkItems: (workItemIds: string[]) => string[];
  renameWorkItem: (workItemId: string, title: string) => void;
  setWorkItemDescription: (workItemId: string, description: string) => void;
  setWorkItemStatus: (workItemId: string, status: WorkItemStatus) => void;
  setWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  /** One to five stars, or undefined to take the rating away. */
  setWorkItemRating: (workItemId: string, rating: number | undefined) => void;
  /** A yyyy-mm-dd deadline, or undefined to take it away. */
  setWorkItemDeadline: (workItemId: string, deadline: string | undefined) => void;
  /** Correct the day an item was made, as yyyy-mm-dd. It can be changed but
   *  not taken away: anything that is not a real date is ignored. */
  setWorkItemCreatedOn: (workItemId: string, createdOn: string) => void;
  /**
   * Set, change or remove the days work on an item started and ended. Each of
   * the two: a yyyy-mm-dd to set it, null to remove it, left out to leave it
   * as it is. Anything that is not a real date removes it, as an emptied field
   * means.
   */
  setWorkItemStartEnd: (workItemId: string, dates: { startedOn?: string | null; endedOn?: string | null }) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  removeWorkItemsFromTreeBulk: (items: Array<{ workItemId: string; treeId: string }>) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId?: string, backlogId?: string, strategy?: "move-to-tree" | "mirror", rank?: number) => void;
  setWorkItemRespawn: (workItemId: string, respawnEnabled: boolean, respawnIntervalDays?: number, respawnHour?: number, respawnMinute?: number) => void;
  respawnItem: (workItemId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string, direction?: 'up' | 'down') => void;
  renameBacklog: (backlogId: string, name: string) => void;
  setBacklogHiddenStatusKeys: (backlogId: string, keys: string[]) => void;
  setBacklogViewMode: (backlogId: string, mode: 'list' | 'board' | 'timeline') => void;
  /** Show stars on this backlog's items, where the organization has ratings on. */
  setBacklogRatingsEnabled: (backlogId: string, enabled: boolean) => void;
  /** Show created dates on this backlog's items, where the organization has them on. */
  setBacklogCreatedDatesEnabled: (backlogId: string, enabled: boolean) => void;
  /** Show start and end dates on this backlog's rows, where the organization has them on. */
  setBacklogStartEndDatesEnabled: (backlogId: string, enabled: boolean) => void;
  /** A backlog's own estimate: a whole number of zero or more, or undefined to take it away. */
  setBacklogPoints: (backlogId: string, points: number | undefined) => void;
  reorderBacklogAmongSiblings: (
    backlogId: string,
    targetIndex: number,
    targetParentId?: string | null,
    treeId?: string,
  ) => void;
  moveBacklog: (backlogId: string, targetParentId: string | null, treeId: string) => void;
  addBacklogTree: (name: string) => void;
  deleteBacklogTree: (treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  setTreePointsEnabled: (treeId: string, enabled: boolean | null) => void;
  reorderBacklogTree: (treeId: string, targetIndex: number) => void;
  resetToMockData: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  /** Coalesce many mutations into a single undo entry. */
  runBulk: (fn: () => void) => void;
  addHyperlink: (workItemId: string, url: string, altText: string) => void;
  updateHyperlink: (linkId: string, workItemId: string, url: string, altText: string) => void;
  removeHyperlink: (linkId: string, workItemId: string) => void;
  loadHyperlinksForItem: (workItemId: string) => Promise<void>;
  applyRealtimeWorkItem: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeWorkItemRank: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeWorkItemBoardRank: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklog: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklogTree: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeHyperlink: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

/** The store's set and get, as a slice of actions is given them. */
export type SetState = StoreApi<AppState>["setState"];
export type GetState = StoreApi<AppState>["getState"];
