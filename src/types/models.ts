export type WorkItemStatus = 'not_started' | 'in_progress' | 'pending' | 'blocked' | 'done';

export const WORK_ITEM_STATUSES: { value: WorkItemStatus; label: string; color: string }[] = [
  { value: 'not_started', label: 'Not Started', color: 'var(--status-not-started)' },
  { value: 'in_progress', label: 'In Progress', color: 'var(--status-in-progress)' },
  { value: 'pending', label: 'Pending', color: 'var(--status-pending)' },
  { value: 'blocked', label: 'Blocked', color: 'var(--status-blocked)' },
  { value: 'done', label: 'Done', color: 'var(--status-done)' },
];

export interface WorkItem {
  id: string;
  title: string;
  description?: string;
  points?: number;
  /** One to five stars, shared by the whole organization. Absent = unrated,
   *  which is not the same as a rating of zero and sorts last. */
  rating?: number;
  status: WorkItemStatus;
  /** Global parent ID — the default parent used when no per-tree override is present. */
  parentId: string | null;
  /** Per-tree parent overrides (treeId → parentId | null).  When present for a
   *  given tree, this takes precedence over the global `parentId` so that an
   *  item can live under different parents in different backlog trees. */
  parentIds?: Record<string, string | null>;
  childrenIds: string[];
  /** Maps backlogTreeId -> backlogId */
  backlogAssignments: Record<string, string>;
  /** Maps backlogId -> list rank within that backlog */
  ranks: Record<string, number>;
  /** Maps backlogId -> board rank within that backlog (independent from `ranks`).
   *  Board view orders cards by (statusKey, boardRank).  Falls back to `ranks`
   *  for items that have no board rank yet (pre-migration data). */
  boardRanks?: Record<string, number>;
  /** The actual organization_id stored in the DB row. Used for upserts to avoid
   *  deriving org ownership from a potentially stale ID prefix. */
  organizationId?: string;
  respawnEnabled?: boolean;
  respawnIntervalDays?: number;
  /** Hour of the day (0-23) when the respawn copy is created */
  respawnHour?: number;
  /** Minute of the hour (0-59) when the respawn copy is created */
  respawnMinute?: number;
  /** ISO timestamp of the last time this item was respawned */
  respawnLastTriggeredAt?: string;
}

export interface Backlog {
  id: string;
  name: string;
  parentId: string | null;
  childrenIds: string[];
  treeId: string;
  rank: number;
  boardHiddenStatusKeys?: string[];
  viewMode?: 'list' | 'board';
  /** Stars on this backlog's items. Off until switched on, and only consulted
   *  where the organization has ratings on. Unlike the tree-level points
   *  override there is nothing to inherit: a backlog opts in. */
  ratingsEnabled?: boolean;
}

export interface BacklogTree {
  id: string;
  name: string;
  rootBacklogIds: string[];
  rank: number;
  /** Per-tree override for the org-level points setting.
   *  - `undefined` / `null`: inherit from org (default)
   *  - `false`: hide points for this tree even when org points are enabled
   *  - `true`: reserved for future symmetry (currently equivalent to inherit)
   */
  pointsEnabled?: boolean | null;
}

export interface Hyperlink {
  id: string;
  workItemId: string;
  url: string;
  altText: string;
  rank: number;
}

/**
 * Returns the effective parent ID of a work item within the context of a
 * specific backlog tree.  When `wi.parentIds[treeId]` is defined it takes
 * precedence over the global `wi.parentId`, allowing items to live under
 * different parents in different trees.
 *
 * NOTE: a stored value of `null` means "root in this tree" and is distinct
 * from `undefined` (= "no override, fall back to global parentId").
 */
export function getEffectiveParentId(wi: WorkItem, treeId: string): string | null {
  if (wi.parentIds && treeId in wi.parentIds) {
    return wi.parentIds[treeId];
  }
  return wi.parentId;
}
