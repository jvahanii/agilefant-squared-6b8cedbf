import { supabase } from "@/integrations/supabase/client";

/**
 * Which extractor a saved query runs under. Job-ad import is a separate
 * feature with its own card and its own saved queries; the two never share a
 * list, so turning on one cannot change what the other imports.
 */
export type ImportMode = "links" | "jobs";

/** The parts of a saved search needed to run it and import what it finds. */
export interface RunnableSearch {
  id: string;
  query: string;
  tree_id: string;
  backlog_id: string;
}

/**
 * Call the gmail-connector function, throwing with the most useful message the
 * failure carries: a non-2xx response's body, not just its status.
 */
export async function callGmail<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("gmail-connector", { body });
  if (error) {
    let details = error.message;
    const context = (error as { context?: { text?: () => Promise<string> } }).context;
    if (context?.text) {
      try {
        details = await context.text();
      } catch {
        /* keep original message */
      }
    }
    throw new Error(details);
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}
