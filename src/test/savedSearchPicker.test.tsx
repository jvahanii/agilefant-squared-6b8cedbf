/**
 * The job-search picker, now one component shared by Bells & Whistles and the
 * header's Run job search dialog, and the header button that opens it.
 *
 * For the picker what matters is that moving it changed nothing it does: it
 * searches on its own, starts already-seen and closed postings unticked, imports
 * what is ticked, and closes when there is nothing to show. For the button, that
 * it appears only for a superuser, and only where there is a search to run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const callGmail = vi.fn();
vi.mock("@/lib/gmailConnector", () => ({ callGmail: (...args: unknown[]) => callGmail(...args) }));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

const loadFromSupabase = vi.fn().mockResolvedValue(undefined);
vi.mock("@/store/appStore", () => ({
  useAppStore: (select: (s: { loadFromSupabase: () => Promise<void> }) => unknown) => select({ loadFromSupabase }),
}));

let superuser = true;
vi.mock("@/contexts/ScrambleContext", () => ({ useScramble: () => ({ isSuperuser: superuser }) }));
let savedSearches: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: savedSearches, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock("@/store/orgStore", () => ({
  useOrgStore: (select: (s: { activeOrgId: string; roleOverride: null }) => unknown) =>
    select({ activeOrgId: "org-1", roleOverride: null }),
}));

import { SavedSearchPicker } from "@/components/SavedSearchPicker";
import { JobSearchRunButton } from "@/components/JobSearchRunButton";

const SEARCH = { id: "q-1", query: "is:unread", tree_id: "tree-1", backlog_id: "bl-1" };

const link = (over: Record<string, unknown>) => ({
  url: "https://www.linkedin.com/jobs/view/1",
  title: "Fortum — Product owner",
  messageId: "m-1",
  subject: "New jobs",
  from: "LinkedIn <jobalerts-noreply@linkedin.com>",
  date: "2026-09-16T10:00:00Z",
  alreadyImported: false,
  ...over,
});

beforeEach(() => {
  callGmail.mockReset();
  toast.mockReset();
  loadFromSupabase.mockClear();
  superuser = true;
  savedSearches = [];
});

describe("SavedSearchPicker", () => {
  it("searches by itself, and starts already-seen and closed postings unticked", async () => {
    callGmail.mockResolvedValueOnce({
      links: [
        link({ url: "https://x/new", title: "New one" }),
        link({ url: "https://x/seen", title: "Seen one", alreadyImported: true, alreadyIn: "Applied" }),
        link({ url: "https://x/closed", title: "Closed one", applicationsClosed: true }),
      ],
    });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Searching Gmail");

    await screen.findByText("New one");
    expect(callGmail).toHaveBeenCalledWith(
      expect.objectContaining({ action: "preview", query: "is:unread", treeId: "tree-1", backlogId: "bl-1" }),
    );
    const boxes = screen.getAllByRole("checkbox");
    // [select-all for the email, New, Seen, Closed]
    expect(boxes.slice(1).map((b) => b.getAttribute("data-state"))).toEqual(["checked", "unchecked", "unchecked"]);
    expect(screen.getByText("already in Applied")).toBeInTheDocument();
  });

  it("imports only what is ticked, then closes and reloads", async () => {
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: "https://x/a", title: "A" }), link({ url: "https://x/b", title: "B", alreadyImported: true })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0 });
    const onClose = vi.fn();

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await screen.findByText("A");
    fireEvent.click(screen.getByRole("button", { name: /Import selected/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const importCall = callGmail.mock.calls[1][0];
    expect(importCall).toMatchObject({ action: "import", mode: "jobs", treeId: "tree-1", backlogId: "bl-1", queryId: "q-1" });
    expect(importCall.links.map((l: { url: string }) => l.url)).toEqual(["https://x/a"]);
    await waitFor(() => expect(loadFromSupabase).toHaveBeenCalled());
  });

  it("closes, saying so, when the search finds nothing", async () => {
    callGmail.mockResolvedValueOnce({ links: [] });
    const onClose = vi.fn();
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No links found for that query" }));
  });

  it("closes, saying why, when Gmail is not connected", async () => {
    callGmail.mockRejectedValueOnce(new Error('{"error":"gmail_not_connected"}'));
    const onClose = vi.fn();
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Connect Gmail first" }));
  });
});

describe("JobSearchRunButton", () => {
  it("is not there for anyone who is not a superuser", async () => {
    superuser = false;
    savedSearches = [{ ...SEARCH, name: "Only unread" }];
    const { container } = render(<JobSearchRunButton />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("is not there when the organization has no job search to run", async () => {
    const { container } = render(<JobSearchRunButton />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the picker in a dialog for the one saved search", async () => {
    savedSearches = [{ ...SEARCH, name: "Only unread" }];
    callGmail.mockResolvedValueOnce({ links: [link({ title: "From the header" })] });

    render(<JobSearchRunButton />);
    fireEvent.click(await screen.findByTitle('Run "Only unread"'));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText("From the header")).toBeInTheDocument();
  });
});
