import type { WorkItem } from "@/types/models";
import { titleDeadline } from "../../supabase/functions/_shared/deadlines";

/**
 * Search commands live in itemSearch.ts; this is the day they go by.
 */

/**
 * The day an item is due: its deadline, or — for an organization that keeps
 * none — the date its name starts with, as an imported job ad's does there.
 */
export function dueDay(item: Pick<WorkItem, "title" | "deadline">, now: Date = new Date()): string | undefined {
  return item.deadline ?? titleDeadline(item.title, now);
}
