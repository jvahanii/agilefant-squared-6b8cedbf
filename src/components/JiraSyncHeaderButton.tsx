import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useOrgStore } from "@/store/orgStore";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { syncJiraNow } from "@/lib/jiraSyncNow";
import { TRexIcon } from "@/components/TRexIcon";

/**
 * "Sync now" in the app header, for the workshop: the same as the button on
 * the Jira card in Settings, without going there. Shown while the active
 * organization has a Jira connection switched on. Temporary — to be taken
 * out of the header again once the workshop is done.
 */
export function JiraSyncHeaderButton() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const project = useJiraIssuesStore((s) =>
    [...s.byList.values()].find((list) => list.organizationId === activeOrgId)?.projectKey,
  );
  const [busy, setBusy] = useState(false);
  if (!activeOrgId || !project) return null;

  const sync = async () => {
    setBusy(true);
    await syncJiraNow(activeOrgId);
    setBusy(false);
  };

  return (
    <button
      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors disabled:opacity-60"
      onClick={sync}
      disabled={busy}
      title={`Sync now with Jira project ${project}`}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400" />
      ) : (
        <TRexIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
      )}
      <span className="hidden md:inline">Sync Jira</span>
    </button>
  );
}
