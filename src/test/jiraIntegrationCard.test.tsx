/**
 * The Jira card on Bells & Whistles: connecting a project to a list, and
 * "Sync now". The sync itself is tested in jiraSync.test.ts; this pins what a
 * person sees and what the card asks the function to do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const callJira = vi.fn();
vi.mock("@/lib/jiraSync", () => ({ callJira: (body: Record<string, unknown>) => callJira(body) }));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (t: unknown) => toast(t), useToast: () => ({ toasts: [], toast }) }));

import { JiraIntegrationCard } from "@/components/JiraIntegrationCard";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";

const CONNECTED = {
  connected: true,
  tokenConfigured: true,
  baseUrl: "https://jvahanii.atlassian.net",
  email: "me@example.com",
  projectKey: "INT",
  treeId: "tree-1",
  backlogId: "bl-1",
  webhook: true,
  lastSyncedAt: null,
  lastError: null,
  linked: 0,
  pending: 0,
};

beforeEach(() => {
  callJira.mockReset();
  toast.mockReset();
  useOrgStore.setState({ activeOrgId: "org-1" } as never);
  useAppStore.setState({
    backlogs: { "bl-1": { id: "bl-1", name: "Backlog", treeId: "tree-1" } },
    backlogTrees: { "tree-1": { id: "tree-1", name: "Agilefant-Jira integration" } },
    loadFromSupabase: vi.fn(),
  } as never);
});

describe("the Jira card", () => {
  it("says what to do when the API token is not set", async () => {
    callJira.mockResolvedValue({ connected: false, tokenConfigured: false });
    render(<JiraIntegrationCard canManage />);
    expect(await screen.findByText(/JIRA_API_TOKEN/)).toBeInTheDocument();
  });

  it("connects a project to a list, sending what was typed", async () => {
    callJira.mockImplementation(async (body: { action: string }) =>
      body.action === "status" ? { connected: false, tokenConfigured: true } : { ...CONNECTED, webhookError: null },
    );
    render(<JiraIntegrationCard canManage />);
    fireEvent.change(await screen.findByLabelText("Jira address"), { target: { value: "https://jvahanii.atlassian.net" } });
    fireEvent.change(screen.getByLabelText("Atlassian account email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Jira project key"), { target: { value: "int" } });
    // The list, chosen as the select would.
    callJira.mockClear();
    const connect = screen.getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
  });

  it("shows a connected pair, and syncs on Sync now with a summary of what changed", async () => {
    callJira.mockImplementation(async (body: { action: string }) =>
      body.action === "status"
        ? CONNECTED
        : {
            ...CONNECTED,
            linked: 9,
            report: { createdInAgilefant: 6, createdInJira: 3, updatedInAgilefant: 0, updatedInJira: 0, deletedInAgilefant: 0, deletedInJira: 0, skipped: [], errors: [] },
          },
    );
    render(<JiraIntegrationCard canManage />);
    expect(await screen.findByText(/Agilefant-Jira integration › Backlog/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sync now/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Synced with Jira", description: "6 new in Agilefant, 3 new in Jira" }),
      ),
    );
    expect(callJira).toHaveBeenCalledWith({ action: "sync", organizationId: "org-1" });
    expect(screen.getByText(/9 item\(s\) paired/)).toBeInTheDocument();
  });

  it("says when Jira's webhook is missing, as Jira's changes then wait for Sync now", async () => {
    callJira.mockResolvedValue({ ...CONNECTED, webhook: false });
    render(<JiraIntegrationCard canManage />);
    expect(await screen.findByText(/webhook is not registered/)).toBeInTheDocument();
  });

  it("lets a member sync but not change the connection", async () => {
    callJira.mockResolvedValue(CONNECTED);
    render(<JiraIntegrationCard canManage={false} />);
    expect(await screen.findByRole("button", { name: /Sync now/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });
});
