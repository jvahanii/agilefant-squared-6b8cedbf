import { useState } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { explainGmailError, gmailCallbackUrl, type OAuthStatus } from "@/lib/gmailOAuth";

type OwnStatus = Extract<OAuthStatus, { mode: "own" }>;

async function callConnector(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("gmail-connector", { body });
  if (error) {
    let details = error.message;
    const context = (error as { context?: { text?: () => Promise<string> } }).context;
    if (context?.text) {
      try {
        details = await context.text();
      } catch {
        /* keep the original message */
      }
    }
    throw new Error(details);
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
}

/**
 * The organization's own Google OAuth client, for connecting Gmail.
 *
 * Shown only to organizations that must bring one. The secret goes to the
 * server once, is encrypted there, and is never sent back — this shows only the
 * client ID, which Google treats as public anyway.
 */
export function GoogleOAuthClientSection({
  organizationId,
  status,
  onChanged,
}: {
  organizationId: string;
  status: OwnStatus;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(!status.configured);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const redirectUri = gmailCallbackUrl(window.location.origin);

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Could not copy", description: redirectUri });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await callConnector({ action: "set_oauth_client", organizationId, clientId, clientSecret });
      setClientSecret("");
      setEditing(false);
      toast({ title: "Google OAuth client saved", description: "Members can now connect Gmail." });
      onChanged();
    } catch (e) {
      toast({ title: "Could not save the client", description: explainGmailError((e as Error).message), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        "Remove this organization's Google OAuth client? Every Gmail connection made with it is removed too, and scheduled imports stop until a client is added again.",
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await callConnector({ action: "remove_oauth_client", organizationId });
      toast({ title: "Google OAuth client removed" });
      onChanged();
    } catch (e) {
      toast({ title: "Could not remove the client", description: explainGmailError((e as Error).message), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Google OAuth client</p>
          <p className="text-xs text-muted-foreground">
            This organization connects Gmail through its own Google OAuth client.{" "}
            <a
              href="/user-guide/job-ads#google-oauth"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              How to create one
            </a>
          </p>
        </div>
      </div>

      {status.configured && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-all font-mono text-xs">{status.clientId}</p>
          {status.canManage && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={saving}>
                Replace
              </Button>
              <Button size="sm" variant="outline" onClick={remove} disabled={saving}>
                Remove
              </Button>
            </div>
          )}
        </div>
      )}

      {!status.configured && !status.canManage && (
        <p className="text-sm">
          An owner or admin of this organization needs to add a Google OAuth client before anyone can connect Gmail.
        </p>
      )}

      {editing && status.canManage && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="oauth-redirect">Authorized redirect URI</Label>
            <p className="text-xs text-muted-foreground">Add exactly this to the OAuth client in Google Cloud.</p>
            <div className="mt-1 flex gap-2">
              <Input id="oauth-redirect" value={redirectUri} readOnly className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={copyRedirect} aria-label="Copy redirect URI">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="oauth-client-id">Client ID</Label>
              <Input
                id="oauth-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="…apps.googleusercontent.com"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div>
              <Label htmlFor="oauth-client-secret">Client secret</Label>
              <Input
                id="oauth-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
              />
            </div>
          </div>
          {status.configured && (
            <p className="text-xs text-muted-foreground">
              A new secret for the same client keeps existing Gmail connections. A different client ID removes them, and
              everyone connects again.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving || !clientId.trim() || !clientSecret.trim()}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save client
            </Button>
            {status.configured && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setClientId("");
                  setClientSecret("");
                }}
                disabled={saving}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
