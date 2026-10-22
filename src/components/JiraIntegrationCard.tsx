import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { callJira, type JiraStatus } from "@/lib/jiraSync";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { syncJiraNow } from "@/lib/jiraSyncNow";

/**
 * One Agilefant list kept in step with one Jira Cloud project, both ways:
 * names, descriptions, statuses, points and the epic → task → subtask
 * hierarchy. Changes travel at once — Agilefant's by a database trigger,
 * Jira's by its webhook — and "Sync now" goes through everything.
 *
 * The Jira API token is never typed here: it is the edge functions'
 * JIRA_API_TOKEN secret, set in Supabase by whoever owns the Jira account.
 */
export function JiraIntegrationCard({ canManage }: { canManage: boolean }) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);

  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(null);
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [backlogId, setBacklogId] = useState("");

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoadError(null);
    try {
      const next = await callJira({ action: "status", organizationId: activeOrgId });
      setStatus(next);
      if (next.connected) {
        setBaseUrl(next.baseUrl ?? "");
        setEmail(next.email ?? "");
        setProjectKey(next.projectKey ?? "");
        setBacklogId(next.backlogId ?? "");
      }
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every list, named with its tree, to choose the one to keep in step.
  const lists = useMemo(
    () =>
      Object.values(backlogs)
        .map((b) => ({ id: b.id, label: `${backlogTrees[b.treeId]?.name ?? "?"} › ${b.name}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [backlogs, backlogTrees],
  );
  const listName = (id?: string) => lists.find((l) => l.id === id)?.label ?? "(a list not loaded here)";

  const connect = async () => {
    if (!activeOrgId) return;
    setBusy("connect");
    try {
      const next = await callJira({ action: "configure", organizationId: activeOrgId, baseUrl, email, projectKey, backlogId });
      // The sidebar marks the list that is now kept in step.
      void useJiraIssuesStore.getState().load();
      setStatus(next);
      setEditing(false);
      toast(
        next.webhookError
          ? {
              title: "Connected, but Jira's webhook could not be made",
              description: `Changes in Jira will come in only on Sync now. ${next.webhookError}`,
              variant: "destructive",
            }
          : { title: "Jira connected", description: `${next.projectKey} ↔ ${listName(next.backlogId)}. Press Sync now for the first sync.` },
      );
    } catch (e) {
      toast({ title: "Could not connect Jira", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    if (!activeOrgId) return;
    setBusy("sync");
    const next = await syncJiraNow(activeOrgId);
    if (next) setStatus(next);
    setBusy(null);
  };

  const disconnect = async () => {
    if (!activeOrgId) return;
    if (!confirm("Disconnect Jira? Items and issues stay as they are on both sides; they just stop being kept in step.")) return;
    setBusy("disconnect");
    try {
      setStatus(await callJira({ action: "disconnect", organizationId: activeOrgId }));
      void useJiraIssuesStore.getState().load();
      toast({ title: "Jira disconnected" });
    } catch (e) {
      toast({ title: "Could not disconnect", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const form = (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="jira-base-url">Jira address</Label>
          <Input id="jira-base-url" placeholder="https://yoursite.atlassian.net" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="jira-email">Atlassian account email</Label>
          <Input id="jira-email" type="email" placeholder="the API token's owner" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="jira-project">Jira project key</Label>
          <Input id="jira-project" placeholder="INT" value={projectKey} onChange={(e) => setProjectKey(e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="jira-list">Agilefant list</Label>
          <Select value={backlogId} onValueChange={setBacklogId}>
            <SelectTrigger id="jira-list" aria-label="Agilefant list">
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
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={connect} disabled={!canManage || busy !== null || !baseUrl || !email || !projectKey || !backlogId}>
          {busy === "connect" && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
          {status?.connected ? "Save" : "Connect"}
        </Button>
        {editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
      {!canManage && <p className="text-xs text-muted-foreground">Only an owner or admin can connect Jira.</p>}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4" /> Jira
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Keep one list and one Jira Cloud project in step, both ways: names, descriptions, statuses, points, and epics →
          tasks → subtasks. Changes travel at once in either direction; a change made on both sides keeps the later one,
          and deleting on one side deletes on the other.
        </p>

        {loadError && <p className="text-sm text-destructive">Could not read the Jira connection: {loadError}</p>}

        {status && !status.tokenConfigured && (
          <p className="text-sm rounded-md border border-destructive/40 p-3">
            The Jira API token is not set yet. Create one at id.atlassian.com → Security → API tokens, and add it in Supabase
            under Edge Functions → Secrets as <code>JIRA_API_TOKEN</code>.
          </p>
        )}

        {status && !status.connected && form}

        {status?.connected && !editing && (
          <div className="space-y-3">
            <div className="text-sm space-y-1">
              <p>
                <span className="font-medium">{status.projectKey}</span> at {status.baseUrl} ↔{" "}
                <span className="font-medium">{listName(status.backlogId)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {status.linked ?? 0} item(s) paired
                {status.pending ? `, ${status.pending} change(s) waiting` : ""}
                {status.lastSyncedAt ? `. Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : ". Not synced yet"}
                {status.webhook ? "." : ". Jira's webhook is not registered, so Jira's changes come in only on Sync now."}
              </p>
              {status.lastError && <p className="text-xs text-destructive">Last error: {status.lastError}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={syncNow} disabled={busy !== null}>
                {busy === "sync" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                Sync now
              </Button>
              {canManage && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy !== null}>
                    Change
                  </Button>
                  <Button size="sm" variant="outline" onClick={disconnect} disabled={busy !== null}>
                    <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {status?.connected && editing && form}
      </CardContent>
    </Card>
  );
}
