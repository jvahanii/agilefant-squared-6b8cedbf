/**
 * A synced item's menu stops its sync with Jira, and resumes it: the item and
 * its issue stay paired, nothing travelling between them while stopped. The
 * tag shows the issue still, muted and struck through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const calls = vi.hoisted(() => ({ jira: [] as Array<Record<string, unknown>> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: async () => ({ data: [], error: null }) }),
  },
}));
// The menu as plain elements: what matters is which items it has, not how Radix places it.
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
  ContextMenuSeparator: () => <hr />,
}));
vi.mock("@/lib/jiraSync", () => ({
  callJira: async (body: Record<string, unknown>) => {
    calls.jira.push(body);
    return { stopped: body.stopped };
  },
}));

import { JiraItemMenuItems } from "@/components/JiraItemMenuItems";
import { JiraIssueTag } from "@/components/JiraIssueTag";
import { useJiraIssuesStore, type JiraIssueRef } from "@/store/jiraIssuesStore";
import { useOrgStore } from "@/store/orgStore";

const ref = (fields: Partial<JiraIssueRef> = {}): JiraIssueRef => ({
  key: "INT-8",
  type: "Task",
  url: "https://example.atlassian.net/browse/INT-8",
  error: null,
  organizationId: "org",
  stopped: false,
  listId: null,
  ...fields,
});

function openMenu() {
  render(<JiraItemMenuItems workItemId="org::wi-1" />);
}

beforeEach(() => {
  calls.jira = [];
  // Reloads find nothing new; the store keeps what the test put in.
  useJiraIssuesStore.setState({ byItem: new Map([["org::wi-1", ref()]]), byList: new Map(), load: async () => {} });
  useOrgStore.setState({ memberships: [{ organization_id: "org" }] as never });
});

describe("stopping an item's sync with Jira", () => {
  it("is offered on a synced item's menu, and stops it", async () => {
    openMenu();
    fireEvent.click(screen.getByText("Stop syncing with Jira"));
    await waitFor(() => expect(calls.jira).toEqual([{ action: "stopItem", organizationId: "org", workItemId: "org::wi-1", stopped: true }]));
    expect(useJiraIssuesStore.getState().byItem.get("org::wi-1")!.stopped).toBe(true);
  });

  it("is resumed from the same menu once stopped", async () => {
    useJiraIssuesStore.setState({ byItem: new Map([["org::wi-1", ref({ stopped: true })]]) });
    openMenu();
    fireEvent.click(screen.getByText("Resume syncing with Jira"));
    await waitFor(() => expect(calls.jira[0]).toMatchObject({ action: "stopItem", stopped: false }));
  });

  it("is not offered for an item that is not synced", () => {
    useJiraIssuesStore.setState({ byItem: new Map() });
    openMenu();
    expect(screen.queryByText("Stop syncing with Jira")).toBeNull();
  });

  it("is not offered for an item a partner organization's Jira keeps", () => {
    useJiraIssuesStore.setState({ byItem: new Map([["org::wi-1", ref({ organizationId: "partner" })]]) });
    openMenu();
    expect(screen.queryByText("Stop syncing with Jira")).toBeNull();
  });
});

describe("the tag of an item whose sync is stopped", () => {
  it("still names the issue, muted and struck through", () => {
    useJiraIssuesStore.setState({ byItem: new Map([["org::wi-1", ref({ stopped: true, error: "INT-8: refused" })]]) });
    render(<JiraIssueTag workItemId="org::wi-1" />);
    const link = screen.getByRole("link", { name: "INT-8 · Task" });
    expect(link).toHaveClass("line-through");
    expect(link).toHaveAttribute("title", "No longer synced with Jira (INT-8)");
  });
});
