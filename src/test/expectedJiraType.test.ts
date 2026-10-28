/**
 * The type an item will have in Jira, shown before the sync has made it: for
 * the list's items, and for items under a synced item that was moved out of
 * the list — the sync makes those in Jira too, under it.
 */
import { describe, it, expect } from "vitest";
import { expectedJiraTypes } from "@/lib/expectedJiraType";
import type { JiraIssueRef, JiraListRef } from "@/store/jiraIssuesStore";
import type { WorkItem } from "@/types/models";

const TREE = "org::tree-1";
const SYNCED = "org::bl-synced";
const ELSEWHERE = "org::bl-elsewhere";

const item = (id: string, list: string, parentId: string | null = null) =>
  ({ id, title: id, status: "not_started", parentId, childrenIds: [], backlogAssignments: { [TREE]: list }, ranks: {} }) as unknown as WorkItem;

const ref = (key: string, type: string): JiraIssueRef => ({
  key, type, url: null, error: null, organizationId: "org", stopped: false, listId: SYNCED,
});

const byList = new Map<string, JiraListRef>([[SYNCED, {
  organizationId: "org", projectKey: "INT", treeId: TREE, url: "",
  issueTypes: [{ name: "Epic", level: 1 }, { name: "Task", level: 0 }, { name: "Subtask", level: -1 }],
}]]);

describe("the type an item will have in Jira", () => {
  it("is shown for a new item under a synced item moved out of the list", () => {
    const workItems = {
      epic: item("epic", ELSEWHERE),
      child: item("child", ELSEWHERE, "epic"),
      grandchild: item("grandchild", ELSEWHERE, "child"),
    };
    const types = expectedJiraTypes(workItems, new Map([["epic", ref("INT-1", "Epic")]]), byList);
    expect(types.get("child")).toMatchObject({ type: "Task", projectKey: "INT" });
    expect(types.get("grandchild")).toMatchObject({ type: "Subtask" });
  });

  it("is not shown for an item outside the list with nothing synced above it", () => {
    const workItems = { other: item("other", ELSEWHERE), under: item("under", ELSEWHERE, "other") };
    const types = expectedJiraTypes(workItems, new Map(), byList);
    expect(types.has("under")).toBe(false);
    expect(types.has("other")).toBe(false);
  });
});
