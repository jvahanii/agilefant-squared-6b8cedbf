import { supabase } from "@/integrations/supabase/client";

/** One Jira space kept in step with a list. */
export interface JiraSpace {
  id: string;
  projectKey: string;
  projectName: string | null;
  treeId: string;
  backlogId: string;
  webhook: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  linked: number;
  pending: number;
  itemErrors: { jira_key: string; last_error: string }[];
}

/** A space on the Jira site, as offered to choose from. */
export interface JiraProject {
  id: string;
  key: string;
  name: string;
  /** "next-gen" for team-managed, "classic" for company-managed. */
  style: string | null;
}

/** What the jira-sync function says about an organization's Jira: the site, the account, and each space kept in step. */
export interface JiraStatus {
  connected: boolean;
  /** Every space kept in step; the single-space fields below are the first one's. */
  spaces?: JiraSpace[];
  /** The space just added, by addSpace. */
  added?: string;
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
