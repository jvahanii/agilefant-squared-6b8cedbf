import type { WorkItemStatus } from "@/types/models";

/**
 * What a visitor adds in the try-out at /try before signing up (2026-11-16).
 *
 * It lives only in this browser, under one localStorage key, and nothing is
 * sent anywhere. When the visitor signs up, the new account's first screen
 * takes it out of storage and adds it to the first list, nesting and done
 * marks included (takeTriedList, used by WorkItemTreePanel).
 *
 * An item is a line of an outline: its depth says how far it is indented, and
 * the lines after it that are indented further are its sub-items.
 */
export interface TryItem {
  id: string;
  title: string;
  depth: number;
  done: boolean;
}

/** An item to create, with its sub-items: what addWorkItemTree takes. */
export interface NewItemNode {
  title: string;
  status?: WorkItemStatus;
  children?: NewItemNode[];
}

export const TRY_LIST_KEY = "agilefant.tryList";
/** A list older than this is not brought into a new account. */
export const TRY_LIST_DAYS = 7;
export const MAX_TRY_ITEMS = 100;
const MAX_TITLE = 500;

let seq = 0;
export const newTryId = () => `try-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** The index just past item i's last sub-item. */
export function subtreeEnd(items: TryItem[], i: number): number {
  let end = i + 1;
  while (end < items.length && items[end].depth > items[i].depth) end++;
  return end;
}

/**
 * The status an item shows and keeps: done, or in progress when it is not
 * done but some sub-item is, as the app moves a parent on when a child is
 * marked done.
 */
export function statusOf(items: TryItem[], i: number): WorkItemStatus {
  if (items[i].done) return "done";
  for (let k = i + 1; k < subtreeEnd(items, i); k++) if (items[k].done) return "in_progress";
  return "not_started";
}

/** The outline as nested items to create. */
export function toTree(items: TryItem[]): NewItemNode[] {
  const build = (from: number, to: number): NewItemNode[] => {
    const level: NewItemNode[] = [];
    for (let i = from; i < to; i = subtreeEnd(items, i)) {
      const end = subtreeEnd(items, i);
      const children = build(i + 1, end);
      level.push({ title: items[i].title, status: statusOf(items, i), ...(children.length ? { children } : {}) });
    }
    return level;
  };
  return build(0, items.length);
}

/**
 * Whatever was stored, as a well-formed outline: titles trimmed and capped,
 * the first item at the top level and none indented more than one step past
 * the item above it. Null when nothing usable is there.
 */
export function sanitize(raw: unknown): TryItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TryItem[] = [];
  for (const r of raw.slice(0, MAX_TRY_ITEMS)) {
    if (!r || typeof r !== "object") continue;
    const { title, depth, done } = r as Record<string, unknown>;
    if (typeof title !== "string" || !title.trim()) continue;
    const max = out.length === 0 ? 0 : out[out.length - 1].depth + 1;
    const d = typeof depth === "number" && Number.isInteger(depth) && depth > 0 ? Math.min(depth, max) : 0;
    out.push({ id: newTryId(), title: title.trim().slice(0, MAX_TITLE), depth: d, done: done === true });
  }
  return out.length > 0 ? out : null;
}

interface Stored {
  savedAt: string;
  items: unknown;
}

function read(now: Date): TryItem[] | null {
  try {
    const raw = localStorage.getItem(TRY_LIST_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    const age = now.getTime() - new Date(stored?.savedAt).getTime();
    if (!(age >= 0 && age <= TRY_LIST_DAYS * 86_400_000)) {
      localStorage.removeItem(TRY_LIST_KEY);
      return null;
    }
    return sanitize(stored.items);
  } catch {
    return null;
  }
}

/** The visitor's list as they left it, if it is recent enough to keep. */
export function loadTryList(now = new Date()): TryItem[] | null {
  return read(now);
}

/** Saves the list, or forgets it when it is empty. */
export function saveTryList(items: TryItem[], now = new Date()): void {
  try {
    if (items.length === 0) localStorage.removeItem(TRY_LIST_KEY);
    else
      localStorage.setItem(
        TRY_LIST_KEY,
        JSON.stringify({ savedAt: now.toISOString(), items: items.map(({ title, depth, done }) => ({ title, depth, done })) }),
      );
  } catch {
    // Private windows and full storage: the list just isn't kept.
  }
}

/**
 * The tried list as items to create, taken out of storage so it comes in
 * once. Null when there is none, or it is older than TRY_LIST_DAYS.
 */
export function takeTriedList(now = new Date()): NewItemNode[] | null {
  const items = read(now);
  try {
    localStorage.removeItem(TRY_LIST_KEY);
  } catch {
    // Nothing to do: reading failed the same way.
  }
  return items ? toTree(items) : null;
}

/** How many items an outline holds, sub-items included. */
export const countNodes = (nodes: NewItemNode[]): number =>
  nodes.reduce((n, node) => n + 1 + countNodes(node.children ?? []), 0);
