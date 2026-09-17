import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from "@/lib/currentUser";
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
import { Mail, Trash2, Plus, Play, Loader2, Unplug } from "lucide-react";
import { GoogleOAuthClientSection } from "@/components/GoogleOAuthClientSection";
import { SavedSearchPicker } from "@/components/SavedSearchPicker";
import { canConnectGmail, explainGmailError, type OAuthStatus } from "@/lib/gmailOAuth";
import { callGmail, type ImportMode } from "@/lib/gmailConnector";
import {
  defaultJobQuery,
  withLookback,
  withUnreadOnly,
  isUnreadOnly,
  DEFAULT_LOOKBACK,
  LOOKBACK_OPTIONS,
} from "../../supabase/functions/_shared/jobSources";

// Re-exported so existing importers of ImportMode from this module keep working.
export type { ImportMode };

const COPY: Record<
  ImportMode,
  {
    title: string;
    blurb: string;
    queryLabel: string;
    placeholder: string;
    startingQuery: string;
    empty: string;
    namePlaceholder: string;
  }
> = {
  links: {
    title: "Gmail link import",
    blurb:
      "Connect your own Gmail account, save searches, and turn every link found in matching emails into a work item (one item per link, with the link attached as a hyperlink). Already-imported links are never duplicated.",
    queryLabel: "Gmail search query",
    placeholder: "from:newsletter@example.com is:unread newer_than:7d",
    startingQuery: "",
    empty: "No saved Gmail searches yet.",
    namePlaceholder: "Newsletter links",
  },
  jobs: {
    title: "Job ad import",
    blurb:
      "Turn job alert emails into backlog items — one item per posting. Site navigation, editorial links and previously-seen roles in a digest are left out, and the same posting arriving from several alerts is imported once.",
    queryLabel: "Gmail search query for job alerts",
    placeholder: "label:Job\u00a0ads newer_than:30d",
    startingQuery: defaultJobQuery(),
    empty: "No saved job alert searches yet.",
    namePlaceholder: "Name of this search",
  },
};

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
  import_mode: ImportMode;
  /** Hour of day a daily run should happen; null means "whenever a day has passed". */
  run_at_hour: number | null;
  run_at_timezone: string | null;
}

