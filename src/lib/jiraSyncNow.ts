import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import { callJira, type JiraStatus } from "@/lib/jiraSync";

/**
 * "Sync now": everything, both ways, then a toast of what changed and the
 * first errors. The same from the Jira card in Settings and from the header.
 * Throws nothing; a failure is a toast too. Returns the connection's status
 * after, or null when the sync failed.
 */
export async function syncJiraNow(organizationId: string): Promise<JiraStatus | null> {
  try {
    const next = await callJira({ action: "sync", organizationId });
    const r = next.report;
    const parts = r
      ? [
          r.createdInAgilefant && `${r.createdInAgilefant} new in Agilefant`,
          r.createdInJira && `${r.createdInJira} new in Jira`,
          r.updatedInAgilefant && `${r.updatedInAgilefant} updated in Agilefant`,
          r.updatedInJira && `${r.updatedInJira} updated in Jira`,
          r.deletedInAgilefant && `${r.deletedInAgilefant} deleted in Agilefant`,
          r.deletedInJira && `${r.deletedInJira} deleted in Jira`,
        ].filter(Boolean)
      : [];
    toast({
      title: r && r.errors.length > 0 ? `Synced, with ${r.errors.length} error(s)` : "Synced with Jira",
      description: [parts.length > 0 ? parts.join(", ") : "Nothing needed changing.", ...(r?.errors.slice(0, 3) ?? []), ...(r?.skipped.slice(0, 2) ?? [])].join(" "),
      variant: r && r.errors.length > 0 ? "destructive" : undefined,
    });
    // The items Jira brought in arrive with the next load.
    void useAppStore.getState().loadFromSupabase?.();
    return next;
  } catch (e) {
    toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
    return null;
  }
}
