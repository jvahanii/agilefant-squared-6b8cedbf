import { AlertTriangle, Info } from "lucide-react";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { useExpectedJiraType } from "@/lib/expectedJiraType";

/**
 * The Jira issue an item is kept in step with, after its name: "INT-8 ·
 * Subtask", opening the issue in Jira. Nothing for an item that is not synced.
 *
 * Agilefant has no issue types; Jira's is shown because it decides what the
 * item may be moved under there.
 *
 * A move in Agilefant changes types in Jira a few seconds later, when the
 * sync has made Jira's moves. The type it will be is shown at once, faded and
 * slanted until Jira has it. So is a new item's — with its key to come,
 * "AF-… · Task" — until the sync has created its issue.
 *
 * An item deeper in Agilefant than the project's levels goes to Jira one
 * level flatter — a subtask beside its parent — and Agilefant keeps its own
 * hierarchy. Its tag carries an info sign saying so on hovering.
 *
 * Red with a warning sign while the sync could not send the item's last change
 * to Jira — a change Jira refused, say — with Jira's or the sync's words
 * on hovering. It clears when the next sync of the item goes through.
 */
export function JiraIssueTag({ workItemId, className = "ml-1.5" }: { workItemId: string; className?: string }) {
  const issue = useJiraIssuesStore((s) => s.byItem.get(workItemId));
  const expectedRef = useExpectedJiraType(workItemId);
  const expected = expectedRef?.type;
  const flatNote = expectedRef?.flattened ? flattenedNote(expectedRef.levels) : null;
  if (!issue) {
    if (!expectedRef) return null;
    return (
      <span
        className={`${className} whitespace-nowrap text-xs text-muted-foreground italic opacity-60`}
        title={[`Being created in Jira as a ${expectedRef.type}`, flatNote].filter(Boolean).join(". ")}
      >
        {flatNote && <Info className="mr-0.5 inline-block h-3 w-3 align-[-1px]" aria-hidden="true" />}
        {expectedRef.projectKey}-… · {expectedRef.type}
      </span>
    );
  }
  // The sync starts each error with the issue's key, which the tag already shows.
  const error = issue.error?.replace(new RegExp(`^${issue.key}:\\s*`), "") ?? null;
  const pending = !error && expected !== undefined && expected !== issue.type;
  const text = (
    <>
      {error && <AlertTriangle className="mr-0.5 inline-block h-3 w-3 align-[-1px]" aria-hidden="true" />}
      {!error && flatNote && <Info className="mr-0.5 inline-block h-3 w-3 align-[-1px]" aria-hidden="true" />}
      {issue.key} · {pending ? expected : issue.type}
    </>
  );
  const tone = error ? "text-destructive" : pending ? "text-muted-foreground italic opacity-60" : "text-muted-foreground";
  const look = `${className} whitespace-nowrap text-xs ${tone}`;
  // An error from before the sync flattened what is too deep says the same.
  const levels = error?.match(/^Jira has (\d+) levels\b/)?.[1];
  const title = levels
    ? flattenedNote(Number(levels))
    : error
    ? `Not in step with Jira: ${error}`
    : [pending ? `Becoming a ${expected} in Jira (now a ${issue.type})` : null, flatNote]
        .filter(Boolean)
        .join(". ") || `Open ${issue.key} in Jira`;
  if (!issue.url) {
    return (
      <span className={look} title={error || pending || flatNote ? title : undefined}>
        {text}
      </span>
    );
  }
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${look} hover:underline ${error ? "" : "hover:text-foreground"}`}
      title={title}
      // A click on the row selects the item; this one opens Jira only.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {text}
    </a>
  );
}

/** What an item deeper than the project's levels is told on hovering. */
function flattenedNote(levels: number): string {
  return `There are currently max ${levels} levels in Jira for this list. Agilefant will retain this hierarchy but it won't be reflected in Jira`;
}
