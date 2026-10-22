/**
 * An item synced with Jira shows which issue it is — "INT-8 · Subtask" — after
 * its name, linking to the issue. Agilefant has no issue types; Jira's decides
 * what the item may be moved under there, so it is worth seeing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const rows = vi.hoisted(() => ({
  links: [] as Array<Record<string, string | null>>,
  connections: [] as Array<Record<string, string | boolean>>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: async () => ({ data: table === "jira_issue_links" ? rows.links : rows.connections, error: null }),
    }),
  },
}));

import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { JiraIssueTag } from "@/components/JiraIssueTag";
import { useAppStore } from "@/store/appStore";
import type { WorkItem } from "@/types/models";

beforeEach(() => {
  rows.links = [{ work_item_id: "org::wi-1", organization_id: "org", jira_key: "INT-8", jira_type: "Subtask", last_error: null }];
  rows.connections = [
    { organization_id: "org", base_url: "https://example.atlassian.net", project_key: "INT", backlog_id: "org::bl-1", tree_id: "org::tree-1", enabled: true, issue_types: null },
  ];
  useJiraIssuesStore.setState({ byItem: new Map(), byList: new Map() });
});

describe("the Jira issue after an item's name", () => {
  it("shows the key and type, opening the issue in Jira without selecting the row", async () => {
    await useJiraIssuesStore.getState().load();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <JiraIssueTag workItemId="org::wi-1" />
      </div>,
    );
    const link = screen.getByRole("link", { name: "INT-8 · Subtask" });
    expect(link).toHaveAttribute("href", "https://example.atlassian.net/browse/INT-8");
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(link);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("shows nothing for an item that is not synced", async () => {
    await useJiraIssuesStore.getState().load();
    const { container } = render(<JiraIssueTag workItemId="org::wi-2" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the key as text where the Jira address is not visible — a partner organization's item", async () => {
    rows.connections = [];
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-1" />);
    expect(screen.getByText("INT-8 · Subtask")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("an item the sync could not send to Jira", () => {
  it("shows its tag red, with why on hovering, without the key twice", async () => {
    rows.links[0].last_error = "INT-8: Jira has 5 levels — Theme, Initiative, Epic, Story/Task, Subtask — and this would make 6; move something up first";
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-1" />);
    const link = screen.getByRole("link", { name: /INT-8 · Subtask/ });
    expect(link).toHaveClass("text-destructive");
    expect(link).toHaveAttribute("title", expect.stringMatching(/^Not in step with Jira: Jira has 5 levels/));
  });

  it("shows it as usual once the sync goes through", async () => {
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-1" />);
    const link = screen.getByRole("link", { name: "INT-8 · Subtask" });
    expect(link).not.toHaveClass("text-destructive");
    expect(link).toHaveAttribute("title", "Open INT-8 in Jira");
  });
});

describe("the list kept in step with Jira", () => {
  it("is known with its project, to mark it in the sidebar", async () => {
    await useJiraIssuesStore.getState().load();
    expect(useJiraIssuesStore.getState().byList.get("org::bl-1")).toEqual({
      organizationId: "org",
      projectKey: "INT",
      treeId: "org::tree-1",
      issueTypes: null,
      url: "https://example.atlassian.net/browse/INT",
    });
  });

  it("is not marked while the sync is switched off", async () => {
    rows.connections[0].enabled = false;
    await useJiraIssuesStore.getState().load();
    expect(useJiraIssuesStore.getState().byList.size).toBe(0);
  });
});

describe("the type a move in Agilefant will give the item", () => {
  const item = (id: string, parentId: string | null) =>
    ({ id, title: id, status: "not_started", parentId, childrenIds: [], backlogAssignments: { "org::tree-1": "org::bl-1" }, ranks: {} }) as unknown as WorkItem;

  beforeEach(() => {
    rows.connections[0].issue_types = [
      { name: "Epic", level: 1 },
      { name: "Task", level: 0 },
      { name: "Story", level: 0 },
      { name: "Subtask", level: -1 },
    ] as unknown as string;
  });

  it("is shown at once, faded, until Jira has it", async () => {
    // A subtask in Jira, moved to the top level in Agilefant: it will be a task.
    useAppStore.setState({ workItems: { "org::wi-1": item("org::wi-1", null) } });
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-1" />);
    const link = screen.getByRole("link", { name: "INT-8 · Task" });
    expect(link).toHaveClass("italic");
    expect(link).toHaveAttribute("title", "Becoming a Task in Jira (now a Subtask)");
  });

  it("is not shown where it is the type Jira already has", async () => {
    rows.links.push({ work_item_id: "org::wi-0", organization_id: "org", jira_key: "INT-7", jira_type: "Task", last_error: null });
    useAppStore.setState({ workItems: { "org::wi-0": item("org::wi-0", null), "org::wi-1": item("org::wi-1", "org::wi-0") } });
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-1" />);
    expect(screen.getByRole("link", { name: "INT-8 · Subtask" })).not.toHaveClass("italic");
  });
});
