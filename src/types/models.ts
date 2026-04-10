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
  status: WorkItemStatus;
  parentId: string | null;
  childrenIds: string[];
  /** Maps backlogTreeId -> backlogId */
  backlogAssignments: Record<string, string>;
  rank: number;
  /** The actual organization_id stored in the DB row. Used for upserts to avoid
   *  deriving org ownership from a potentially stale ID prefix. */
  organizationId?: string;
  respawnEnabled?: boolean;
  respawnIntervalDays?: number;
  /** Hour of the day (0-23) when the respawn copy is created */
  respawnHour?: number;
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
}

export interface BacklogTree {
  id: string;
  name: string;
  rootBacklogIds: string[];
  rank: number;
}

export interface Hyperlink {
  id: string;
  workItemId: string;
  url: string;
  altText: string;
  rank: number;
}