/** The zone the browser is in, which is the one the chosen hour is meant in. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function GmailIntegrationsCard({ mode = "links" }: { mode?: ImportMode }) {
  const copy = COPY[mode];
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [oauth, setOauth] = useState<OAuthStatus | null>(null);

  const [queries, setQueries] = useState<SavedQuery[]>([]);
  // Seeded rather than blank so the job-ad card is usable without knowing
  // Gmail search syntax; still fully editable.
  const [newQuery, setNewQuery] = useState(COPY[mode].startingQuery);
  const [lookback, setLookback] = useState<string>(DEFAULT_LOOKBACK);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTree, setNewTree] = useState("");
  const [newBacklog, setNewBacklog] = useState("");

  // The search whose picker is open, and a counter so pressing Run now again
  // remounts the picker and searches afresh.
  const [previewFor, setPreviewFor] = useState<SavedQuery | null>(null);
  const [runToken, setRunToken] = useState(0);

  const popupRef = useRef<Window | null>(null);

  const trees = Object.values(backlogTrees);
  const backlogsForTree = (treeId: string) => Object.values(backlogs).filter((b) => b.treeId === treeId);

  // Per organization: each decides how Gmail is reached, so switching
  // organization can change both the connection and whether one is possible.
  const loadStatus = useCallback(async () => {
    if (!activeOrgId) return;
    setConnected(null);
    try {
      const res = await callGmail<{ connected: boolean; email: string | null; oauth: OAuthStatus }>({
        action: "status",
        organizationId: activeOrgId,
      });
      setConnected(res.connected);
      setConnectedEmail(res.email);
      setOauth(res.oauth);
    } catch (e) {
      setConnected(false);
      setOauth(null);
      console.error("gmail status failed", e);
    }
  }, [activeOrgId]);

  const loadQueries = useCallback(async () => {
    if (!activeOrgId) return;
    const { data, error } = await supabase
      .from("gmail_import_queries")
      .select("*")
      .eq("organization_id", activeOrgId)
      .eq("import_mode", mode)
      .order("created_at");
    if (error) {
      console.error("failed to load gmail queries", error.message);
      return;
    }
    setQueries((data ?? []) as SavedQuery[]);
  }, [activeOrgId, mode]);

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
      const payload = event.data as { source?: string; code?: string; state?: string; error?: string } | null;
      if (!payload || payload.source !== "gmail-oauth") return;
      popupRef.current?.close();
      if (payload.error || !payload.code) {
        setConnecting(false);
        toast({ title: "Gmail connection cancelled", description: payload.error ?? undefined, variant: "destructive" });
        return;
      }
      if (!activeOrgId) return;
      try {
        const res = await callGmail<{ email: string | null }>({
          action: "exchange",
          organizationId: activeOrgId,
          code: payload.code,
          state: payload.state ?? undefined,
        });
        setConnected(true);
        setConnectedEmail(res.email);
        toast({ title: "Gmail connected", description: res.email ?? undefined });
      } catch (e) {
        toast({
          title: "Could not finish connecting",
          description: explainGmailError((e as Error).message),
          variant: "destructive",
        });
      } finally {
        setConnecting(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activeOrgId]);

  const connect = async () => {
    if (!activeOrgId) return;
    setConnecting(true);
    try {
      const returnUrl = `${window.location.origin}/gmail-callback.html`;
      const res = await callGmail<{ authorizationUrl: string }>({
        action: "start",
        organizationId: activeOrgId,
        returnUrl,
      });
      popupRef.current = window.open(res.authorizationUrl, "gmail-oauth", "width=520,height=680");
      if (!popupRef.current) {
        setConnecting(false);
        toast({ title: "Popup blocked", description: "Allow popups and try again.", variant: "destructive" });
      }
    } catch (e) {
      setConnecting(false);
      toast({
        title: "Could not start Gmail connection",
        description: explainGmailError((e as Error).message),
        variant: "destructive",
      });
    }
  };

  const disconnect = async () => {
    try {
      if (!activeOrgId) return;
      await callGmail({ action: "disconnect", organizationId: activeOrgId });
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
    const currentUser = await getCurrentUser();
    if (!currentUser) return;
    const { error } = await supabase.from("gmail_import_queries").insert({
      organization_id: activeOrgId,
      user_id: currentUser.id,
      name: newName.trim() || null,
      query,
      tree_id: newTree,
      backlog_id: newBacklog,
      import_mode: mode,
    });
    if (error) {
      toast({ title: "Failed to save query", description: error.message, variant: "destructive" });
      return;
    }
    setNewQuery(withUnreadOnly(withLookback(copy.startingQuery, lookback), unreadOnly));
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

  // The hour is stored with the zone it was chosen in, not folded into UTC, so
  // that 08:00 stays 08:00 when the clocks change.
  const setRunAtHour = async (q: SavedQuery, hour: number | null) => {
    const { error } = await supabase
      .from("gmail_import_queries")
      .update({ run_at_hour: hour, run_at_timezone: hour === null ? null : browserTimezone() })
      .eq("id", q.id);
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

  // The search and the picker live in SavedSearchPicker, shared with the
  // header's Run job search dialog.
  const runNow = (q: SavedQuery) => {
    setPreviewFor(q);
    setRunToken((n) => n + 1);
  };

  const treeName = (id: string) => backlogTrees[id]?.name ?? "(unknown tree)";
  const backlogName = (id: string) => backlogs[id]?.name ?? "(unknown backlog)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mail className="w-4 h-4" /> {copy.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {copy.blurb}
          {mode === "jobs" && (
            <>
              {" "}
              <a
                href="/user-guide/job-ads"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Read the guide
              </a>
            </>
          )}
        </p>

        {oauth?.mode === "own" && activeOrgId && (
          <GoogleOAuthClientSection
            // Remounted when a client appears or goes, so the form opens again
            // for a manager the moment there is nothing configured.
            key={`${activeOrgId}:${oauth.configured}`}
            organizationId={activeOrgId}
            status={oauth}
            onChanged={loadStatus}
          />
        )}

        <div className="flex items-center justify-between gap-3 border rounded-md p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Your Gmail account</p>
            <p className="text-xs text-muted-foreground truncate">
              {connected === null
                ? "Checking…"
                : connected
                  ? connectedEmail ?? "Connected"
                  : canConnectGmail(oauth)
                    ? "Not connected"
                    : "Waiting for a Google OAuth client"}
            </p>
          </div>
          {connected ? (
            // Reconnect keeps the current connection until a new one replaces
            // it, which Disconnect then Connect does not: disconnecting drops
            // the stored key, and the connector will not renew a connection
            // whose key is gone. It is also the way to grant a permission the
            // app has started asking for, such as marking alerts read.
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="outline" onClick={connect} disabled={connecting} title="Sign in to Google again, for example to grant a new permission. The current connection keeps working until the new one is made.">
                {connecting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1" />}
                Reconnect
              </Button>
              <Button size="sm" variant="outline" onClick={disconnect}>
                <Unplug className="w-3.5 h-3.5 mr-1" /> Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={connect}
              disabled={connecting || connected === null || !canConnectGmail(oauth)}
            >
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
                placeholder={copy.namePlaceholder}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="gmail-query">{copy.queryLabel}</Label>
              <Input
                id="gmail-query"
                placeholder={copy.placeholder}
                value={newQuery}
                onChange={(e) => {
                  setNewQuery(e.target.value);
                  setUnreadOnly(isUnreadOnly(e.target.value));
                }}
              />
            </div>
            {mode === "jobs" && (
              <div>
                <Label htmlFor="gmail-lookback">How far back to look</Label>
                <Select
                  value={lookback}
                  onValueChange={(v) => {
                    setLookback(v);
                    // Rewrites only the newer_than clause, so edits survive.
                    setNewQuery((q) => withLookback(q, v));
                  }}
                >
                  <SelectTrigger id="gmail-lookback">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOOKBACK_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Sets <code>newer_than</code> in the query above. A saved query keeps whatever
                  window it was saved with.
                </p>
                <div className="flex items-center justify-between gap-3 mt-3">
                  <div>
                    <Label htmlFor="gmail-unread">Only unread</Label>
                    <p className="text-xs text-muted-foreground">
                      Adds <code>is:unread</code>. Reading an alert in Gmail then takes it out of
                      range, which makes this a rough substitute for "not seen yet".
                    </p>
                  </div>
                  <Switch
                    id="gmail-unread"
                    checked={unreadOnly}
                    onCheckedChange={(v) => {
                      setUnreadOnly(v);
                      setNewQuery((q) => withUnreadOnly(q, v));
                    }}
                  />
                </div>
              </div>
            )}
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
            <p className="text-sm text-muted-foreground italic">{copy.empty}</p>
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
                  <Button size="sm" variant="outline" onClick={() => runNow(q)}>
                    <Play className="w-3.5 h-3.5 mr-1" />
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
                {q.frequency === "daily" && (
                  <Select
                    value={q.run_at_hour === null ? "any" : String(q.run_at_hour)}
                    onValueChange={(v) => setRunAtHour(q, v === "any" ? null : Number(v))}
                  >
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any time</SelectItem>
                      {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>
                          {/* :07 is not decoration — the checker wakes at seven
                              minutes past, so that is when a run can happen. */}
                          {String(h).padStart(2, "0")}:07
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {q.schedule_enabled && <Badge variant="secondary">Scheduled</Badge>}
              </div>
              {q.schedule_enabled && q.frequency === "daily" && (
                <p className="text-xs text-muted-foreground">
                  {q.run_at_hour === null
                    ? "Runs once a day, at whatever hour it last ran. Pick a time to pin it."
                    : `Runs daily at ${String(q.run_at_hour).padStart(2, "0")}:07 ${q.run_at_timezone ?? browserTimezone()}.`}{" "}
                  Run now only opens the picker; it never moves the schedule.
                </p>
              )}

              {previewFor?.id === q.id && activeOrgId && (
                <div className="border-t pt-3">
                  <SavedSearchPicker
                    key={runToken}
                    search={q}
                    mode={mode}
                    organizationId={activeOrgId}
                    onClose={() => setPreviewFor(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Job ad import: the same machinery, its own saved queries and its own card. */
export function JobAdImportCard() {
  return <GmailIntegrationsCard mode="jobs" />;
}
