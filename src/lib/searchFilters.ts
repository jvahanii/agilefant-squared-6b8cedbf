import { toIsoDate } from "@/lib/deadlineFormat";
import type { WorkItem } from "@/types/models";
import { titleDeadline } from "../../supabase/functions/_shared/deadlines";

/**
 * Filters typed into the search box as a command rather than as words to look
 * for in a title. They start with a slash, which no title search does: "/" is
 * also the key that puts the cursor in the box, so the hand is already there.
 *
 *   /due today    the items whose deadline is today
 *
 * A filter answers for items only — a list has no deadline — and across every
 * tree, as a search by title does.
 */
export interface SearchFilter {
  /** Does this item belong in the results? */
  matches(item: Pick<WorkItem, "title" | "deadline">): boolean;
  /** What to say when nothing does: "No items are due today". */
  nothingFound: string;
}

/**
 * The day an item is due: its deadline, or — for an organization that keeps
 * none — the date its name starts with, as an imported job ad's does there.
 */
export function dueDay(item: Pick<WorkItem, "title" | "deadline">, now: Date = new Date()): string | undefined {
  return item.deadline ?? titleDeadline(item.title, now);
}

/**
 * The filter a search query names, or null when it is an ordinary search.
 * Case and extra spaces do not matter: "/Due  today" is "/due today".
 */
export function searchFilter(query: string, now: Date = new Date()): SearchFilter | null {
  const command = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (command === "/due today") {
    const today = toIsoDate(now);
    return {
      matches: (item) => dueDay(item, now) === today,
      nothingFound: "No items are due today",
    };
  }
  return null;
}
