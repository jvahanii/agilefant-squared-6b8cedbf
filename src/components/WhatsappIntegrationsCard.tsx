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
import { MessageCircle, Trash2, Plus, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";

interface Integration {
  id: string;
  organization_id: string;
  label: string;
  tree_id: string;
  backlog_id: string;
  chat_id: string | null;
  webhook_secret: string;
  enabled: boolean;
  split_on_newline: boolean;
  split_on_space: boolean;
  split_delimiters: string;
  min_fragment_length: number;
}

/** Mirrors the splitting logic used by the whatsapp-message-received function. */
function splitPreview(body: string, i: Integration): string[] {
  const chars = new Set<string>();
  if (i.split_on_newline) { chars.add("\n"); chars.add("\r"); }
  if (i.split_on_space) { chars.add(" "); chars.add("\t"); }
  for (const ch of i.split_delimiters ?? "") {
    if (!ch.trim()) continue;
    chars.add(ch);
  }
  const min = Math.max(1, Number(i.min_fragment_length) || 1);
  const escape = (ch: string) => ch.replace(/[\\\]^-]/g, (m) => `\\${m}`);
  const raw = chars.size === 0
    ? [body]
    : body.split(new RegExp(`[${[...chars].map(escape).join("")}]`));
  return raw.map((s) => s.trim()).filter((s) => s.length >= min);
}

const BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-message-received`;

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

export function WhatsappIntegrationsCard() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);

  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // New integration draft
  const [draftLabel, setDraftLabel] = useState("Kauppalista");
  const [draftTree, setDraftTree] = useState("");
  const [draftBacklog, setDraftBacklog] = useState("");
  const [draftChat, setDraftChat] = useState("");

  const orgTrees = Object.values(backlogTrees);
  const backlogsByTree = (treeId: string) =>
    Object.values(backlogs).filter((b) => b.treeId === treeId);

  const load = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_integrations")
      .select("*")
      .eq("organization_id", activeOrgId)
      .order("created_at");
    setItems((data ?? []) as Integration[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const add = async () => {
    if (!activeOrgId) return;
    if (!draftTree || !draftBacklog) {
      toast({ title: "Pick a tree and backlog", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("whatsapp_integrations").insert({
      organization_id: activeOrgId,
      label: draftLabel.trim() || "WhatsApp",
      tree_id: draftTree,
      backlog_id: draftBacklog,
      chat_id: draftChat.trim() || null,
      webhook_secret: randomSecret(),
    });
    if (error) {
      toast({ title: "Failed to add", description: error.message, variant: "destructive" });
      return;
    }
    setDraftLabel("Kauppalista");
    setDraftTree("");
    setDraftBacklog("");
    setDraftChat("");
    load();
  };

  const rotateSecret = async (id: string) => {
    const { error } = await supabase
      .from("whatsapp_integrations")
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
    await supabase.from("whatsapp_integrations").update({ enabled: !i.enabled }).eq("id", i.id);
    load();
  };

  const updateChat = async (id: string, value: string) => {
    await supabase.from("whatsapp_integrations").update({ chat_id: value.trim() || null }).eq("id", id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this WhatsApp integration?")) return;
    await supabase.from("whatsapp_integrations").delete().eq("id", id);
    load();
  };

  const urlFor = (_i: Integration) => BASE_URL;
  const headerFor = (i: Integration) => `X-Webhook-Token: ${i.webhook_secret}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="w-4 h-4" /> WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Forward a WhatsApp chat into a backlog. Every message becomes an "In Progress" work item at the top of the
          chosen backlog, and <strong>each line of a message becomes its own item</strong>, so a list posted in one go
          arrives as separate tasks in the order written.
        </p>
        <p className="text-sm text-muted-foreground">
          The simplest source is an Android phone running a notification-forwarding app such as{" "}
          <em>MacroDroid</em> or <em>Tasker</em>: trigger on a WhatsApp notification, restrict it to the chat you want,
          and POST to the URL below with <code>Content-Type: text/plain</code> and the message text as the raw body.
          Sending the text raw rather than as JSON matters — an unescaped quote or line break in JSON would make the
          request unparseable and the message would be dropped.
        </p>
        <p className="text-sm text-muted-foreground">
          Two details are worth getting right. Send the notification's <em>text lines</em> rather than its summary text:
          the summary concatenates unread messages, so the same message keeps arriving glued to different neighbours,
          while text lines gives one message per line and each becomes its own item. And pass the sender or group name
          as a <code>?from=</code> query parameter, not a header — headers are ASCII-only, and Android refuses to send
          the request at all if the name contains an accented character, which group titles routinely do.
        </p>
        <p className="text-sm text-muted-foreground">
          A hosted bridge (whapi.cloud and similar) also works and can post JSON instead; note those are paid, and the
          official WhatsApp Business API cannot read group chats at all. Whichever you use, add the{" "}
          <code>X-Webhook-Token</code> header below so it can authenticate. Chat ID only filters JSON senders that
          include one — leave it blank for the notification route, where the phone decides which chat to forward.
        </p>

        <div className="border rounded-md p-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add new</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Label</Label>
              <Input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Chat ID (optional)</Label>
              <Input
                placeholder="1203...@g.us or 1555...@s.whatsapp.net"
                value={draftChat}
                onChange={(e) => setDraftChat(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Tree</Label>
              <Select
                value={draftTree}
                onValueChange={(v) => { setDraftTree(v); setDraftBacklog(""); }}
              >
                <SelectTrigger><SelectValue placeholder="Select tree" /></SelectTrigger>
                <SelectContent>
                  {orgTrees.map((tr) => (
                    <SelectItem key={tr.id} value={tr.id}>{tr.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Backlog</Label>
              <Select
                value={draftBacklog}
                onValueChange={setDraftBacklog}
                disabled={!draftTree}
              >
                <SelectTrigger><SelectValue placeholder="Select backlog" /></SelectTrigger>
                <SelectContent>
                  {draftTree && backlogsByTree(draftTree).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={add} disabled={loading}>
              <Plus className="w-4 h-4 mr-1" /> Add integration
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No WhatsApp integrations yet.</p>
          )}
          {items.map((i) => {
            const isRevealed = !!revealed[i.id];
            const treeName = backlogTrees[i.tree_id]?.name ?? i.tree_id;
            const backlogName = backlogs[i.backlog_id]?.name ?? i.backlog_id;
            const fullUrl = urlFor(i);
            const fullHeader = headerFor(i);
            return (
              <div key={i.id} className="border rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageCircle className="w-4 h-4 shrink-0" />
                    <span className="font-medium text-sm truncate">{i.label}</span>
                    {!i.enabled && <Badge variant="secondary">Disabled</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={i.enabled} onCheckedChange={() => toggleEnabled(i)} />
                    <Button size="sm" variant="ghost" onClick={() => remove(i.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 text-sm">
                  <div className="text-muted-foreground text-xs">
                    Target: <span className="text-foreground">{treeName} / {backlogName}</span>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-muted-foreground shrink-0 text-xs sm:w-24">Webhook URL</span>
                    <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{fullUrl}</code>
                    <div className="flex justify-end sm:block">
                      <Button size="sm" variant="ghost" onClick={() => copy(fullUrl, "URL")}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-muted-foreground shrink-0 text-xs sm:w-24">Auth header</span>
                    <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">
                      {isRevealed ? fullHeader : `X-Webhook-Token: ${"•".repeat(16)}`}
                    </code>
                    <div className="flex flex-wrap justify-end gap-1 sm:flex-nowrap sm:gap-0">
                      <Button size="sm" variant="ghost" onClick={() => setRevealed((r) => ({ ...r, [i.id]: !isRevealed }))}>
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => copy(i.webhook_secret, "Token")}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => rotateSecret(i.id)} title="Rotate secret">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-muted-foreground shrink-0 text-xs sm:w-24">Chat ID filter</span>
                    <Input
                      className="h-8 min-w-0 text-xs"
                      placeholder="(any chat)"
                      defaultValue={i.chat_id ?? ""}
                      onBlur={(e) => {
                        if ((e.target.value.trim() || null) !== i.chat_id) updateChat(i.id, e.target.value);
                      }}
                    />
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
