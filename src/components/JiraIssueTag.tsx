import { AlertTriangle } from "lucide-react";
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
 * slanted until Jira has it.
 *
 * Red with a warning sign while the sync could not send the item's last change
 * to Jira — a move into a sixth level, say — with Jira's or the sync's words
 * on hovering. It clears when the next sync of the item goes through.
 */
export function JiraIssueTag({ workItemId, className = "ml-1.5" }: { workItemId: string; className?: string }) {
  const issue = useJiraIssuesStore((s) => s.byItem.get(workItemId));
  const expected = useExpectedJiraType(workItemId);
  if (!issue) return null;
  // The sync starts each error with the issue's key, which the tag already shows.
  const error = issue.error?.replace(new RegExp(`^${issue.key}:\\s*`), "") ?? null;
  const pending = !error && expected !== undefined && expected !== issue.type;
  const text = (
    <>
      {error && <AlertTriangle className="mr-0.5 inline-block h-3 w-3 align-[-1px]" aria-hidden="true" />}
      {issue.key} · {pending ? expected : issue.type}
    </>
  );
  const tone = error ? "text-destructive" : pending ? "text-muted-foreground italic opacity-60" : "text-muted-foreground";
  const look = `${className} whitespace-nowrap text-xs ${tone}`;
  const title = error
    ? `Not in step with Jira: ${error}`
    : pending
      ? `Becoming a ${expected} in Jira (now a ${issue.type})`
      : `Open ${issue.key} in Jira`;
  if (!issue.url) {
    return (
      <span className={look} title={error || pending ? title : undefined}>
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
