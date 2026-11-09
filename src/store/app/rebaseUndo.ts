/**
 * Changes from elsewhere, carried into the copies undo and redo go back to.
 *
 * An undo entry is a copy of the data from before an edit made here. Changes
 * arriving from elsewhere afterwards — another person, another tab, an import —
 * are not in it, so going back to it took them back too, and saved that: an
 * item added in another tab pushed the items below it down a place, and an
 * undo here put them back on top of it.
 *
 * So each change that arrives is made in the copies as well, item by item:
 *
 * - An item, list, tree or item's links that this page has not changed since
 *   the copy was taken (the copy still holds the very object the page held) is
 *   replaced by the new version, or added, or removed, as it was here.
 * - One that this page has changed since takes, in the copy, the fields changed
 *   elsewhere, and keeps the others — so undo takes back only what was done
 *   here. A field changed both here and, later, elsewhere has the later value:
 *   undo does not take back someone else's change in taking back its own.
 * - One deleted elsewhere is gone from the copies: undo does not bring back
 *   what someone else deleted.
 *
 * The copies are changed in place. The stacks own them: each entry is made by
 * snapshot(), which copies the maps, and an entry taken off a stack is not put
 * back on one.
 */
import type { AppState } from "./types";

const MAPS = ["workItems", "backlogs", "backlogTrees", "hyperlinks"] as const;
type MapName = (typeof MAPS)[number];
type Entry = Record<string, unknown>;

/** The keys whose entry is a different object in `after` than in `before`. */
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const k in after) if (after[k] !== before[k]) keys.push(k);
  for (const k in before) if (!(k in after)) keys.push(k);
  return keys;
}

const isRecord = (v: unknown): v is Entry => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The copy's version of an entry, given that it was `was` here before the
 * change from elsewhere and is `now` after it.
 */
function carried(copy: unknown, was: unknown, now: unknown): unknown {
  // Untouched here since the copy was taken: the change from elsewhere stands.
  if (copy === was) return now;
  // Deleted elsewhere: gone, whatever was done to it here.
  if (now === undefined) return undefined;
  // Made or deleted here since the copy: the copy says what undo restores.
  if (!isRecord(copy) || !isRecord(was) || !isRecord(now)) return copy;
  // Changed both here and elsewhere: the fields changed elsewhere.
  let out: Entry | null = null;
  for (const f of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (was[f] === now[f] || copy[f] === now[f]) continue;
    out ??= { ...copy };
    if (now[f] === undefined) delete out[f];
    else out[f] = now[f];
  }
  return out ?? copy;
}

/** Make the changes between `before` and `after` in every copy on the undo and redo stacks. */
export function rebaseUndoHistory(before: AppState, after: AppState): void {
  if (after.undoStack.length === 0 && after.redoStack.length === 0) return;
  const changes: Array<[MapName, string[]]> = [];
  for (const name of MAPS) {
    if (before[name] === after[name]) continue;
    const keys = changedKeys(before[name], after[name]);
    if (keys.length > 0) changes.push([name, keys]);
  }
  if (changes.length === 0) return;
  for (const copy of [...after.undoStack, ...after.redoStack]) {
    for (const [name, keys] of changes) {
      const map = copy[name] as Record<string, unknown>;
      const was = before[name] as Record<string, unknown>;
      const now = after[name] as Record<string, unknown>;
      for (const k of keys) {
        const next = carried(map[k], was[k], now[k]);
        if (next === map[k]) continue;
        if (next === undefined) delete map[k];
        else map[k] = next;
      }
    }
  }
}
