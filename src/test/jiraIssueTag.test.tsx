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
    expect(link).toHaveAttribute(
      "title",
      "There are currently max 5 levels in Jira for this list. Agilefant will retain this hierarchy but it won't be reflected in Jira",
    );
  });

  it("gives Jira's own words for any other refusal", async () => {
    rows.links[0].last_error = "INT-8: Jira answered 400: summary: Summary is required.";
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-1" />);
    const link = screen.getByRole("link", { name: /INT-8 · Subtask/ });
    expect(link).toHaveAttribute("title", "Not in step with Jira: Jira answered 400: summary: Summary is required.");
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

  it("is shown for a new item with its key to come, before the sync has created it", async () => {
    useAppStore.setState({ workItems: { "org::wi-1": item("org::wi-1", null), "org::wi-new": item("org::wi-new", "org::wi-1") } });
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-new" />);
    // Under a top-level subtask: it is raised to a task, the new item its subtask.
    const tag = screen.getByText("INT-… · Subtask");
    expect(tag).toHaveClass("italic");
    expect(tag).toHaveAttribute("title", "Being created in Jira as a Subtask");
  });

  it("marks an item deeper than Jira's levels, which Agilefant keeps as it is", async () => {
    // Task (INT-7) > Subtask (INT-8) > a third level, on Jira's three: flattened.
    rows.links.push({ work_item_id: "org::wi-0", organization_id: "org", jira_key: "INT-7", jira_type: "Epic", last_error: null });
    rows.links.push({ work_item_id: "org::wi-2", organization_id: "org", jira_key: "INT-9", jira_type: "Task", last_error: null });
    rows.links.push({ work_item_id: "org::wi-3", organization_id: "org", jira_key: "INT-10", jira_type: "Subtask", last_error: null });
    useAppStore.setState({
      workItems: {
        "org::wi-0": item("org::wi-0", null),
        "org::wi-2": item("org::wi-2", "org::wi-0"),
        "org::wi-3": item("org::wi-3", "org::wi-2"),
        "org::wi-1": item("org::wi-1", "org::wi-3"),
      },
    });
    rows.links[0].jira_type = "Subtask";
    await useJiraIssuesStore.getState().load();
    const { container } = render(<JiraIssueTag workItemId="org::wi-1" />);
    const link = screen.getByRole("link", { name: "INT-8 · Subtask" });
    expect(link).not.toHaveClass("italic");
    expect(link).toHaveAttribute(
      "title",
      "There are currently max 3 levels in Jira for this list. Agilefant will retain this hierarchy but it won't be reflected in Jira",
    );
    expect(container.querySelector("svg")).toHaveClass("lucide-triangle-alert", "text-destructive");
  });

  it("warns the same way for an item the sync has not created in Jira yet", async () => {
    rows.links.push({ work_item_id: "org::wi-0", organization_id: "org", jira_key: "INT-7", jira_type: "Epic", last_error: null });
    rows.links.push({ work_item_id: "org::wi-2", organization_id: "org", jira_key: "INT-9", jira_type: "Task", last_error: null });
    rows.links.push({ work_item_id: "org::wi-3", organization_id: "org", jira_key: "INT-10", jira_type: "Subtask", last_error: null });
    useAppStore.setState({
      workItems: {
        "org::wi-0": item("org::wi-0", null),
        "org::wi-2": item("org::wi-2", "org::wi-0"),
        "org::wi-3": item("org::wi-3", "org::wi-2"),
        "org::wi-1": item("org::wi-1", "org::wi-3"),
        "org::wi-new": item("org::wi-new", "org::wi-1"),
      },
    });
    await useJiraIssuesStore.getState().load();
    const { container } = render(<JiraIssueTag workItemId="org::wi-new" />);
    expect(screen.getByTitle(/won't be reflected in Jira/)).toHaveTextContent("INT-… · ");
    expect(container.querySelector("svg")).toHaveClass("lucide-triangle-alert", "text-destructive");
  });

  it("is not shown where it is the type Jira already has", async () => {
    rows.links.push({ work_item_id: "org::wi-0", organization_id: "org", jira_key: "INT-7", jira_type: "Task", last_error: null });
    useAppStore.setState({ workItems: { "org::wi-0": item("org::wi-0", null), "org::wi-1": item("org::wi-1", "org::wi-0") } });
    await useJiraIssuesStore.getState().load();
    render(<JiraIssueTag workItemId="org::wi-1" />);
    expect(screen.getByRole("link", { name: "INT-8 · Subtask" })).not.toHaveClass("italic");
  });
});
