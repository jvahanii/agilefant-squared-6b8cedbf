import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { callJira, type JiraStatus } from "@/lib/jiraSync";
import { PROJECT_KEY, suggestProjectKey } from "../../supabase/functions/_shared/jiraProjectKey";

/**
 * Moving an Agilefant list to Jira: a new Jira space made for it, named after
 * it, and kept in step with it both ways from then on — its items sent there
 * at once. The key is proposed from the name and may be changed; left as
 * proposed, the sync picks one free on the site.
 *
 * With `backlogId` the list is the one right-clicked; without, one is chosen
 * here, among the lists not kept in step with a space yet.
 */
export function JiraCreateSpaceForm({
  backlogId: fixedBacklogId,
  account,
  onDone,
}: {
  backlogId?: string;
  /** The Jira site and account, where no space is kept in step yet to take them from. */
  account?: { baseUrl: string; email: string };
  onDone?: (status: JiraStatus) => void;
}) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const kept = useJiraIssuesStore((s) => s.byList);

  const [chosen, setChosen] = useState(fixedBacklogId ?? "");
  const backlogId = fixedBacklogId ?? chosen;
  const listName = backlogs[backlogId]?.name ?? "";
  const [name, setName] = useState(listName);
  const [key, setKey] = useState(suggestProjectKey(listName));
  const [keyEdited, setKeyEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  // A list chosen: its name, and a key from it, unless one was typed.
  useEffect(() => {
    setName(listName);
    if (!keyEdited) setKey(suggestProjectKey(listName));
    // Only when the list changes, not as the name is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backlogId]);

  /** Every list not kept in step yet, with the lists above it: "Tree › Parent › List". */
  const lists = useMemo(() => {
    const path = (id: string): string => {
      const b = backlogs[id];
      if (!b) return "";
      return b.parentId && backlogs[b.parentId] ? `${path(b.parentId)} › ${b.name}` : `${backlogTrees[b.treeId]?.name ?? "?"} › ${b.name}`;
    };
    return Object.values(backlogs)
      .filter((b) => !kept.has(b.id))
      .map((b) => ({ id: b.id, label: path(b.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [backlogs, backlogTrees, kept]);

  const keyOk = PROJECT_KEY.test(key);
  const ready = !!activeOrgId && !!backlogId && !!name.trim() && keyOk && !busy;

  const create = async () => {
    if (!activeOrgId || !backlogId) return;
    setBusy(true);
    try {
      const next = await callJira<JiraStatus & { created?: { key: string; name: string } }>({
        action: "createSpaceFromList",
        organizationId: activeOrgId,
        backlogId,
        projectName: name.trim(),
        // Left as proposed, the key is the sync's to choose: it knows which are taken.
        ...(keyEdited ? { projectKey: key } : {}),
        ...(account ?? {}),
      });
      void useJiraIssuesStore.getState().load();
      const made = next.created?.key ?? key;
      toast(
        next.webhookError
          ? {
              title: `${made} made in Jira, but its webhook could not be`,
              description: `Changes in Jira will come in only on Sync now. ${next.webhookError}`,
              variant: "destructive",
            }
          : {
              title: `${made} made in Jira`,
              description: `"${listName}" is kept in step with it${next.report ? `: ${next.report.createdInJira} item(s) sent to Jira` : ""}.`,
            },
      );
      onDone?.(next);
    } catch (e) {
      toast({ title: "Could not move the list to Jira", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {!fixedBacklogId && (
        <div className="space-y-1">
          <Label htmlFor="jira-move-list">List</Label>
          <Select value={chosen} onValueChange={setChosen}>
            <SelectTrigger id="jira-move-list" aria-label="List to move to Jira">
              <SelectValue placeholder="Choose the list" />
            </SelectTrigger>
            <SelectContent>
              {lists.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div className="space-y-1">
          <Label htmlFor="jira-new-space-name">Jira space name</Label>
          <Input id="jira-new-space-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="jira-new-space-key">Key</Label>
          <Input
            id="jira-new-space-key"
            value={key}
            maxLength={10}
            onChange={(e) => {
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
              setKeyEdited(true);
            }}
            aria-invalid={!keyOk}
          />
        </div>
      </div>
      {!keyOk && key && <p className="text-xs text-destructive">A key is a capital letter and then capitals or digits, 2–10 in all.</p>}
      <p className="text-xs text-muted-foreground">
        A company-managed Scrum space is made in Jira, and the list's items are sent there at once; from then on the two are
        kept in step both ways. Making a space takes the Jira account's Administer Jira permission.
      </p>
      <Button size="sm" onClick={create} disabled={!ready}>
        {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
        Create space in Jira
      </Button>
    </div>
  );
}
