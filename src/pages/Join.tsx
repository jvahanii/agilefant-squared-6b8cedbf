import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { lookUpInvite, rememberInvite } from "@/lib/invites";

/**
 * /join/<token>: an invite link (lib/invites.ts). It says which organisation
 * it is for and leads to sign-up or sign-in; the app accepts the invite once
 * the person is signed in. No visitor counting here: the address holds the
 * link's secret.
 */
export default function Join() {
  const { token = "" } = useParams<{ token: string }>();
  const [state, setState] = useState<{ status: "loading" } | { status: "ok"; name: string } | { status: "gone" } | { status: "error" }>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    lookUpInvite(token)
      .then((name) => {
        if (cancelled) return;
        if (name === null) {
          setState({ status: "gone" });
          return;
        }
        rememberInvite({ token, organizationName: name });
        setState({ status: "ok", name });
      })
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md space-y-6 text-center">
        <a href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <img src="/agilefant-shield.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
          <span>
            Agilefant<sup className="text-primary">2</sup>
          </span>
        </a>

        {state.status === "loading" && <p className="text-sm text-muted-foreground">Opening the invite…</p>}

        {state.status === "ok" && (
          <div className="space-y-5 rounded-lg border bg-card p-6 shadow-sm">
            <UserPlus className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold">You're invited to join {state.name}</h1>
              <p className="text-sm text-muted-foreground">
                Sign up, or sign in if you already have an account, and you'll be in {state.name} on Agilefant.
              </p>
            </div>
            {/* Plain links: sign-in is a page of its own. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <a
                href="/auth/sign-up"
                className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90"
              >
                Sign up to join
              </a>
              <a href="/auth" className="rounded-md border px-4 py-2 font-medium hover:bg-muted">
                I have an account: sign in
              </a>
            </div>
          </div>
        )}

        {state.status === "gone" && (
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">This invite link no longer works</h1>
            <p className="text-sm text-muted-foreground">Ask whoever sent it for a new one.</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">The invite could not be opened just now</h1>
            <p className="text-sm text-muted-foreground">Please try the link again in a moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}
