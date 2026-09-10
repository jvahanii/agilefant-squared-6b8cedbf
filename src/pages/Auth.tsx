import { Link } from "react-router-dom";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { clerkEnabled } from "@/lib/clerkBridge";
import { Info } from "lucide-react";

/**
 * Sign-in and sign-up via Clerk.
 *
 * Clerk own components are used rather than hand-built forms so that email,
 * password and Google all follow whatever the Clerk instance is configured for
 * — including the custom Google credentials — without this page needing to know.
 *
 * Both modes share this file because they differ only in which Clerk component
 * renders: duplicating the banner and the footer links into a second page would
 * mean two places to keep in step for the length of the migration.
 *
 * Production Clerk keys are bound to agilefant.org and cannot be exercised
 * locally, so this page is only ever seen for the first time on the deployed
 * site.
 */
export default function Auth({ mode = "sign-in" }: { mode?: "sign-in" | "sign-up" }) {
  const appearance = { elements: { rootBox: "w-full", card: "w-full shadow-none border" } };

  // Clerk is the only way in now, and its components throw outside
  // ClerkProvider — which main.tsx only mounts when a publishable key is
  // configured. Say so plainly rather than crashing the page: a build without
  // the key is misconfigured, not a build with a different sign-in.
  if (!clerkEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-md border px-4 py-3 text-sm" role="alert">
          <p className="font-medium">Sign-in is not configured</p>
          <p className="mt-1 text-muted-foreground">
            This build has no Clerk publishable key, so there is no way to sign in. Set
            VITE_CLERK_PUBLISHABLE_KEY wherever the site is built.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Was a warning against creating accounts, which is now the opposite of
            what a returning user has to do: signing in here is what carries an
            existing account across. Hence an informational tone, not a caution. */}
        <div role="status" className="flex items-start gap-3 rounded-md border bg-muted/60 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            Agilefant has a new enterprise grade sign-in with SSO readiness for those who needed it. Sign in with the
            same email address as always — through Google, or by creating a password here — and your account, teams and
            work items come with you automatically.
          </p>
        </div>

        <div className="flex justify-center">
          {mode === "sign-up" ? (
            <SignUp routing="hash" signInUrl="/auth" appearance={appearance} />
          ) : (
            <SignIn routing="hash" signUpUrl="/auth/sign-up" appearance={appearance} />
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/user-guide" className="hover:text-foreground underline underline-offset-4 transition-colors">
            View User Guide
          </Link>

        </p>
      </div>
    </div>
  );
}
