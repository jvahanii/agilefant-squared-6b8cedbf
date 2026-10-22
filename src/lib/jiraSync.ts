import { supabase } from "@/integrations/supabase/client";

/** What the jira-sync function says about an organization's connection. */
export interface JiraStatus {
  connected: boolean;
  /** Whether the edge functions have the JIRA_API_TOKEN secret. */
  tokenConfigured: boolean;
  baseUrl?: string;
  email?: string;
  projectKey?: string;
  treeId?: string;
  backlogId?: string;
  pointsField?: string | null;
  /** Whether Jira's webhook is registered: without it, Jira's changes come in only on Sync now. */
  webhook?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  linked?: number;
  pending?: number;
  itemErrors?: { jira_key: string; last_error: string }[];
  webhookError?: string | null;
  report?: {
    createdInAgilefant: number;
    createdInJira: number;
    updatedInAgilefant: number;
    updatedInJira: number;
    deletedInAgilefant: number;
    deletedInJira: number;
    skipped: string[];
    errors: string[];
  };
}

/**
 * Call the jira-sync function, throwing with the most useful message the
 * failure carries: the function's own error text, not just a status code.
 */
export async function callJira<T = JiraStatus>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("jira-sync", { body });
  if (error) {
    let details = error.message;
    const context = (error as { context?: { json?: () => Promise<{ error?: string }>; text?: () => Promise<string> } }).context;
    try {
      const parsed = await context?.json?.();
      if (parsed?.error) details = parsed.error;
    } catch {
      /* keep the library's message */
    }
    throw new Error(details);
  }
  if (data && typeof data === "object" && "error" in data) throw new Error(String((data as { error: unknown }).error));
  return data as T;
}
