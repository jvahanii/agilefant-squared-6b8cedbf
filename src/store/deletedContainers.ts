/**
 * Lists and trees this browser deleted recently.
 *
 * Saving a work item also saves the lists and trees it points at, so a save
 * that still carried a deleted list — a queued retry replayed after a refresh,
 * or an edit made from a stale copy — wrote the list back. On 2026-10-23 two
 * Jira-synced lists came back that way and had to be deleted twice.
 *
 * Remembered in localStorage so the guard survives the refresh that replays
 * queued saves. Forgotten when undo restores the list, or after a day.
 */
const KEY = 'agilefant:deletedContainers';
export const DELETED_CONTAINER_GUARD_MS = 24 * 60 * 60 * 1000;

function read(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const now = Date.now();
    const kept: Record<string, number> = {};
    for (const [id, at] of Object.entries(raw)) {
      if (typeof at === 'number' && now - at <= DELETED_CONTAINER_GUARD_MS) kept[id] = at;
    }
    return kept;
  } catch {
    return {};
  }
}

function write(map: Record<string, number>) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Best effort.
  }
}

export function markContainersDeleted(ids: string[]): void {
  if (ids.length === 0) return;
  const map = read();
  const now = Date.now();
  for (const id of ids) map[id] = now;
  write(map);
}

export function forgetDeletedContainers(ids: string[]): void {
  if (ids.length === 0) return;
  const map = read();
  let changed = false;
  for (const id of ids) if (id in map) { delete map[id]; changed = true; }
  if (changed) write(map);
}

export function isRecentlyDeletedContainer(id: string): boolean {
  return id in read();
}
