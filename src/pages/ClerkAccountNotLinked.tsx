import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UnlinkedClerkAccount } from "@/hooks/useAuth";

interface Props {
  account: UnlinkedClerkAccount;
  onSignOut: () => Promise<void>;
}

/**
 * Shown when Clerk authenticated somebody but no profile could be linked.
 *
 * Reaching this means link_clerk_identity() was already tried and failed, so
 * it is a genuine dead end rather than a stage of signing in: almost always an
 * unverified email address, occasionally the lookup itself failing. A Clerk
 * account with no profile reaches no data at all, so say that plainly — and
 * show the id needed to link it by hand — rather than dropping the user into
 * an app that silently contains nothing.
 */
export default function ClerkAccountNotLinked({ account, onSignOut }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">We couldn&apos;t finish setting up your account</h1>
            <p className="text-sm text-muted-foreground">
              {account.email
                ? `You're signed in to Clerk as ${account.email}, but this sign-in could not be connected to an Agilefant² profile, so none of your data is reachable.`
                : "You're signed in to Clerk, but this sign-in could not be connected to an Agilefant² profile, so none of your data is reachable."}
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Clerk user id — needed to link this account:</p>
          <code className="block select-all break-all rounded bg-muted px-3 py-2 text-xs">
            {account.clerkUserId}
          </code>
        </div>

        {account.error && <p className="text-xs text-destructive">Reason: {account.error}.</p>}

        <p className="text-xs text-muted-foreground">
          The usual cause is an unverified email address: Clerk will only hand over an address it
          has confirmed. Verify it in Clerk and sign in again. Otherwise this may be a connection
          problem, and reloading is worth a try.
        </p>

        <div className="pt-2">
          <Button variant="outline" size="sm" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
