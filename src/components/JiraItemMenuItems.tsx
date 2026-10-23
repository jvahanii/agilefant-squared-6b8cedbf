import { Unlink, Link2 } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { toast } from "@/hooks/use-toast";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { useOrgStore } from "@/store/orgStore";
import { callJira } from "@/lib/jiraSync";

/**
 * "Stop syncing with Jira" on a synced item's menu, and "Resume syncing with
 * Jira" once stopped. The item and its issue stay, and stay paired, so a full
 * sync does not make either into a new one; nothing travels between them
 * while stopped, and deleting one leaves the other. Resumed, the two are
 * brought in step from where they last agreed.
 *
 * For members of the organization whose Jira the item is synced with; nothing
 * for an item that is not synced, or one a partner's Jira keeps.
 */
export function JiraItemMenuItems({ workItemId }: { workItemId: string }) {
  const issue = useJiraIssuesStore((s) => s.byItem.get(workItemId));
  const member = useOrgStore((s) => s.memberships.some((m) => m.organization_id === issue?.organizationId));
  if (!issue || !member) return null;

  const setStopped = async (stopped: boolean) => {
    const { byItem, load } = useJiraIssuesStore.getState();
    const before = byItem.get(workItemId);
    if (before) {
      // Shown at once; the reload after confirms it, or puts it back.
      useJiraIssuesStore.setState({ byItem: new Map(byItem).set(workItemId, { ...before, stopped, error: stopped ? before.error : null }) });
    }
    try {
      await callJira({ action: "stopItem", organizationId: issue.organizationId, workItemId, stopped });
      toast({
        title: stopped ? `${issue.key} no longer synced` : `${issue.key} synced again`,
        description: stopped
          ? "The item and its Jira issue stay; changes to either no longer reach the other."
          : "Brought in step with Jira from where the two last agreed.",
      });
    } catch (e) {
      toast({ title: stopped ? "Could not stop syncing" : "Could not resume syncing", description: (e as Error).message, variant: "destructive" });
    }
    void load();
  };

  return (
    <>
      {issue.stopped ? (
        <ContextMenuItem className="text-xs" onSelect={() => void setStopped(false)}>
          <Link2 className="w-3 h-3 mr-2" />
          Resume syncing with Jira
        </ContextMenuItem>
      ) : (
        <ContextMenuItem className="text-xs" onSelect={() => void setStopped(true)}>
          <Unlink className="w-3 h-3 mr-2" />
          Stop syncing with Jira
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
    </>
  );
}
