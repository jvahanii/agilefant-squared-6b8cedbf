/**
 * The Jira card on Bells & Whistles: choosing which Jira spaces are kept in
 * step, each with a new list in the backlog tree chosen for it, taking one off, and
 * "Sync now". The sync itself is tested in jiraSync.test.ts; this pins what a
 * person sees and what the card asks the function to do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const callJira = vi.fn();
vi.mock("@/lib/jiraSync", () => ({ callJira: (body: Record<string, unknown>) => callJira(body) }));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (t: unknown) => toast(t), useToast: () => ({ toasts: [], toast }) }));
// Radix's select needs a real layout; a plain one stands in, by its label.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: () => null,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { JiraIntegrationCard } from "@/components/JiraIntegrationCard";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";

const SPACE = {
  id: "conn-1",
  projectKey: "AF",
  projectName: "Agilefant sync",
  treeId: "tree-1",
  backlogId: "bl-1",
  webhook: true,
  lastSyncedAt: null,
  lastError: null,
  linked: 9,
  pending: 0,
  itemErrors: [],
};
const CONNECTED = {
  connected: true,
  tokenConfigured: true,
  baseUrl: "https://jvahanii.atlassian.net",
  email: "me@example.com",
  spaces: [SPACE],
};
const PROJECTS = [
  { id: "1", key: "AF", name: "Agilefant sync", style: "classic" },
  { id: "2", key: "INT", name: "Integration", style: "next-gen" },
  { id: "3", key: "OPS", name: "Operations", style: "classic" },
];

beforeEach(() => {
  callJira.mockReset();
  toast.mockReset();
  useOrgStore.setState({ activeOrgId: "org-1" } as never);
  useAppStore.setState({
    backlogs: {
      "bl-1": { id: "bl-1", name: "Backlog", treeId: "tree-1" },
      "bl-2": { id: "bl-2", name: "Ideas", treeId: "tree-1" },
    },
    backlogTrees: { "tree-1": { id: "tree-1", name: "Agilefant-Jira integration" }, "tree-2": { id: "tree-2", name: "Ops" } },
    loadFromSupabase: vi.fn(),
  } as never);
  useJiraIssuesStore.setState({ load: vi.fn(async () => undefined) } as never);
});

describe("the Jira card", () => {
  it("says what to do when the API token is not set", async () => {
    callJira.mockResolvedValue({ connected: false, tokenConfigured: false, spaces: [] });
    render(<JiraIntegrationCard canManage />);
    expect(await screen.findByText(/JIRA_API_TOKEN/)).toBeInTheDocument();
  });

  it("lists the site's spaces once the address and account are given", async () => {
    callJira.mockImplementation(async (body: { action: string }) =>
      body.action === "status" ? { connected: false, tokenConfigured: true, spaces: [] } : { projects: PROJECTS },
    );
    render(<JiraIntegrationCard canManage />);
    const choose = await screen.findByRole("button", { name: "Choose spaces" });
    expect(choose).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Jira address"), { target: { value: "https://jvahanii.atlassian.net" } });
    fireEvent.change(screen.getByLabelText("Atlassian account email"), { target: { value: "me@example.com" } });
    fireEvent.click(choose);
    await waitFor(() =>
      expect(callJira).toHaveBeenCalledWith({
        action: "projects",
        organizationId: "org-1",
        baseUrl: "https://jvahanii.atlassian.net",
        email: "me@example.com",
      }),
    );
    const offered = await screen.findByRole("list", { name: "Jira spaces" });
    expect(within(offered).getByText("INT")).toBeInTheDocument();
    expect(within(offered).getByText("OPS")).toBeInTheDocument();
  });

  it("shows each space kept in step with its list, and offers only the others, each with only the trees to choose", async () => {
    callJira.mockImplementation(async (body: { action: string }) => (body.action === "status" ? CONNECTED : { projects: PROJECTS }));
    render(<JiraIntegrationCard canManage />);
    expect(await screen.findByText(/Agilefant-Jira integration › Backlog/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose more spaces" }));
    const offered = await screen.findByRole("list", { name: "Jira spaces" });
    expect(within(offered).queryByText("AF")).toBeNull();
    // The backlog trees, and no lists or sublists.
    const [select] = within(offered).getAllByTestId("select");
    const options = within(select).getAllByRole("option").map((o) => o.textContent).filter(Boolean);
    expect(options).toEqual(["Agilefant-Jira integration", "Ops"]);
  });

  it("adds a space with a new list in the tree chosen for it, saying what its first sync brought", async () => {
    const report = { createdInAgilefant: 3, createdInJira: 0, updatedInAgilefant: 0, updatedInJira: 0, deletedInAgilefant: 0, deletedInJira: 0, skipped: [], errors: [] };
    callJira.mockImplementation(async (body: { action: string }) =>
      body.action === "status" ? CONNECTED : body.action === "projects" ? { projects: PROJECTS } : { ...CONNECTED, webhookError: null, report },
    );
    render(<JiraIntegrationCard canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose more spaces" }));
    const offered = await screen.findByRole("list", { name: "Jira spaces" });
    const ops = within(offered).getByText("OPS").closest("li")!;
    fireEvent.change(within(ops).getByTestId("select"), { target: { value: "new:tree-2" } });
    fireEvent.click(within(ops).getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(callJira).toHaveBeenCalledWith({
        action: "addSpace",
        organizationId: "org-1",
        baseUrl: "https://jvahanii.atlassian.net",
        email: "me@example.com",
        projectKey: "OPS",
        newListTreeId: "tree-2",
      }),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "OPS is kept in step", description: expect.stringContaining("3 issue(s) brought in") }),
      ),
    );
  });

  it("takes a space off, once asked to, leaving its list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    callJira.mockImplementation(async (body: { action: string }) =>
      body.action === "status" ? CONNECTED : { connected: false, tokenConfigured: true, spaces: [] },
    );
    render(<JiraIntegrationCard canManage />);
    fireEvent.click(await screen.findByRole("button", { name: /Stop syncing/ }));
    await waitFor(() => expect(callJira).toHaveBeenCalledWith({ action: "removeSpace", organizationId: "org-1", connectionId: "conn-1" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/list and its items stay/));
  });

  it("syncs every space on Sync now with a summary of what changed", async () => {
    callJira.mockImplementation(async (body: { action: string }) =>
      body.action === "status"
        ? CONNECTED
        : {
            ...CONNECTED,
            report: { createdInAgilefant: 6, createdInJira: 3, updatedInAgilefant: 0, updatedInJira: 0, deletedInAgilefant: 0, deletedInJira: 0, skipped: [], errors: [] },
          },
    );
    render(<JiraIntegrationCard canManage />);
    fireEvent.click(await screen.findByRole("button", { name: /Sync now/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Synced with Jira", description: "6 new in Agilefant, 3 new in Jira" })),
    );
    expect(callJira).toHaveBeenCalledWith({ action: "sync", organizationId: "org-1" });
  });

  it("lets only an owner or admin choose spaces", async () => {
    callJira.mockResolvedValue(CONNECTED);
    render(<JiraIntegrationCard canManage={false} />);
    expect(await screen.findByText(/Only an owner or admin/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stop syncing/ })).toBeNull();
  });
});
