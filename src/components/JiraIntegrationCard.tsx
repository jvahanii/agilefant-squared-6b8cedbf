import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight, Loader2, Plus, RefreshCw, Unplug } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { callJira, type JiraProject, type JiraSpace, type JiraStatus } from "@/lib/jiraSync";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { syncJiraNow } from "@/lib/jiraSyncNow";
import { JiraCreateSpaceForm } from "@/components/JiraCreateSpaceForm";

/**
 * Jira Cloud spaces kept in step with Agilefant lists, both ways: names,
 * descriptions, statuses, points and the hierarchy. Each space chosen here
 * goes with a new list of its own, named after it, in the backlog tree chosen
 * for it. Changes travel at once — Agilefant's by a database trigger,
 * Jira's by each space's webhook — and "Sync now" goes through every space.
 * Taking a space off stops its sync; the list and its items stay.
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
  const [busy, setBusy] = useState<null | string>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  /** The site's spaces, once asked for. */
  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  /** Per space key: where it goes — "new:<treeId>" or "list:<backlogId>". */
  const [targets, setTargets] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoadError(null);
    try {
      const next = await callJira({ action: "status", organizationId: activeOrgId });
      setStatus(next);
      if (next.connected) {
        setBaseUrl(next.baseUrl ?? "");
        setEmail(next.email ?? "");
      }
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [activeOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const spaces: JiraSpace[] = useMemo(() => status?.spaces ?? [], [status]);
  const takenKeys = useMemo(() => new Set(spaces.map((s) => s.projectKey)), [spaces]);

  // Every list, named with its tree; and the trees, for a new list.
  const lists = useMemo(
    () =>
      Object.values(backlogs)
        .map((b) => ({ id: b.id, label: `${backlogTrees[b.treeId]?.name ?? "?"} › ${b.name}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [backlogs, backlogTrees],
  );
  const trees = useMemo(
    () => Object.values(backlogTrees).map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [backlogTrees],
  );
  const listName = (id?: string) => lists.find((l) => l.id === id)?.label ?? "(a list not loaded here)";

  /** After a space is added or taken off: the sidebar's marks, the tags, and a new list. */
  const refreshAround = () => {
    void useJiraIssuesStore.getState().load();
    void useAppStore.getState().loadFromSupabase?.();
  };

  const showSpaces = async () => {
    if (!activeOrgId) return;
    setBusy("projects");
    try {
      const result = await callJira<{ projects: JiraProject[] }>({ action: "projects", organizationId: activeOrgId, baseUrl, email });
      setProjects(result.projects);
    } catch (e) {
      toast({ title: "Could not read Jira's spaces", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const addSpace = async (project: JiraProject) => {
    if (!activeOrgId) return;
    const target = targets[project.key];
    if (!target) return;
    setBusy(`add:${project.key}`);
    try {
      const [kind, id] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
      const next = await callJira({
        action: "addSpace",
        organizationId: activeOrgId,
        baseUrl,
        email,
        projectKey: project.key,
        ...(kind === "list" ? { backlogId: id } : { newListTreeId: id }),
      });
      setStatus(next);
      setTargets(({ [project.key]: _done, ...rest }) => rest);
      refreshAround();
      const where = kind === "list" ? listName(id) : `a new list "${project.name}" in ${backlogTrees[id]?.name ?? "the tree"}`;
      toast(
        next.webhookError
          ? {
              title: `${project.key} added, but Jira's webhook could not be made`,
              description: `Changes in Jira will come in only on Sync now. ${next.webhookError}`,
              variant: "destructive",
            }
          : {
              title: `${project.key} is synchronised`,
              // The first sync is done by now: the space's issues are in the list being reloaded.
              description: next.report
                ? `With ${where}: ${next.report.createdInAgilefant} issue(s) brought in, ${next.report.createdInJira} item(s) sent to Jira.`
                : `With ${where}. The first sync will finish shortly.`,
            },
      );
    } catch (e) {
      toast({ title: `Could not add ${project.key}`, description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const removeSpace = async (space: JiraSpace) => {
    if (!activeOrgId) return;
    if (!confirm(`Stop synchronising ${space.projectKey}? The list and its items stay in Agilefant, and the issues in Jira.`)) return;
    setBusy(`remove:${space.id}`);
    try {
      setStatus(await callJira({ action: "removeSpace", organizationId: activeOrgId, connectionId: space.id }));
      refreshAround();
      toast({ title: `${space.projectKey} is no longer synchronised` });
    } catch (e) {
      toast({ title: `Could not take ${space.projectKey} off`, description: (e as Error).message, variant: "destructive" });
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
    if (!confirm("Stop synchronising every space? Lists, items and issues stay as they are on both sides.")) return;
    setBusy("disconnect");
    try {
      setStatus(await callJira({ action: "disconnect", organizationId: activeOrgId }));
      setProjects(null);
      refreshAround();
      toast({ title: "Jira disconnected" });
    } catch (e) {
      toast({ title: "Could not disconnect", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const available = (projects ?? []).filter((p) => !takenKeys.has(p.key));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4" /> Jira
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Synchronise Jira Cloud spaces with lists, both ways: names, descriptions, statuses, points, and the hierarchy.
          Choose the spaces, and for each the backlog tree its new list goes in. Changes travel at once in either direction;
          a change made on both sides keeps the later one, and deleting on one side deletes on the other.{" "}
          <a href="/user-guide/jira" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
            Read the guide
          </a>
        </p>

        {loadError && <p className="text-sm text-destructive">Could not read the Jira connection: {loadError}</p>}

        {status && !status.tokenConfigured && (
          <p className="text-sm rounded-md border border-destructive/40 p-3">
            The Jira API token is not set yet. Create one at id.atlassian.com → Security → API tokens, and add it in Supabase
            under Edge Functions → Secrets as <code>JIRA_API_TOKEN</code>.
          </p>
        )}

        {status && (
          <>
            {/* The site and account the spaces share: typed once, then fixed while spaces are kept in step. */}
            {spaces.length === 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="jira-base-url">Jira address</Label>
                  <Input id="jira-base-url" placeholder="https://yoursite.atlassian.net" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="jira-email">Atlassian account email</Label>
                  <Input id="jira-email" type="email" placeholder="the API token's owner" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {status.baseUrl} · {status.email}
              </p>
            )}

            {spaces.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Spaces synchronised</p>
                <ul className="space-y-2">
                  {spaces.map((space) => (
                    <li key={space.id} className="rounded-md border p-2 text-sm space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="font-medium">{space.projectKey}</span>
                          {space.projectName ? ` ${space.projectName}` : ""} ↔ <span className="font-medium">{listName(space.backlogId)}</span>
                        </span>
                        {canManage && (
                          <Button size="sm" variant="ghost" onClick={() => removeSpace(space)} disabled={busy !== null}>
                            {busy === `remove:${space.id}` ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Unplug className="w-3.5 h-3.5 mr-1" />}
                            Disconnect
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {space.linked} item(s) paired
                        {space.pending ? `, ${space.pending} change(s) waiting` : ""}
                        {space.lastSyncedAt ? `. Last synced ${new Date(space.lastSyncedAt).toLocaleString()}` : ". Not synced yet"}
                        {space.webhook ? "." : ". Jira's webhook is not registered, so Jira's changes come in only on Sync now."}
                      </p>
                      {space.lastError && <p className="text-xs text-destructive">Last error: {space.lastError}</p>}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={syncNow} disabled={busy !== null}>
                    {busy === "sync" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                    Sync now
                  </Button>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={disconnect} disabled={busy !== null}>
                      <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect all
                    </Button>
                  )}
                </div>
              </div>
            )}

            {canManage ? (
              <div className="space-y-2">
                <Button size="sm" variant="outline" onClick={showSpaces} disabled={busy !== null || !baseUrl || !email}>
                  {busy === "projects" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                  {spaces.length > 0 ? "Choose more spaces" : "Choose spaces"}
                </Button>
                {projects && available.length === 0 && (
                  <p className="text-xs text-muted-foreground">Every space on the site the account can see is synchronised already.</p>
                )}
                {projects && available.length > 0 && (
                  <ul className="space-y-2" aria-label="Jira spaces">
                    {available.map((project) => (
                      <li key={project.key} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-[10rem]">
                          <span className="font-medium">{project.key}</span> {project.name}
                        </span>
                        {/* Only the trees: the space gets a new list of its own, named after it, in the one chosen. */}
                        <Select value={targets[project.key] ?? ""} onValueChange={(v) => setTargets((t) => ({ ...t, [project.key]: v }))}>
                          <SelectTrigger className="h-8 w-[18rem]" aria-label={`Tree for ${project.key}`}>
                            <SelectValue placeholder="Choose its tree" />
                          </SelectTrigger>
                          <SelectContent
                            side="bottom"
                            avoidCollisions={false}
                            className="max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-y-auto"
                          >
                            {trees.map((t) => (
                              <SelectItem key={`new:${t.id}`} value={`new:${t.id}`}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={() => addSpace(project)} disabled={busy !== null || !targets[project.key]}>
                          {busy === `add:${project.key}` && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                          Sync now
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {/* The other way: a list of Agilefant's moved to a Jira space made for it. */}
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm font-medium">Move a list to Jira</p>
                  <JiraCreateSpaceForm
                    account={spaces.length === 0 ? { baseUrl, email } : undefined}
                    onDone={(next) => setStatus(next)}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Only an owner or admin can choose which Jira spaces are synchronised.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
