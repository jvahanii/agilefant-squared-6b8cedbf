/**
 * The job-search picker, now one component shared by Bells & Whistles and the
 * header's Run job search dialog, and the header button that opens it.
 *
 * For the picker what matters is that moving it changed nothing it does: it
 * searches on its own, starts already-seen and closed postings unticked, imports
 * what is ticked, and closes when there is nothing to show. For the button, that
 * it appears only for a superuser, and only where there is a search to run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// An import here runs the whole flow -- search, read, import, reload, wait for
// the new items, rank -- and waitForItems polls in 250ms steps. A test that
// clicks Import is therefore seconds long, and the default 5s left no room:
// these tests began failing in CI as the file grew, each one leaving its own
// polling behind. The work itself is unchanged; only the allowance is.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

const callGmail = vi.fn();
/** The picker reads postings batch by batch; by default they state nothing. */
const postingFacts = vi.fn();
vi.mock("@/lib/gmailConnector", () => ({
  callGmail: (body: { action: string }) => (body.action === "posting_facts" ? postingFacts(body) : callGmail(body)),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

const loadFromSupabase = vi.fn().mockResolvedValue(undefined);
const applySiblingOrder = vi.fn();
const runBulk = vi.fn((fn: () => void) => fn());
const moveWorkItemsToBacklog = vi.fn();
/** The slice of the store the picker reads; backlogs decide auto-placing. */
let storeState: Record<string, unknown> = {};
const appStoreState = () => ({ loadFromSupabase, applySiblingOrder, runBulk, moveWorkItemsToBacklog, workItems: {}, backlogs: {}, ...storeState });
vi.mock("@/store/appStore", () => ({
  useAppStore: Object.assign(
    (select: (s: ReturnType<typeof appStoreState>) => unknown) => select(appStoreState()),
    { getState: () => appStoreState() },
  ),
}));

let superuser = true;
vi.mock("@/contexts/ScrambleContext", () => ({ useScramble: () => ({ isSuperuser: superuser }) }));
let savedSearches: unknown[] = [];
/** The saved search's auto-place columns, as the picker reads them. */
let autoPlaceRow: Record<string, string | null> | null = null;
const updates: Record<string, unknown>[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: savedSearches, error: null }),
        maybeSingle: () => Promise.resolve({ data: autoPlaceRow, error: null }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return chain;
        },
      };
      return chain;
    },
  },
}));
/** The closed-ads check an import runs on the lists it filled. */
const checkClosed = vi.fn().mockResolvedValue({ closed: 1, checked: 2, unknown: 0, fromTitle: 0 });
/** Work item ids a posting check has marked closed. */
let closedIds = new Set<string>();
vi.mock("@/store/closedPostingsStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/closedPostingsStore")>()),
  useClosedPostingsStore: { getState: () => ({ checking: false, check: checkClosed, closed: closedIds }) },
}));
let readerInstalled = false;
const readPostingFacts = vi.fn();
vi.mock("@/lib/postingReader", () => ({
  postingReaderAvailable: async () => readerInstalled,
  readableInBrowser: (url: string) => url.includes("jobly.fi"),
  readPostingFacts: (...args: unknown[]) => readPostingFacts(...args),
}));
/**
 * Waiting for the imported items to arrive polls the store every 250ms for up
 * to 20s, and that polling outlives the test that started it: with every test
 * that clicks Import leaving one behind, later tests in this file grew slow
 * enough to fail on timing. Stubbed by default, and only the test about the
 * waiting itself uses the real one.
 */
