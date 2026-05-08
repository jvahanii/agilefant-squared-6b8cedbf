/**
 * Module-level refs that hold the current visible-item ordering for keyboard
 * navigation.  They are written by the tree panel components and read by the
 * global keyboard handler in AppLayout so that arrow-key navigation always
 * operates on the up-to-date display order without needing reactive wiring.
 */

/** Ordered IDs of every work item currently visible in the work-item panel. */
export const visibleWorkItemIdsRef: { current: string[] } = { current: [] };

/** Ordered IDs of every backlog node currently visible in the backlog panel. */
export const visibleBacklogIdsRef: { current: string[] } = { current: [] };
