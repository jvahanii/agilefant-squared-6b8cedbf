import { useWebAnalytics } from "@/lib/webAnalytics";
import { Link } from "react-router-dom";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { clerkEnabled } from "@/lib/clerkBridge";
import { Info, ListChecks, UserPlus } from "lucide-react";
import { loadTryList } from "@/lib/tryList";
import { pendingInvite } from "@/lib/invites";

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
  useWebAnalytics();
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

  // What the visitor made in the try-out, waiting for the new account (2026-11-16).
  const tried = mode === "sign-up" ? (loadTryList()?.length ?? 0) : 0;
  // An invite link opened on the way here (lib/invites.ts).
  const invite = pendingInvite();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Whose sign-up this is, and the way back: Clerk's own card says only
            "Create your account". A plain link, as the front page is a page of its own. */}
        <a href="/" className="flex items-center justify-center gap-2 font-semibold tracking-tight">
          <img src="/agilefant-shield.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
          <span>
            Agilefant<sup className="text-primary">2</sup>
          </span>
        </a>

        {/* For people who had an account before the sign-in moved to Clerk:
            signing in here carries it across. Nothing to a newcomer signing up,
            so only on the sign-in page. */}
        {mode === "sign-in" && (
          <div role="status" className="flex items-start gap-3 rounded-md border bg-muted/60 px-4 py-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p>
              Agilefant has a new enterprise grade sign-in with SSO readiness for those who needed it. Sign in with the
              same email address as always — through Google, or by creating a password here — and your account, teams
              and work items come with you automatically.
            </p>
          </div>
        )}

        {invite && (
          <div role="status" className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              {mode === "sign-up" ? "Sign up" : "Sign in"} and you'll join{" "}
              <strong>{invite.organizationName || "the organisation that invited you"}</strong>.
            </p>
          </div>
        )}

        {tried > 0 && (
          <div role="status" className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              {tried === 1
                ? "The item you added in the try-out will be waiting in your new account."
                : `The ${tried} items you added in the try-out will be waiting in your new account.`}
            </p>
          </div>
        )}

        <div className="flex justify-center">
          {mode === "sign-up" ? (
            <SignUp routing="hash" signInUrl="/auth" appearance={appearance} />
          ) : (
            <SignIn routing="hash" signUpUrl="/auth/sign-up" appearance={appearance} />
          )}
        </div>

        {mode === "sign-up" && (
          <div className="space-y-1 text-center text-xs text-muted-foreground">
            <p>
              By creating an account you agree to the{" "}
              <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">
                terms and privacy notice
              </Link>
              .
            </p>
            {tried === 0 && !invite && (
              <p>
                Not sure yet?{" "}
                <a href="/try" className="underline underline-offset-4 hover:text-foreground">
                  Try it first
                </a>
                , no account needed.
              </p>
            )}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/user-guide" className="hover:text-foreground underline underline-offset-4 transition-colors">
            View User Guide
          </Link>
          {" · "}
          <Link to="/terms" className="hover:text-foreground underline underline-offset-4 transition-colors">
            Terms and privacy
          </Link>

        </p>
      </div>
    </div>
  );
}
