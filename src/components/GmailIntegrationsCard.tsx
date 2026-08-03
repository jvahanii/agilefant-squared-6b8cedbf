import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Mail, Trash2, Plus, Play, Loader2, LinkIcon, Unplug } from "lucide-react";

interface SavedQuery {
  id: string;
  organization_id: string;
  user_id: string;
  name: string | null;
  query: string;
  tree_id: string;
  backlog_id: string;
  schedule_enabled: boolean;
  frequency: "hourly" | "daily";
  last_run_at: string | null;
  last_run_status: string | null;
}

interface PreviewLink {
  url: string;
  title: string;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  alreadyImported: boolean;
}

async function callGmail<T>(body: Record<string, unknown>): Promise<T> {
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

export function GmailIntegrationsCard() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const reloadData = useAppStore((s) => s.loadFromSupabase);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [newQuery, setNewQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newTree, setNewTree] = useState("");
  const [newBacklog, setNewBacklog] = useState("");

  const [runQueryId, setRunQueryId] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState<SavedQuery | null>(null);
  const [preview, setPreview] = useState<PreviewLink[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);

  const popupRef = useRef<Window | null>(null);

  const trees = Object.values(backlogTrees);
  const backlogsForTree = (treeId: string) => Object.values(backlogs).filter((b) => b.treeId === treeId);

  const loadStatus = useCallback(async () => {
    try {
      const res = await callGmail<{ connected: boolean; email: string | null }>({ action: "status" });
      setConnected(res.connected);
      setConnectedEmail(res.email);
    } catch (e) {
      setConnected(false);
      console.error("gmail status failed", e);
    }
  }, []);

  const loadQueries = useCallback(async () => {
    if (!activeOrgId) return;
    const { data, error } = await supabase
      .from("gmail_import_queries")
      .select("*")
      .eq("organization_id", activeOrgId)
      .order("created_at");
    if (error) {
      console.error("failed to load gmail queries", error.message);
      return;
    }
    setQueries((data ?? []) as SavedQuery[]);
  }, [activeOrgId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadQueries();
  }, [loadQueries]);

  // Receive the OAuth code from the popup callback page.
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data as { source?: string; code?: string; error?: string } | null;
      if (!payload || payload.source !== "gmail-oauth") return;
      popupRef.current?.close();
      if (payload.error || !payload.code) {
        setConnecting(false);
        toast({ title: "Gmail connection cancelled", description: payload.error ?? undefined, variant: "destructive" });
        return;
      }
      try {
        const res = await callGmail<{ email: string | null }>({ action: "exchange", code: payload.code });
        setConnected(true);
        setConnectedEmail(res.email);
        toast({ title: "Gmail connected", description: res.email ?? undefined });
      } catch (e) {
        toast({ title: "Could not finish connecting", description: (e as Error).message, variant: "destructive" });
      } finally {
        setConnecting(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      const returnUrl = `${window.location.origin}/gmail-callback.html`;
      const res = await callGmail<{ authorizationUrl: string }>({ action: "start", returnUrl });
      popupRef.current = window.open(res.authorizationUrl, "gmail-oauth", "width=520,height=680");
      if (!popupRef.current) {
        setConnecting(false);
        toast({ title: "Popup blocked", description: "Allow popups and try again.", variant: "destructive" });
      }
    } catch (e) {
      setConnecting(false);
      toast({ title: "Could not start Gmail connection", description: (e as Error).message, variant: "destructive" });
    }
  };

  const disconnect = async () => {
    try {
      await callGmail({ action: "disconnect" });
      setConnected(false);
      setConnectedEmail(null);
      toast({ title: "Gmail disconnected" });
    } catch (e) {
      toast({ title: "Failed to disconnect", description: (e as Error).message, variant: "destructive" });
    }
  };

  const addQuery = async () => {
    if (!activeOrgId) return;
    const query = newQuery.trim();
    if (!query) {
      toast({ title: "Enter a Gmail search query", variant: "destructive" });
      return;
    }
    if (!newTree || !newBacklog) {
      toast({ title: "Pick a backlog tree and backlog", variant: "destructive" });
      return;
    }
    const { data: session } = await supabase.auth.getUser();
    if (!session.user) return;
    const { error } = await supabase.from("gmail_import_queries").insert({
      organization_id: activeOrgId,
      user_id: session.user.id,
      name: newName.trim() || null,
      query,
      tree_id: newTree,
      backlog_id: newBacklog,
    });
    if (error) {
      toast({ title: "Failed to save query", description: error.message, variant: "destructive" });
      return;
    }
    setNewQuery("");
    setNewName("");
    setNewBacklog("");
    loadQueries();
  };

  const toggleSchedule = async (q: SavedQuery) => {
    const { error } = await supabase
      .from("gmail_import_queries")
      .update({ schedule_enabled: !q.schedule_enabled })
      .eq("id", q.id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    loadQueries();
  };

  const setFrequency = async (q: SavedQuery, frequency: "hourly" | "daily") => {
    const { error } = await supabase.from("gmail_import_queries").update({ frequency }).eq("id", q.id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    loadQueries();
  };

  const deleteQuery = async (id: string) => {
    if (!confirm("Delete this saved Gmail query?")) return;
    await supabase.from("gmail_import_queries").delete().eq("id", id);
    loadQueries();
  };

  const runNow = async (q: SavedQuery) => {
    if (!activeOrgId) return;
    setRunQueryId(q.id);
    setPreviewFor(q);
    setPreview([]);
    try {
      const res = await callGmail<{ links: PreviewLink[] }>({
        action: "preview",
        organizationId: activeOrgId,
        query: q.query,
        maxMessages: 25,
      });
      setPreview(res.links);
      setSelected(
        Object.fromEntries(res.links.filter((l) => !l.alreadyImported).map((l) => [`${l.messageId}|${l.url}`, true])),
      );
      if (res.links.length === 0) toast({ title: "No links found for that query" });
    } catch (e) {
      const message = (e as Error).message;
      toast({
        title: message.includes("gmail_not_connected") ? "Connect Gmail first" : "Gmail search failed",
        description: message.includes("gmail_not_connected") ? undefined : message,
        variant: "destructive",
      });
      setPreviewFor(null);
    } finally {
      setRunQueryId(null);
    }
  };

  const importSelected = async () => {
    if (!previewFor || !activeOrgId) return;
    const links = preview.filter((l) => selected[`${l.messageId}|${l.url}`]);
    if (links.length === 0) {
      toast({ title: "Nothing selected", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const res = await callGmail<{ created: number; skipped: number }>({
        action: "import",
        organizationId: activeOrgId,
        treeId: previewFor.tree_id,
        backlogId: previewFor.backlog_id,
        queryId: previewFor.id,
        links,
      });
      toast({
        title: `Imported ${res.created} work item${res.created === 1 ? "" : "s"}`,
        description: res.skipped ? `${res.skipped} already imported` : undefined,
      });
      setPreviewFor(null);
      setPreview([]);
      await reloadData();
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const treeName = (id: string) => backlogTrees[id]?.name ?? "(unknown tree)";
  const backlogName = (id: string) => backlogs[id]?.name ?? "(unknown backlog)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" /> Gmail link import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Connect your own Gmail account, save searches, and turn every link found in matching emails into a work item
          (one item per link, with the link attached as a hyperlink). Already-imported links are never duplicated.
        </p>

        <div className="flex items-center justify-between gap-3 border rounded-md p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Your Gmail account</p>
            <p className="text-xs text-muted-foreground truncate">
              {connected === null
                ? "Checking…"
                : connected
                  ? connectedEmail ?? "Connected"
                  : "Not connected"}
            </p>
          </div>
          {connected ? (
            <Button size="sm" variant="outline" onClick={disconnect}>
              <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={connect} disabled={connecting || connected === null}>
              {connecting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1" />}
              Connect Gmail
            </Button>
          )}
        </div>

        <div className="space-y-3 border rounded-md p-4">
          <p className="text-sm font-medium">Add a saved search</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="gmail-query-name">Name (optional)</Label>
              <Input
                id="gmail-query-name"
                placeholder="Newsletter links"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="gmail-query">Gmail search query</Label>
              <Input
                id="gmail-query"
                placeholder="from:newsletter@example.com is:unread newer_than:7d"
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
              />
            </div>
            <div>
              <Label>Backlog tree</Label>
              <Select
                value={newTree}
                onValueChange={(v) => {
                  setNewTree(v);
                  setNewBacklog("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tree" />
                </SelectTrigger>
                <SelectContent>
                  {trees.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Backlog</Label>
              <Select value={newBacklog} onValueChange={setNewBacklog} disabled={!newTree}>
                <SelectTrigger>
                  <SelectValue placeholder="Select backlog" />
                </SelectTrigger>
                <SelectContent>
                  {backlogsForTree(newTree).map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={addQuery} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Save search
          </Button>
        </div>

        <div className="space-y-3">
          {queries.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No saved Gmail searches yet.</p>
          )}
          {queries.map((q) => (
            <div key={q.id} className="border rounded-md p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{q.name || q.query}</p>
                  <p className="text-xs font-mono text-muted-foreground break-all">{q.query}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    → {treeName(q.tree_id)} / {backlogName(q.backlog_id)}
                  </p>
                  {q.last_run_at && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last run {new Date(q.last_run_at).toLocaleString()} — {q.last_run_status ?? "—"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => runNow(q)} disabled={runQueryId === q.id}>
                    {runQueryId === q.id ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 mr-1" />
                    )}
                    Run now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteQuery(q.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Switch checked={q.schedule_enabled} onCheckedChange={() => toggleSchedule(q)} />
                  <span className="text-xs text-muted-foreground">Run on a schedule</span>
                </div>
                <Select value={q.frequency} onValueChange={(v) => setFrequency(q, v as "hourly" | "daily")}>
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                  </SelectContent>
                </Select>
                {q.schedule_enabled && <Badge variant="secondary">Scheduled</Badge>}
              </div>

              {previewFor?.id === q.id && preview.length > 0 && (
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {preview.length} link{preview.length === 1 ? "" : "s"} found — pick what to import
                  </p>
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                    {preview.map((l) => {
                      const key = `${l.messageId}|${l.url}`;
                      return (
                        <label key={key} className="flex items-start gap-2 text-sm">
                          <Checkbox
                            checked={!!selected[key]}
                            disabled={l.alreadyImported}
                            onCheckedChange={(c) => setSelected((s) => ({ ...s, [key]: !!c }))}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{l.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              <LinkIcon className="w-3 h-3 inline mr-1" />
                              {l.url}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{l.subject}</span>
                            {l.alreadyImported && (
                              <Badge variant="secondary" className="mt-1">
                                Already imported
                              </Badge>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={importSelected} disabled={importing}>
                      {importing && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                      Import selected
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPreviewFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
