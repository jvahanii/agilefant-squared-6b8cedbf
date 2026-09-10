import { Link } from "react-router-dom";
import { SignIn } from "@clerk/clerk-react";
import { AlertTriangle } from "lucide-react";

/**
 * Sign-in via Clerk.
 *
 * Clerk's own component is used rather than hand-built forms so that email,
 * password and Google all follow whatever the Clerk instance is configured for
 * — including the custom Google credentials — without this page needing to know.
 *
 * The previous Supabase sign-in stays reachable at /auth/legacy. Production
 * Clerk keys are bound to agilefant.org and cannot be exercised locally, so
 * this page is only ever seen for the first time on the deployed site; the old
 * route is the way back in if it misbehaves.
 */
export default function Auth() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            We&apos;re moving to Clerk authentication, and strongly suggest you don&apos;t create new
            accounts until this notification disappears.
          </p>
        </div>

        <div className="flex justify-center">
          <SignIn
            routing="hash"
            signUpUrl="/auth"
            appearance={{ elements: { rootBox: "w-full", card: "w-full shadow-none border" } }}
          />
        </div>

        <p className="text-center text-xs text-muted-foreground space-x-3">
          <Link to="/user-guide" className="hover:text-foreground underline underline-offset-4 transition-colors">
            View User Guide
          </Link>
          <Link to="/auth/legacy" className="hover:text-foreground underline underline-offset-4 transition-colors">
            Use the previous sign-in
          </Link>
        </p>
      </div>
    </div>
  );
}
