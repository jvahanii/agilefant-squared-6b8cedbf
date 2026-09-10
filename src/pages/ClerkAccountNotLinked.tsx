import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UnlinkedClerkAccount } from "@/hooks/useAuth";

interface Props {
  account: UnlinkedClerkAccount;
  onSignOut: () => Promise<void>;
}

/**
 * Shown when Clerk authenticated somebody the database doesn't recognise.
 *
 * This is a real state during the migration, not an error: a Clerk account
 * reaches no data at all until a profiles row claims its id via
 * `profiles.clerk_id`, and until then every query returns empty. Saying so
 * plainly — and showing the id that has to be linked — beats dropping the user
 * into an app that silently contains nothing.
 */
export default function ClerkAccountNotLinked({ account, onSignOut }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">This account isn&apos;t linked yet</h1>
            <p className="text-sm text-muted-foreground">
              {account.email
                ? `You're signed in to Clerk as ${account.email}, but no Agilefant² profile claims this account yet, so none of your data is reachable.`
                : "You're signed in to Clerk, but no Agilefant² profile claims this account yet, so none of your data is reachable."}
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Clerk user id — needed to link this account:</p>
          <code className="block select-all break-all rounded bg-muted px-3 py-2 text-xs">
            {account.clerkUserId}
          </code>
        </div>

        {account.error && (
          <p className="text-xs text-destructive">
            The lookup itself failed: {account.error}. This may be a connection problem rather than a
            missing link — reloading is worth a try.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button variant="outline" size="sm" onClick={() => void onSignOut()}>
            Sign out
          </Button>
          <Link
            to="/auth/legacy"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Use the previous sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
