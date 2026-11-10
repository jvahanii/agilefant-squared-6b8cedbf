import type { WorkItem } from "@/types/models";

/**
 * Whether going from one map of items to the next changed any of the given
 * fields of any item, or which items there are.
 *
 * What is worked out over every item — logged time, points, money, Jira types
 * — depends on a few fields only, and most edits touch none of them: a name, a
 * status, a rating, a deadline. Working those out again over 5 000 items took
 * tens of milliseconds on every edit and on every change arriving from
 * elsewhere; checking that nothing they read has changed takes a fraction of
 * one. Only the items that are new objects are compared, field by field.
 *
 * Fields are compared by value one level down — a record's entries, an array's
 * elements — so an item rebuilt with the same contents counts as unchanged.
 */
export function itemFieldsChanged(
  before: Record<string, WorkItem>,
  after: Record<string, WorkItem>,
  fields: readonly (keyof WorkItem)[],
): boolean {
  if (before === after) return false;
  const changed = replacedItems(before, after);
  if (changed === null) return true;
  for (const id of changed) {
    const a = after[id];
    const b = before[id];
    for (const field of fields) if (!sameValue(a[field], b[field])) return true;
  }
  return false;
}

/**
 * The ids of the items that are other objects in `after` than in `before`, or
 * null when the two do not hold the same ids. Going over every id is most of
 * the cost, and every cache asks about the same change, one after the other:
 * the last answer is kept for the next to ask.
 */
let lastAnswer: { before: Record<string, WorkItem>; after: Record<string, WorkItem>; changed: string[] | null } | null = null;

function replacedItems(before: Record<string, WorkItem>, after: Record<string, WorkItem>): string[] | null {
  if (lastAnswer && lastAnswer.before === before && lastAnswer.after === after) return lastAnswer.changed;
  const ids = Object.keys(after);
  let changed: string[] | null = [];
  // As many items as before, every one of them there before: none removed either.
  if (ids.length !== Object.keys(before).length) changed = null;
  else {
    for (const id of ids) {
      const a = after[id];
      const b = before[id];
      if (a === b) continue;
      if (!b) {
        changed = null;
        break;
      }
      changed.push(id);
    }
  }
  lastAnswer = { before, after, changed };
  return changed;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => x === b[i]);
  }
  // Absent and an empty record mean the same: no entries.
  if (isRecord(a) || isRecord(b)) {
    const ra = (a ?? {}) as Record<string, unknown>;
    const rb = (b ?? {}) as Record<string, unknown>;
    if (!isRecord(ra) || !isRecord(rb)) return false;
    const keys = Object.keys(ra);
    if (keys.length !== Object.keys(rb).length) return false;
    return keys.every((key) => key in rb && ra[key] === rb[key]);
  }
  return false;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
