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
let readerInstalled = false;
const readPostingFacts = vi.fn();
vi.mock("@/lib/postingReader", () => ({
  postingReaderAvailable: async () => readerInstalled,
  readableInBrowser: (url: string) => url.includes("jobly.fi"),
  readPostingFacts: (...args: unknown[]) => readPostingFacts(...args),
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
  readerInstalled = false;
  readPostingFacts.mockReset();
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

  it("says why each unticked row is unticked, and nothing for the ticked ones", async () => {
    // A posting whose closing date has gone by is unticked as well, with its
    // own reason — it used to stay ticked with a date already in the past.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-17T09:00:00Z"));
    callGmail.mockResolvedValueOnce({
      links: [
        link({ url: "https://x/new", title: "Open one", deadline: "2026-09-30" }),
        link({ url: "https://x/seen", title: "Seen one", alreadyImported: true, alreadyIn: "Applied" }),
        link({ url: "https://x/closed", title: "Closed one", applicationsClosed: true }),
        link({ url: "https://x/late", title: "Late one", deadline: "2026-09-10" }),
      ],
    });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Open one");

    expect(screen.getAllByRole("checkbox").slice(1).map((b) => b.getAttribute("data-state"))).toEqual([
      "checked",
      "unchecked",
      "unchecked",
      "unchecked",
    ]);
    const reasons = screen.getAllByText(/^Not selected:/).map((e) => e.textContent);
    expect(reasons).toEqual([
      "Not selected: already in Applied. Tick it to import anyway.",
      "Not selected: no longer accepting applications. Tick it to import anyway.",
      "Not selected: the closing date has passed. Tick it to import anyway.",
    ]);
    vi.useRealTimers();
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
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Connect Gmail again" }));
  });
});

describe("SavedSearchPicker reading Jobly through the browser", () => {
  const JOBLY_OPEN = "https://www.jobly.fi/tyopaikka/senior-ai-solutions-engineer-2760006";
  const JOBLY_CLOSED = "https://www.jobly.fi/tyopaikka/closed-one-1";
  const JOBLY_TOUCHED = "https://www.jobly.fi/tyopaikka/touched-2";

  it("fills in deadlines and unticks a closed posting, but not one ticked by hand", async () => {
    readerInstalled = true;
    let releaseTouched: (v: unknown) => void = () => {};
    readPostingFacts.mockImplementation((url: string) => {
      if (url === JOBLY_OPEN) return Promise.resolve({ deadline: "2026-10-11", closed: false });
      if (url === JOBLY_CLOSED) return Promise.resolve({ closed: true });
      // Held back until the user has clicked this row.
      return new Promise((resolve) => (releaseTouched = () => resolve({ closed: true })));
    });
    callGmail.mockResolvedValueOnce({
      links: [
        link({ url: JOBLY_OPEN, title: "Alma Media — Senior AI Solutions Engineer" }),
        link({ url: JOBLY_CLOSED, title: "Closed on Jobly" }),
        link({ url: JOBLY_TOUCHED, title: "Touched on Jobly" }),
        link({ url: "https://www.linkedin.com/jobs/view/9", title: "LinkedIn one" }),
      ],
    });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Alma Media — Senior AI Solutions Engineer");

    // The row still waiting for its answer is unticked and ticked again by hand.
    await waitFor(() => expect(readPostingFacts).toHaveBeenCalledTimes(3));
    const touchedBox = () => screen.getAllByRole("checkbox")[3];
    fireEvent.click(touchedBox());
    fireEvent.click(touchedBox());
    releaseTouched(undefined);

    await waitFor(() => expect(screen.queryByText(/Reading Jobly postings/)).not.toBeInTheDocument());
    expect(screen.getByText("Closes 10/11/2026", { exact: false })).toBeInTheDocument();
    // [select-all, Alma, Closed, Touched, LinkedIn]
    expect(screen.getAllByRole("checkbox").slice(1).map((b) => b.getAttribute("data-state"))).toEqual([
      "checked",
      "unchecked",
      "checked",
      "checked",
    ]);
    // LinkedIn stays with the server.
    expect(readPostingFacts.mock.calls.map((c) => c[0])).not.toContain("https://www.linkedin.com/jobs/view/9");
  });

  it("imports the deadline the browser found", async () => {
    readerInstalled = true;
    readPostingFacts.mockResolvedValue({ deadline: "2026-10-11", closed: false });
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: JOBLY_OPEN, title: "Alma" })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0 });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText(/Reading Jobly postings/)).not.toBeInTheDocument());
    await waitFor(() => expect(readPostingFacts).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Import selected/ }));

    await waitFor(() => expect(callGmail).toHaveBeenCalledTimes(2));
    expect(callGmail.mock.calls[1][0].links[0]).toMatchObject({ url: JOBLY_OPEN, deadline: "2026-10-11" });
  });

  it("leaves the picker as it was without the extension, or for someone who is not a superuser", async () => {
    for (const [installed, isSuper] of [
      [false, true],
      [true, false],
    ]) {
      readerInstalled = installed;
      superuser = isSuper;
      callGmail.mockResolvedValueOnce({ links: [link({ url: JOBLY_OPEN, title: `Alma ${installed}` })] });
      const { unmount } = render(
        <SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />,
      );
      await screen.findByText(`Alma ${installed}`);
      await new Promise((r) => setTimeout(r, 10));
      unmount();
    }
    expect(readPostingFacts).not.toHaveBeenCalled();
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
