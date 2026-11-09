import type { WorkItem } from "@/types/models";

function sameEntries(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  return aKeys.length === bKeys.length && aKeys.every((k) => b !== undefined && k in b && a![k] === b[k]);
}

/** Whether two versions of an item would be saved as the same rows. */
export function samePersistedWorkItem(a: WorkItem, b: WorkItem): boolean {
  return a.title === b.title && a.description === b.description && a.points === b.points &&
    a.rating === b.rating && a.deadline === b.deadline && a.createdOn === b.createdOn && a.startedOn === b.startedOn && a.endedOn === b.endedOn && a.status === b.status && a.parentId === b.parentId && a.organizationId === b.organizationId &&
    a.respawnEnabled === b.respawnEnabled && a.respawnIntervalDays === b.respawnIntervalDays &&
    a.respawnHour === b.respawnHour && a.respawnMinute === b.respawnMinute &&
    a.respawnLastTriggeredAt === b.respawnLastTriggeredAt &&
    sameEntries(a.parentIds, b.parentIds) && sameEntries(a.backlogAssignments, b.backlogAssignments) &&
    sameEntries(a.ranks, b.ranks) && sameEntries(a.boardRanks, b.boardRanks);
}
