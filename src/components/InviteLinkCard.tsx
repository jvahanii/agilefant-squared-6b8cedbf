import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { createInviteLink, getInviteLink, inviteUrl, revokeInviteLink } from "@/lib/invites";

/**
 * Team settings: the organisation's invite link (lib/invites.ts), for owners
 * and admins. Anyone who opens it and signs up or in becomes a member.
 */
export function InviteLinkCard({ orgId }: { orgId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getInviteLink(orgId)
      .then((t) => !cancelled && setToken(t))
      .catch(() => !cancelled && setToken(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast({ title: "That didn't work", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const url = token ? inviteUrl(token) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" /> Invite link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Send this link to colleagues. Whoever opens it and signs up, or signs in, joins this organisation as a
          member.
        </p>
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : token ? (
          <>
            <div className="flex gap-2">
              <Input readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <Button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() => toast({ title: "Invite link copied" }))
                    .catch(() => toast({ title: "Copy it from the box instead", variant: "destructive" }))
                }
              >
                Copy
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setToken(await createInviteLink(orgId));
                    toast({ title: "New invite link made", description: "The old link no longer works." });
                  })
                }
              >
                New link
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await revokeInviteLink(orgId);
                    setToken(null);
                    toast({ title: "Invite link turned off" });
                  })
                }
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <Button type="button" disabled={busy} onClick={() => void run(async () => setToken(await createInviteLink(orgId)))}>
            Make an invite link
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
