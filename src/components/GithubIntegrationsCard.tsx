import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Github, Trash2, Plus, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";

interface Integration {
  id: string;
  organization_id: string;
  repo_full_name: string;
  webhook_secret: string;
  enabled: boolean;
}

interface Target {
  id: string;
  integration_id: string;
  tree_id: string;
  backlog_id: string;
}

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/github-pr-merged`;

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => {
    toast({ title: `${label} copied` });
  });
}

export function GithubIntegrationsCard() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(false);
  const [newRepo, setNewRepo] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [draftTree, setDraftTree] = useState<Record<string, string>>({});
  const [draftBacklog, setDraftBacklog] = useState<Record<string, string>>({});

  const orgTrees = Object.values(backlogTrees);
  const backlogsByTree = (treeId: string) =>
    Object.values(backlogs).filter((b) => b.treeId === treeId);

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    const [{ data: ints }, { data: tgts }] = await Promise.all([
      supabase.from("github_repo_integrations").select("*").eq("organization_id", activeOrgId).order("repo_full_name"),
      supabase.from("github_repo_targets").select("*").eq("organization_id", activeOrgId),
    ]);
    setIntegrations((ints ?? []) as Integration[]);
    setTargets((tgts ?? []) as Target[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const addIntegration = async () => {
    const repo = newRepo.trim().toLowerCase();
    if (!repo.match(/^[^/\s]+\/[^/\s]+$/)) {
      toast({ title: "Use owner/name format", variant: "destructive" });
      return;
    }
    if (!activeOrgId) return;
    const { error } = await supabase.from("github_repo_integrations").insert({
      organization_id: activeOrgId,
      repo_full_name: repo,
      webhook_secret: randomSecret(),
    });
    if (error) {
      toast({ title: "Failed to add", description: error.message, variant: "destructive" });
      return;
    }
    setNewRepo("");
    load();
  };

  const rotateSecret = async (id: string) => {
    const { error } = await supabase
      .from("github_repo_integrations")
      .update({ webhook_secret: randomSecret() })
      .eq("id", id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    setRevealed((r) => ({ ...r, [id]: true }));
    load();
  };

  const toggleEnabled = async (i: Integration) => {
    await supabase.from("github_repo_integrations").update({ enabled: !i.enabled }).eq("id", i.id);
    load();
  };

  const deleteIntegration = async (id: string) => {
    if (!confirm("Delete this GitHub integration and all its targets?")) return;
    await supabase.from("github_repo_integrations").delete().eq("id", id);
    load();
  };

  const addTarget = async (integ: Integration) => {
    const tree = draftTree[integ.id];
    const backlog = draftBacklog[integ.id];
    if (!tree || !backlog) {
      toast({ title: "Pick a tree and backlog", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("github_repo_targets").insert({
      integration_id: integ.id,
      organization_id: integ.organization_id,
      tree_id: tree,
      backlog_id: backlog,
    });
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    setDraftTree((d) => ({ ...d, [integ.id]: "" }));
    setDraftBacklog((d) => ({ ...d, [integ.id]: "" }));
    load();
  };

  const deleteTarget = async (id: string) => {
    await supabase.from("github_repo_targets").delete().eq("id", id);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Github className="w-4 h-4" /> GitHub repositories
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Connect GitHub repositories so every merged pull request creates a "Done" work item at the top of the chosen backlog(s).
          Use the URL and secret below as the webhook in each repo's GitHub settings (event: <em>Pull requests</em>, content type: <em>application/json</em>).
        </p>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="new-repo">Add repository (owner/name)</Label>
            <Input
              id="new-repo"
              placeholder="acme/website"
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
            />
          </div>
          <Button onClick={addIntegration} disabled={loading}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>

        <div className="space-y-4">
          {integrations.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No repositories connected yet.</p>
          )}
          {integrations.map((i) => {
            const its = targets.filter((t) => t.integration_id === i.id);
            const isRevealed = !!revealed[i.id];
            return (
              <div key={i.id} className="border rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Github className="w-4 h-4 shrink-0" />
                    <span className="font-mono text-sm truncate">{i.repo_full_name}</span>
                    {!i.enabled && <Badge variant="secondary">Disabled</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={i.enabled} onCheckedChange={() => toggleEnabled(i)} />
                    <Button size="sm" variant="ghost" onClick={() => deleteIntegration(i.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">Payload URL</span>
                    <code className="flex-1 truncate bg-muted px-2 py-1 rounded text-xs">{WEBHOOK_URL}</code>
                    <Button size="sm" variant="ghost" onClick={() => copy(WEBHOOK_URL, "URL")}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">Secret</span>
                    <code className="flex-1 truncate bg-muted px-2 py-1 rounded text-xs">
                      {isRevealed ? i.webhook_secret : "•".repeat(32)}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => setRevealed((r) => ({ ...r, [i.id]: !isRevealed }))}>
                      {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => copy(i.webhook_secret, "Secret")}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => rotateSecret(i.id)} title="Rotate secret">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Target backlogs
                  </div>
                  {its.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No targets — merged PRs will be ignored.</p>
                  )}
                  {its.map((t) => {
                    const treeName = backlogTrees[t.tree_id]?.name ?? t.tree_id;
                    const backlogName = backlogs[t.backlog_id]?.name ?? t.backlog_id;
                    return (
                      <div key={t.id} className="flex items-center justify-between bg-muted/40 px-2 py-1 rounded text-sm">
                        <span className="truncate">
                          <span className="text-muted-foreground">{treeName}</span> / {backlogName}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => deleteTarget(t.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    );
                  })}

                  <div className="flex flex-wrap items-end gap-2 pt-1">
                    <div className="flex-1 min-w-[140px]">
                      <Label className="text-xs">Tree</Label>
                      <Select
                        value={draftTree[i.id] ?? ""}
                        onValueChange={(v) => {
                          setDraftTree((d) => ({ ...d, [i.id]: v }));
                          setDraftBacklog((d) => ({ ...d, [i.id]: "" }));
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select tree" /></SelectTrigger>
                        <SelectContent>
                          {orgTrees.map((tr) => (
                            <SelectItem key={tr.id} value={tr.id}>{tr.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <Label className="text-xs">Backlog</Label>
                      <Select
                        value={draftBacklog[i.id] ?? ""}
                        onValueChange={(v) => setDraftBacklog((d) => ({ ...d, [i.id]: v }))}
                        disabled={!draftTree[i.id]}
                      >
                        <SelectTrigger><SelectValue placeholder="Select backlog" /></SelectTrigger>
                        <SelectContent>
                          {draftTree[i.id] && backlogsByTree(draftTree[i.id]).map((b) => (
                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" onClick={() => addTarget(i)}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add target
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
