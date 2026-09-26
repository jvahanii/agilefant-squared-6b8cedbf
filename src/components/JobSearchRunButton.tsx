import { useEffect, useState } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgStore } from "@/store/orgStore";
import { useScramble } from "@/contexts/ScrambleContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SavedSearchPicker } from "@/components/SavedSearchPicker";
import { scrollListWithArrows } from "@/lib/scrollListWithArrows";
import type { RunnableSearch } from "@/lib/gmailConnector";

type JobSearch = RunnableSearch & { name: string | null };

/**
 * Run a saved job-ad search from the app header, without leaving the backlog.
 *
 * The same picker as Bells & Whistles, in a dialog, so imported items appear in
 * the list behind it. Shown only to a superuser — a shortcut for developing the
 * import, not a feature for everyone yet — and only in an organization that has
 * a saved job search to run.
 */
export function JobSearchRunButton() {
  const { isSuperuser } = useScramble();
  const roleOverride = useOrgStore((s) => s.roleOverride);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const [searches, setSearches] = useState<JobSearch[]>([]);
  const [running, setRunning] = useState<JobSearch | null>(null);
  const [runToken, setRunToken] = useState(0);

  // While previewing another role, a superuser sees what that role sees.
  const allowed = isSuperuser && !roleOverride;

  useEffect(() => {
    if (!allowed || !activeOrgId) {
      setSearches([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("gmail_import_queries")
      .select("id, name, query, tree_id, backlog_id")
      .eq("organization_id", activeOrgId)
      .eq("import_mode", "jobs")
      .order("created_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("job searches for header failed", error.message);
          return;
        }
        setSearches((data ?? []) as JobSearch[]);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, activeOrgId]);

  if (!allowed || !activeOrgId || searches.length === 0) return null;

  const run = (search: JobSearch) => {
    setRunning(search);
    setRunToken((n) => n + 1);
  };

  const buttonClass =
    "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors";
  const label = (
    <>
      <BriefcaseBusiness className="w-3.5 h-3.5 text-primary" />
      <span className="hidden md:inline">Run job search</span>
    </>
  );

  return (
    <>
      {searches.length === 1 ? (
        <button className={buttonClass} onClick={() => run(searches[0])} title={`Run "${searches[0].name ?? "job search"}"`}>
          {label}
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={buttonClass} title="Run a saved job search">
              {label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {searches.map((search) => (
              <DropdownMenuItem key={search.id} className="text-xs" onSelect={() => run(search)}>
                {search.name ?? search.query}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={!!running} onOpenChange={(open) => !open && setRunning(null)}>
        {/* Wide: a job ad's employer and title are what the decision rests on,
            and they are never cut short, so the rows need the room. */}
        {/* Up and down scroll the list of job ads, wherever focus is in the dialog. */}
        <DialogContent className="max-w-4xl" onKeyDown={scrollListWithArrows}>
          <DialogHeader>
            <DialogTitle>{running?.name ?? "Job search"}</DialogTitle>
            <DialogDescription className="break-all text-xs">{running?.query}</DialogDescription>
          </DialogHeader>
          {running && (
            <SavedSearchPicker
              key={runToken}
              search={running}
              mode="jobs"
              organizationId={activeOrgId}
              onClose={() => setRunning(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
