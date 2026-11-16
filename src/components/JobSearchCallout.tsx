import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Briefcase, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rememberListToCopy } from "@/lib/listCopy";

const CLOSED_KEY = "agilefant.jobSearchCallout.closed";

function closedBefore(): boolean {
  try {
    return localStorage.getItem(CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * On a public link to a list of job ads, and nowhere else (2026-11-16): the
 * people reading one are job hunting themselves. It offers a copy of the
 * list in their own account (lib/listCopy.ts), which keeps receiving the
 * list's new ads and never removes any, so they need no Gmail connection of
 * their own. The copy is made in the app, after signing up or in.
 * Closing it is remembered in this browser.
 */
export function JobSearchCallout({ token }: { token: string }) {
  const [closed, setClosed] = useState(closedBefore);
  const navigate = useNavigate();
  if (closed) return null;

  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(CLOSED_KEY, "1");
    } catch {
      // Private windows: it comes back next time, which is fine.
    }
  };

  const copy = () => {
    rememberListToCopy(token);
    // Signed in, this goes straight to the app, which makes the copy.
    navigate("/auth/sign-up");
  };

  return (
    <aside
      aria-labelledby="job-search-callout-heading"
      className="relative mb-6 flex gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 pr-10 text-sm"
    >
      <Briefcase className="mt-0.5 hidden h-5 w-5 shrink-0 text-primary sm:block" aria-hidden="true" />
      <div className="space-y-3">
        <h2 id="job-search-callout-heading" className="font-semibold">
          Job hunting among this many ads? Manage it properly.
        </h2>
        <p className="text-muted-foreground">
          Agilefant is just the right tool for that, too. Copy this list into your own account and it keeps itself
          up to date: new ads are added as they appear here, and the ads you have already marked, edited or applied
          for stay as they are. Make your own prioritised list of the ones you are really into. Free forever.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" size="sm" onClick={copy}>
            <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Copy this list to my account
          </Button>
          <Link to="/" className="font-medium text-primary underline-offset-2 hover:underline">
            What is Agilefant?
            <ArrowRight className="ml-1 inline h-4 w-4 align-[-3px]" aria-hidden="true" />
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  );
}