let realWaitForItems = false;
vi.mock("@/lib/waitForItems", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/waitForItems")>();
  return {
    waitForItems: (...args: Parameters<typeof actual.waitForItems>) =>
      realWaitForItems ? actual.waitForItems(...args) : Promise.resolve(true),
  };
});
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
  postingFacts.mockReset();
  postingFacts.mockResolvedValue({ facts: [] });
  toast.mockReset();
  loadFromSupabase.mockClear();
  superuser = true;
  savedSearches = [];
  autoPlaceRow = null;
  updates.length = 0;
  readerInstalled = false;
  readPostingFacts.mockReset();
  applySiblingOrder.mockReset();
  runBulk.mockClear();
  moveWorkItemsToBacklog.mockReset();
  storeState = {};
  checkClosed.mockClear();
  closedIds = new Set();
  realWaitForItems = false;
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

  it("says what it is doing while it reads the postings, then uses what they say", async () => {
    callGmail.mockResolvedValueOnce({
      links: Array.from({ length: 8 }, (_, i) =>
        link({ url: `https://x/${i}`, title: `Job ${i}`, messageId: i < 4 ? "m-1" : "m-2" }),
      ),
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    postingFacts
      .mockImplementationOnce(async ({ links }: { links: { url: string }[] }) => {
        await gate;
        return {
          facts: links.map((l) => ({
            url: l.url,
            deadline: l.url === "https://x/0" ? "2026-10-11" : null,
            applicationsClosed: l.url === "https://x/1",
          })),
        };
      })
      .mockResolvedValueOnce({ facts: [] });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Found 8 jobs in 2 emails. Reading job postings for deadlines and cities… 0/8",
      ),
    );
    // Asked for without the postings, which it reads itself, six at a time.
    expect(callGmail.mock.calls[0][0]).toMatchObject({ action: "preview", readPostings: false });
    expect(postingFacts.mock.calls[0][0].links).toHaveLength(6);
    release();

    await screen.findByText("Job 0");
    expect(postingFacts).toHaveBeenCalledTimes(2);
    expect(postingFacts.mock.calls[1][0].links.map((l: { url: string }) => l.url)).toEqual(["https://x/6", "https://x/7"]);
    // What the postings said is on the rows, and the closed one starts unticked.
    expect(screen.getAllByText(/^closes /)).toHaveLength(1);
    expect(screen.getByText("Not selected: no longer accepting applications. Tick it to import anyway.")).toBeInTheDocument();
  });

  it("reads a posting the mail dated for its cities, shows them, and imports them", async () => {
    callGmail
      .mockResolvedValueOnce({
        links: [link({ url: "https://www.linkedin.com/jobs/view/7", title: "Nokia — Standardization Lead", deadline: "2026-10-11" })],
      })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0 });
    postingFacts.mockResolvedValueOnce({
      facts: [{ url: "https://www.linkedin.com/jobs/view/7", deadline: null, applicationsClosed: false, cities: ["Espoo", "Dallas", "Bangalore"] }],
    });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    // Two and a count on the row, like the item's name; every one on hover.
    const cities = await screen.findByText("Espoo, Dallas +1 more");
    expect(cities).toHaveAttribute("title", "Espoo, Dallas, Bangalore");
    expect(postingFacts.mock.calls[0][0].links.map((l: { url: string }) => l.url)).toEqual(["https://www.linkedin.com/jobs/view/7"]);

    fireEvent.click(screen.getByRole("button", { name: /^Import selected$/ }));
    await waitFor(() => expect(callGmail).toHaveBeenCalledTimes(2));
    expect(callGmail.mock.calls[1][0].links[0]).toMatchObject({ deadline: "2026-10-11", cities: ["Espoo", "Dallas", "Bangalore"] });
  });

  it("shows cities the mail itself gave, without reading the posting", async () => {
    callGmail.mockResolvedValueOnce({
      links: [
        link({
          url: "https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/1f93da93-4577-45e3-9edb-73c024fed812",
          title: "Joppl Oy — servicenow ITSM expert",
          deadline: "2026-09-30",
          cities: ["Espoo", "Helsinki"],
        }),
      ],
    });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    expect(await screen.findByText("Espoo, Helsinki")).toBeInTheDocument();
    expect(postingFacts).not.toHaveBeenCalled();
  });

  it("shows no location line for a posting known to name no city", async () => {
    callGmail.mockResolvedValueOnce({ links: [link({ url: "https://x/remote", title: "Remote one", deadline: "2026-10-01", cities: [] })] });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Remote one");
    expect(document.querySelector("svg.lucide-map-pin")).toBeNull();
    expect(postingFacts).not.toHaveBeenCalled();
  });

  it("still shows the list when the postings cannot be read", async () => {
    callGmail.mockResolvedValueOnce({ links: [link({ url: "https://x/a", title: "Unread posting" })] });
    postingFacts.mockRejectedValueOnce(new Error("unknown action"));
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Unread posting");
    expect(screen.getByText("deadline unknown")).toBeInTheDocument();
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

  it("ticks a posting once however many emails list it, and counts it once", async () => {
    callGmail.mockResolvedValueOnce({
      links: [
        link({ url: "https://x/a", title: "Role A", messageId: "m-new", subject: "Newest alert", date: "2026-09-18T10:00:00Z" }),
        link({ url: "https://x/b", title: "Role B", messageId: "m-new", subject: "Newest alert", date: "2026-09-18T10:00:00Z" }),
        link({ url: "https://x/a", title: "Role A again", messageId: "m-old", subject: "Older digest", date: "2026-09-17T10:00:00Z" }),
      ],
    });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Role A again");

    expect(screen.getAllByRole("checkbox").map((b) => b.getAttribute("data-state"))).toEqual([
      "checked", // Newest alert
      "checked",
      "checked",
      "unchecked", // Older digest
      "unchecked",
    ]);
    expect(screen.getByText('Not selected: also in "Newest alert". Tick it to import anyway.')).toBeInTheDocument();
    expect(screen.getByText(/^2 jobs, out of which 2 seem new, found in 2 emails/)).toBeInTheDocument();
  });

  it("imports only what is ticked, then closes and reloads", async () => {
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: "https://x/a", title: "A" }), link({ url: "https://x/b", title: "B", alreadyImported: true })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0 });
    const onClose = vi.fn();

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await screen.findByText("A");
    fireEvent.click(screen.getByRole("button", { name: /^Import selected$/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const importCall = callGmail.mock.calls[1][0];
    expect(importCall).toMatchObject({ action: "import", mode: "jobs", treeId: "tree-1", backlogId: "bl-1", queryId: "q-1" });
    expect(importCall.links.map((l: { url: string }) => l.url)).toEqual(["https://x/a"]);
    await waitFor(() => expect(loadFromSupabase).toHaveBeenCalled());
  });

  it("sends the status chosen on a row, and nothing for rows left at Not started", async () => {
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: "https://x/a", title: "A" }), link({ url: "https://x/b", title: "B", messageId: "m-2" })] })
      .mockResolvedValueOnce({ created: 2, skipped: 0, collapsed: 0 });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("A");
    // Both rows start ticked and at the default: Not started.
    const statusA = screen.getByRole("combobox", { name: "Status for A" }) as HTMLSelectElement;
    expect(statusA.value).toBe("not_started");
    fireEvent.change(statusA, { target: { value: "in_progress" } });
    fireEvent.click(screen.getByRole("button", { name: /^Import selected$/ }));

    await waitFor(() => expect(callGmail).toHaveBeenCalledTimes(2));
    const links = callGmail.mock.calls[1][0].links;
    expect(links.find((l: { url: string }) => l.url === "https://x/a")).toMatchObject({ status: "in_progress" });
    expect(links.find((l: { url: string }) => l.url === "https://x/b")).not.toHaveProperty("status");
  });

  it("checks the ads already in the list for closed ones once it has imported", async () => {
    const existing = (id: string, backlogId: string) => ({
      id, title: id, status: "not_started", parentId: null, childrenIds: [],
      backlogAssignments: { "tree-1": backlogId }, ranks: { [backlogId]: 0 },
    });
    storeState = {
      workItems: {
        old: existing("old", "bl-1"),
        fresh: existing("fresh", "bl-1"),
        unlinked: existing("unlinked", "bl-1"),
        elsewhere: existing("elsewhere", "bl-other"),
      },
      hyperlinks: {
        old: [{ url: "https://x/old" }],
        fresh: [{ url: "https://x/fresh" }],
        elsewhere: [{ url: "https://x/elsewhere" }],
      },
    };
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: "https://x/a", title: "A" })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0, createdIds: ["fresh"] });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("A");
    fireEvent.click(screen.getByRole("button", { name: /^Import selected$/ }));

    // Only what was there before, in the list imported into, with a link.
    await waitFor(() => expect(checkClosed).toHaveBeenCalled());
    expect(checkClosed.mock.calls[0][0]).toEqual([{ id: "old", title: "old", urls: ["https://x/old"] }]);
    await waitFor(() =>
      expect(toast.mock.calls.map((c) => c[0].title)).toContain("Existing ads: 1 closed ad"),
    );
  });

  it("marks every listed email read without importing, when nothing is worth it", async () => {
    callGmail
      .mockResolvedValueOnce({
        links: [
          link({ url: "https://x/a", title: "Seen A", messageId: "m-1", alreadyImported: true, alreadyIn: "Jobs" }),
          link({ url: "https://x/b", title: "Seen B", messageId: "m-1", alreadyImported: true, alreadyIn: "Jobs" }),
          link({ url: "https://x/c", title: "Seen C", messageId: "m-2", alreadyImported: true, alreadyIn: "Jobs" }),
        ],
      })
      .mockResolvedValueOnce({ marked: 2 });
    const onClose = vi.fn();

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await screen.findByText("Seen A");
    fireEvent.click(screen.getByRole("button", { name: "Do not import anything, mark 2 emails read" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(callGmail).toHaveBeenLastCalledWith({ action: "mark_read", organizationId: "org-1", messageIds: ["m-1", "m-2"] });
    expect(callGmail.mock.calls.some((c) => c[0].action === "import")).toBe(false);
    expect(toast.mock.calls.map((c) => c[0].title)).toContain("2 emails marked as read");
  });

  it("stays open when Gmail will not mark the emails read", async () => {
    callGmail
      .mockResolvedValueOnce({ links: [link({ title: "Seen", alreadyImported: true })] })
      .mockRejectedValueOnce(new Error('{"error":"gmail_permission_missing"}'));
    const onClose = vi.fn();

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await screen.findByText("Seen");
    fireEvent.click(screen.getByRole("button", { name: "Do not import anything, mark 1 email read" }));

    await waitFor(() =>
      expect(toast.mock.calls.map((c) => c[0].title)).toContain("Could not mark the emails as read"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says it is all caught up, and stays open, when every alert has been read", async () => {
    callGmail.mockResolvedValueOnce({ links: [] });
    const onClose = vi.fn();
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await screen.findByText("All caught up.");
    expect(screen.getByRole("status")).toHaveTextContent("no unread emails with job ads");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says nothing matched, for a search that is not about unread mail", async () => {
    callGmail.mockResolvedValueOnce({ links: [] });
    render(
      <SavedSearchPicker search={{ ...SEARCH, query: "from:jobs newer_than:7d" }} mode="jobs" organizationId="org-1" onClose={vi.fn()} />,
    );
    await screen.findByText("No job ads found.");
  });

  it("closes, saying why, when Gmail is not connected", async () => {
    callGmail.mockRejectedValueOnce(new Error('{"error":"gmail_not_connected"}'));
    const onClose = vi.fn();
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Connect Gmail again" }));
  });
});

describe("choosing rows", () => {
  const twoJobs = async () => {
    callGmail.mockResolvedValueOnce({
      links: [
        link({
          url: "https://x/a",
          title: "Verohallinto — ICT-asiantuntija (Tiedonhallinnan asiantuntija), useita paikkakuntia",
          cities: ["Helsinki", "Joensuu", "Oulu"],
        }),
        link({ url: "https://x/b", title: "Toinen" }),
      ],
    });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText(/^Verohallinto/);
  };
  const rowBoxes = () => screen.getAllByRole("checkbox").slice(1);

  it("says so when a row is unticked by hand, which used to leave no reason at all", async () => {
    await twoJobs();
    fireEvent.click(rowBoxes()[0]);
    expect(await screen.findByText("Not selected: you unticked it. Tick it to import anyway.")).toBeInTheDocument();
    // Ticking it again takes the line away.
    fireEvent.click(rowBoxes()[0]);
    await waitFor(() => expect(screen.queryByText(/you unticked it/)).not.toBeInTheDocument());
  });

  it("says so for rows unticked through the select-all of their email too", async () => {
    await twoJobs();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() =>
      expect(screen.getAllByText("Not selected: you unticked it. Tick it to import anyway.")).toHaveLength(2),
    );
  });

  it("toggles from the title line, but not from the cities or the link", async () => {
    await twoJobs();
    expect(rowBoxes()[0]).toHaveAttribute("data-state", "checked");

    // The cities line: this is what unticked a row by accident.
    fireEvent.click(screen.getByText("Helsinki, Joensuu +1 more"));
    expect(rowBoxes()[0]).toHaveAttribute("data-state", "checked");
    fireEvent.click(screen.getByText("https://x/a"));
    expect(rowBoxes()[0]).toHaveAttribute("data-state", "checked");

    // The title line does toggle it.
    // Both rows carry this label; the first row is the one under test.
    fireEvent.click(screen.getAllByText("deadline unknown")[0]);
    await waitFor(() => expect(rowBoxes()[0]).toHaveAttribute("data-state", "unchecked"));
  });

  it("opens the posting without choosing it when the title link itself is clicked", async () => {
    await twoJobs();
    fireEvent.click(screen.getByText(/^Verohallinto/));
    expect(rowBoxes()[0]).toHaveAttribute("data-state", "checked");
  });

  it("never cuts the employer and job name short", async () => {
    await twoJobs();
    const title = screen.getByText(/^Verohallinto/);
    expect(title).toHaveTextContent(
      "Verohallinto — ICT-asiantuntija (Tiedonhallinnan asiantuntija), useita paikkakuntia",
    );
    expect(title.className).not.toContain("truncate");
  });
});

describe("Import & auto-place", () => {
  const backlog = (id: string, name: string, treeId = "tree-1") => ({
    id, name, parentId: null, childrenIds: [], treeId, rank: 0,
  });
  const item = (id: string, title: string, backlogId: string) => ({
    id, title, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { "tree-1": backlogId }, ranks: { [backlogId]: 0 },
  });

  const withBothLists = () => {
    autoPlaceRow = { auto_place_dated_backlog_id: "dl", auto_place_undated_backlog_id: "open" };
    storeState = {
      backlogs: {
        dl: backlog("dl", "Jobs with deadline"),
        open: backlog("open", "Jobs with no deadline"),
        other: backlog("other", "ICT jobs inbox"),
      },
      workItems: {
        a: item("a", "1011 Alma Media — AI", "dl"),
        b: item("b", "0930 Fennia — Product owner", "dl"),
        c: item("c", "Nordea — AI Platform Engineer", "open"),
      },
    };
  };

  it("leaves the filing to the import, then ranks both lists by name", async () => {
    withBothLists();
    callGmail
      .mockResolvedValueOnce({
        links: [
          link({ url: "https://x/dated", title: "Dated", deadline: "2026-10-11" }),
          link({ url: "https://x/open", title: "Open-ended", deadlineOpen: true }),
          link({ url: "https://x/none", title: "No date" }),
        ],
      })
      .mockResolvedValueOnce({ created: 3, skipped: 0, collapsed: 0, dated: 1, undated: 2 })
      .mockResolvedValueOnce({ marked: 1 });
    const onClose = vi.fn();

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={onClose} />);
    await screen.findByText("Dated");
    await waitFor(() => expect(screen.getByRole("button", { name: /Import selected & auto-place/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Import selected & auto-place/ }));

    await waitFor(() => expect(applySiblingOrder).toHaveBeenCalledTimes(2), { timeout: 8000 });
    // One call, naming both lists: the import splits after reading the dates.
    const imported = callGmail.mock.calls[1][0];
    expect(imported).toMatchObject({
      action: "import",
      autoPlace: { datedBacklogId: "dl", undatedBacklogId: "open" },
    });
    expect(imported.links.map((l: { url: string }) => l.url)).toEqual([
      "https://x/dated",
      "https://x/open",
      "https://x/none",
    ]);

    // Name order, which for an imported title is closing-date order.
    expect(applySiblingOrder.mock.calls[0].slice(0, 4)).toEqual([null, "tree-1", ["dl"], ["b", "a"]]);
    expect(applySiblingOrder.mock.calls[1].slice(0, 4)).toEqual([null, "tree-1", ["open"], ["c"]]);
    expect(runBulk).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    expect(loadFromSupabase).toHaveBeenCalled();

    // The alerts are done with, so they are marked read — once per email.
    expect(callGmail).toHaveBeenLastCalledWith({ action: "mark_read", organizationId: "org-1", messageIds: ["m-1"] });
  });

  it("ranks the new items too, once they have loaded — not only what was there before", async () => {
    withBothLists();
    // This one is about the waiting, so it does it for real.
    realWaitForItems = true;
    const existing = storeState.workItems as Record<string, unknown>;
    // The reload returns before the new item is in the store, as a background
    // refresh does; it arrives a moment later.
    loadFromSupabase.mockImplementation(async () => {
      setTimeout(() => {
        storeState = {
          ...storeState,
          workItems: { ...existing, n: item("n", "0922 TELUS Digital AI — Transcriber", "dl") },
        };
      }, 30);
    });
    callGmail
      .mockResolvedValueOnce({ links: [// Far future on purpose: a row whose closing date has passed starts
      // unticked, so a date near the day this was written made the test
      // import nothing once that day went by.
      link({ url: "https://x/dated", title: "Dated", deadline: "2036-09-22" })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0, createdIds: ["n"] })
      .mockResolvedValueOnce({ marked: 1 });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Dated");
    await waitFor(() => expect(screen.getByRole("button", { name: /Import selected & auto-place/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Import selected & auto-place/ }));

    await waitFor(() => expect(applySiblingOrder).toHaveBeenCalled(), { timeout: 8000 });
    // 0922 sorts between 0930 and 1011 — not after them.
    expect(applySiblingOrder.mock.calls[0].slice(0, 4)).toEqual([null, "tree-1", ["dl"], ["n", "b", "a"]]);
    loadFromSupabase.mockReset();
    loadFromSupabase.mockResolvedValue(undefined);
  });

  it("still reports the import when Gmail will not mark the emails read", async () => {
    withBothLists();
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: "https://x/dated", title: "Dated", deadline: "2026-10-11" })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0 })
      .mockRejectedValueOnce(new Error('{"error":"gmail_permission_missing"}'));

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Dated");
    await waitFor(() => expect(screen.getByRole("button", { name: /Import selected & auto-place/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Import selected & auto-place/ }));

    await waitFor(() => expect(applySiblingOrder).toHaveBeenCalled(), { timeout: 8000 });
    const titles = toast.mock.calls.map((c) => c[0].title);
    expect(titles).toContain("Could not mark the emails as read");
    expect(titles.some((t: string) => t.startsWith("Imported 1 work item"))).toBe(true);
  });

  it("shows the chosen lists by their current names", async () => {
    withBothLists();
    callGmail.mockResolvedValueOnce({ links: [link({ title: "Only one" })] });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Only one");
    // The ticked row's status dropdown comes first; the auto-place lists follow.
    const [, dated, undated] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    await waitFor(() => expect(dated.value).toBe("dl"));
    expect(undated.value).toBe("open");
    expect(dated.selectedOptions[0].textContent).toBe("Jobs with deadline");
  });

  it("waits for both lists to be chosen, and saves each choice by id", async () => {
    storeState = {
      backlogs: {
        dl: backlog("dl", "Jobs with deadline"),
        open: backlog("open", "Jobs with no deadline"),
        elsewhere: backlog("elsewhere", "Another tree's list", "tree-2"),
      },
    };
    callGmail.mockResolvedValueOnce({ links: [link({ title: "Only one" })] });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Only one");
    const button = screen.getByRole("button", { name: /Import selected & auto-place/ });
    expect(button).toBeDisabled();

    const [, dated, undated] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Only this search's tree is on offer.
    expect([...dated.options].map((o) => o.textContent)).toEqual([
      "Choose a list…",
      "Jobs with deadline",
      "Jobs with no deadline",
    ]);
    fireEvent.change(dated, { target: { value: "dl" } });
    expect(button).toBeDisabled();
    fireEvent.change(undated, { target: { value: "open" } });
    await waitFor(() => expect(button).toBeEnabled());
    expect(updates).toEqual([
      { auto_place_dated_backlog_id: "dl" },
      { auto_place_undated_backlog_id: "open" },
    ]);
  });

  it("is not offered for a link import, which has no deadlines to sort by", async () => {
    withBothLists();
    callGmail.mockResolvedValueOnce({ links: [link({ title: "A link" })] });
    render(<SavedSearchPicker search={SEARCH} mode="links" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("A link");
    expect(screen.queryByRole("button", { name: /auto-place/ })).not.toBeInTheDocument();
    // The only dropdown is the ticked row's status choice — no auto-place lists.
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(1);
    expect(selects[0]).toHaveAccessibleName(/status for a link/i);
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
    fireEvent.click(screen.getByRole("button", { name: /^Import selected$/ }));

    await waitFor(() => expect(callGmail).toHaveBeenCalledTimes(2));
    expect(callGmail.mock.calls[1][0].links[0]).toMatchObject({ url: JOBLY_OPEN, deadline: "2026-10-11" });
  });

  it("reads a posting whose mail gave a date, for its cities, and imports them", async () => {
    // The server cannot read Jobly at import, so the picker is the only place
    // the city can come from — date or no date.
    readerInstalled = true;
    readPostingFacts.mockResolvedValue({ deadline: "2026-12-01", closed: false, cities: ["Helsinki", "Tampere"] });
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: JOBLY_OPEN, title: "Alma", deadline: "2026-10-11" })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0 });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await waitFor(() => expect(readPostingFacts).toHaveBeenCalledWith(JOBLY_OPEN, expect.anything()));
    await waitFor(() => expect(screen.queryByText(/Reading Jobly postings/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Import selected$/ }));

    await waitFor(() => expect(callGmail).toHaveBeenCalledTimes(2));
    // The mail's date stands; the page adds where.
    expect(callGmail.mock.calls[1][0].links[0]).toMatchObject({
      url: JOBLY_OPEN,
      deadline: "2026-10-11",
      cities: ["Helsinki", "Tampere"],
    });
  });

  it("does not read a posting again once its city is known", async () => {
    readerInstalled = true;
    callGmail.mockResolvedValueOnce({
      links: [link({ url: JOBLY_OPEN, title: "Alma", deadline: "2026-10-11", cities: ["Espoo"] })],
    });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Alma");
    await new Promise((r) => setTimeout(r, 200));
    expect(readPostingFacts).not.toHaveBeenCalled();
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

describe("Import & auto-place: mirroring the rows switched on", () => {
  const SHORTLIST = "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-34431983";
  const NEXT_TREE = "tree-next";
  const backlog = (id: string, name: string, treeId = "tree-1") => ({
    id, name, parentId: null, childrenIds: [], treeId, rank: 0,
  });
  const item = (id: string, title: string) => ({
    id, title, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { "tree-1": "dl" }, ranks: { dl: 0 },
  });

  /** Two postings, imported as items "metsa-item" and "alma-item". */
  const openPicker = async (mirrorColumn: string | null, lists: Record<string, unknown>) => {
    autoPlaceRow = {
      auto_place_dated_backlog_id: "dl",
      auto_place_undated_backlog_id: "open",
      auto_place_mirror_backlog_id: mirrorColumn,
    };
    storeState = {
      backlogs: { dl: backlog("dl", "Jobs with deadline"), open: backlog("open", "Jobs with no deadline"), ...lists },
      backlogTrees: { [NEXT_TREE]: { id: NEXT_TREE, name: "MWB uuden työn saaminen" } },
      workItems: {
        "metsa-item": item("metsa-item", "0930 Metsä Group — Senior Manager, Business AI"),
        "alma-item": item("alma-item", "1011 Alma Media — AI"),
      },
    };
    callGmail
      .mockResolvedValueOnce({
        links: [
          link({ url: "https://x/metsa", title: "Metsä", deadline: "2026-09-30", cities: [] }),
          link({ url: "https://x/alma", title: "Alma", deadline: "2026-10-11", cities: [] }),
        ],
      })
      .mockResolvedValueOnce({
        created: 2, skipped: 0, collapsed: 0, dated: 2, undated: 0,
        createdIds: ["metsa-item", "alma-item"],
        createdByUrl: { "https://x/metsa": "metsa-item", "https://x/alma": "alma-item" },
      })
      .mockResolvedValueOnce({ marked: 1 });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Metsä");
    await waitFor(() => expect(screen.getByRole("button", { name: /Import selected & auto-place/ })).toBeEnabled());
  };
  const importAndAutoPlace = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Import selected & auto-place/ }));
    await waitFor(() => expect(applySiblingOrder).toHaveBeenCalled(), { timeout: 8000 });
  };

  it("mirrors the rows switched on — not the ones given a status — in the same undo step", async () => {
    await openPicker(null, { [SHORTLIST]: backlog(SHORTLIST, "Hae näitä seuraavaksi", NEXT_TREE) });
    // Metsä gets In progress but stays off; Alma is switched on.
    fireEvent.change(screen.getByRole("combobox", { name: "Status for Metsä" }), { target: { value: "in_progress" } });
    fireEvent.click(screen.getByRole("switch", { name: "Mirror Alma to Hae näitä seuraavaksi" }));
    await importAndAutoPlace();

    // The status still reaches the import: it sets how the item starts.
    const sent = callGmail.mock.calls[1][0].links as Array<{ url: string; status?: string }>;
    expect(sent.find((l) => l.url === "https://x/metsa")?.status).toBe("in_progress");
    // Only the switched-on row is mirrored, found through the import's own record of it.
    expect(moveWorkItemsToBacklog).toHaveBeenCalledTimes(1);
    expect(moveWorkItemsToBacklog).toHaveBeenCalledWith(["alma-item"], SHORTLIST, NEXT_TREE, "mirror", "tree-1");
    expect(runBulk).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("1 also mirrored to Hae näitä seuraavaksi.") }),
    );
  });

  it("starts every row switched off, and mirrors nothing then", async () => {
    await openPicker(null, { [SHORTLIST]: backlog(SHORTLIST, "Hae näitä seuraavaksi", NEXT_TREE) });
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "false"]);
    await importAndAutoPlace();
    expect(moveWorkItemsToBacklog).not.toHaveBeenCalled();
  });

  it("offers the shortlist by default, and mirrors into the list the search chose instead", async () => {
    await openPicker("applied", {
      [SHORTLIST]: backlog(SHORTLIST, "Hae näitä seuraavaksi", NEXT_TREE),
      applied: backlog("applied", "Haettu", NEXT_TREE),
    });
    expect(screen.getByRole("combobox", { name: "Mirror to" })).toHaveValue("applied");
    fireEvent.click(screen.getByRole("switch", { name: "Mirror Metsä to Haettu" }));
    await importAndAutoPlace();
    expect(moveWorkItemsToBacklog).toHaveBeenCalledWith(["metsa-item"], "applied", NEXT_TREE, "mirror", "tree-1");
  });

  it("shows the default as chosen until the search picks another, and saves a choice on the search", async () => {
    await openPicker(null, {
      [SHORTLIST]: backlog(SHORTLIST, "Hae näitä seuraavaksi", NEXT_TREE),
      applied: backlog("applied", "Haettu", NEXT_TREE),
    });
    const mirrorTo = screen.getByRole("combobox", { name: "Mirror to" });
    expect(mirrorTo).toHaveValue(SHORTLIST);
    // Only lists in other trees, named with their tree.
    expect([...mirrorTo.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "MWB uuden työn saaminen › Hae näitä seuraavaksi",
      "MWB uuden työn saaminen › Haettu",
    ]);
    fireEvent.change(mirrorTo, { target: { value: "applied" } });
    await waitFor(() => expect(updates).toContainEqual({ auto_place_mirror_backlog_id: "applied" }));
    expect(screen.getByRole("switch", { name: "Mirror Metsä to Haettu" })).toBeInTheDocument();
  });

  it("offers no switch when there is nowhere to mirror", async () => {
    await openPicker(null, {});
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("Import & auto-place: the summary", () => {
  const backlog = (id: string, name: string) => ({ id, name, parentId: null, childrenIds: [], treeId: "tree-1", rank: 0 });
  const item = (id: string, title: string, backlogId: string) => ({
    id, title, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { "tree-1": backlogId }, ranks: { [backlogId]: 0 },
  });

  beforeEach(() => {
    // Only Date: the component's own timers and waitFor keep running for real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("totals the open ads in both lists, leaving out closed ones, and stays up ten seconds", async () => {
    autoPlaceRow = { auto_place_dated_backlog_id: "dl", auto_place_undated_backlog_id: "open" };
    storeState = {
      backlogs: { dl: backlog("dl", "Jobs with deadline"), open: backlog("open", "Jobs with no deadline") },
      workItems: {
        gone: item("gone", "0915 Fennia — Product owner", "dl"), // closing date passed
        soon: item("soon", "0930 Metsä Group — Business AI", "dl"),
        later: item("later", "1011 Alma Media — AI", "dl"),
        nordea: item("nordea", "Nordea — AI Platform Engineer", "open"), // a check said closed
        wartsila: item("wartsila", "Wärtsilä — Agile Coach", "open"),
        sub: { ...item("sub", "0101 Cover letter", "dl"), parentId: "soon" }, // a task under an ad, not an ad
      },
    };
    closedIds = new Set(["nordea"]);
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: "https://x/metsa", title: "Metsä", deadline: "2026-09-30" })] })
      .mockResolvedValueOnce({ created: 1, skipped: 0, collapsed: 0, dated: 1, undated: 0, createdIds: ["soon"] })
      .mockResolvedValueOnce({ marked: 1 });

    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("Metsä");
    await waitFor(() => expect(screen.getByRole("button", { name: /Import selected & auto-place/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Import selected & auto-place/ }));

    await waitFor(() => expect(toast.mock.calls.some((c) => String(c[0].title).startsWith("Imported"))).toBe(true));
    const summary = toast.mock.calls.find((c) => String(c[0].title).startsWith("Imported"))![0];
    expect(summary.description).toContain("Open ads now: 3 in total — 2 with a deadline, 1 without (closed ones not counted).");
    expect(summary.duration).toBe(10_000);
  });

  /** An auto-place whose lists hold one linked ad, so the closed check has work to do. */
  const autoPlaceWithCheck = async () => {
    readerInstalled = true;
    autoPlaceRow = { auto_place_dated_backlog_id: "dl", auto_place_undated_backlog_id: "open" };
    storeState = {
      backlogs: { dl: backlog("dl", "Jobs with deadline"), open: backlog("open", "Jobs with no deadline") },
      workItems: { old: item("old", "0930 Metsä Group — Business AI", "dl") },
      hyperlinks: { old: [{ url: "https://x/old" }] },
    };
    callGmail
      .mockResolvedValueOnce({ links: [link({ url: "https://x/new", title: "New" })] })
      .mockResolvedValueOnce({ created: 0, skipped: 1, collapsed: 0, dated: 0, undated: 0, createdIds: [] })
      .mockResolvedValueOnce({ marked: 1 });
    render(<SavedSearchPicker search={SEARCH} mode="jobs" organizationId="org-1" onClose={vi.fn()} />);
    await screen.findByText("New");
    await waitFor(() => expect(screen.getByRole("button", { name: /Import selected & auto-place/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Import selected & auto-place/ }));
    await waitFor(() => expect(checkClosed).toHaveBeenCalled());
  };
  const existingAdsToast = () => toast.mock.calls.find((c) => String(c[0].title).startsWith("Existing ads"));

  it("holds the closed check's report back while the summary is up", async () => {
    // Only one toast shows at a time: reporting now would cut the summary short.
    await autoPlaceWithCheck();
    await new Promise((r) => setTimeout(r, 300));
    expect(existingAdsToast()).toBeUndefined();
  });

  it("restates the open totals once the check knows what is closed", async () => {
    checkClosed.mockImplementationOnce(async () => {
      closedIds = new Set(["old"]); // the check found it closed...
      vi.setSystemTime(new Date("2026-09-21T12:00:11Z")); // ...after the summary's ten seconds
      return { closed: 1, checked: 1, unknown: 0, fromTitle: 0 };
    });
    await autoPlaceWithCheck();
    await waitFor(() => expect(existingAdsToast()).toBeDefined());
    expect(existingAdsToast()![0].description).toContain("Open ads now: 0 in total — 0 with a deadline, 0 without");
    readerInstalled = false;
  });
});
