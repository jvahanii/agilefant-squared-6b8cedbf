import { useJiraIssuesStore } from "@/store/jiraIssuesStore";

/**
 * The Jira issue an item is kept in step with, after its name: "INT-8 ·
 * Subtask", opening the issue in Jira. Nothing for an item that is not synced.
 *
 * Agilefant has no issue types; Jira's is shown because it decides what the
 * item may be moved under there.
 */
export function JiraIssueTag({ workItemId, className = "ml-1.5" }: { workItemId: string; className?: string }) {
  const issue = useJiraIssuesStore((s) => s.byItem.get(workItemId));
  if (!issue) return null;
  const text = `${issue.key} · ${issue.type}`;
  const look = `${className} whitespace-nowrap text-xs text-muted-foreground`;
  if (!issue.url) return <span className={look}>{text}</span>;
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${look} hover:text-foreground hover:underline`}
      title={`Open ${issue.key} in Jira`}
      // A click on the row selects the item; this one opens Jira only.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {text}
    </a>
  );
}
