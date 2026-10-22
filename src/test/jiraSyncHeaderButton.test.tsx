/**
 * "Sync Jira" in the app header, for the workshop: shown while the active
 * organization keeps a list in step with Jira, and running the same sync as
 * the Jira card's "Sync now".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const syncJiraNow = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/lib/jiraSyncNow", () => ({ syncJiraNow }));

import { JiraSyncHeaderButton } from "@/components/JiraSyncHeaderButton";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { useOrgStore } from "@/store/orgStore";

beforeEach(() => {
  syncJiraNow.mockClear();
  useOrgStore.setState({ activeOrgId: "org" });
  useJiraIssuesStore.setState({
    byItem: new Map(),
    byList: new Map([["org::bl-1", { organizationId: "org", projectKey: "AF", treeId: "org::tree-1", issueTypes: null, url: "https://example.atlassian.net/browse/AF" }]]),
  });
});

describe("the Jira sync button in the header", () => {
  it("syncs the active organization with Jira", async () => {
    render(<JiraSyncHeaderButton />);
    const button = screen.getByRole("button", { name: /sync jira/i });
    expect(button).toHaveAttribute("title", "Sync now with Jira project AF");
    fireEvent.click(button);
    expect(syncJiraNow).toHaveBeenCalledWith("org");
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("is not there for an organization without a Jira connection", () => {
    useOrgStore.setState({ activeOrgId: "other" });
    const { container } = render(<JiraSyncHeaderButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
