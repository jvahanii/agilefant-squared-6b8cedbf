/**
 * The public page, rendered against a mocked get_published_backlog() payload.
 *
 * Its pure helpers are tested in publicBacklog.test.ts; this pins what a
 * visitor actually sees — and, above all, that a stored hyperlink only becomes
 * a clickable link when it is http(s) or mailto. A `javascript:` URL on a page
 * anyone can open would run in the visitor's browser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import PublicBacklog from "@/pages/PublicBacklog";

const TOKEN = "test-token-000000000000000000000";

function fixture(over: Record<string, unknown> = {}) {
  return {
    kind: "tree",
    tree: { id: "t", name: "Product tree" },
    rootBacklogId: null,
    pointsVisible: true,
    timeVisible: true,
    labelsVisible: true,
    descriptionVisible: true,
    statusVisible: true,
    teamsVisible: true,
    linksVisible: true,
    treeMinutes: 45,
    backlogs: [
      { id: "b-root", name: "Roadmap backlog", parentId: null, rank: 0, labelIds: ["l-roadmap"], minutes: 15 },
      { id: "b-child", name: "Sprint 1", parentId: "b-root", rank: 0, labelIds: [], minutes: 0 },
    ],
    statusesByBacklog: {
      "b-child": [{ key: "review", label: "In review", color: "#8b5cf6", rank: 2 }],
    },
    teams: [{ id: "team-1", name: "Jarno" }],
    labels: [
      { id: "l-urgent", name: "Urgent", color: "#ef4444" },
      { id: "l-roadmap", name: "Roadmap", color: "#6366f1" },
    ],
    items: [
      {
        id: "parent",
        title: "Parent item",
        description: "Line one\nLine two",
        points: 5,
        status: "in_progress",
        parentId: null,
        backlogId: "b-root",
        rank: 1,
        teamIds: ["team-1"],
        labelIds: ["l-urgent"],
        links: [
          { url: "https://example.com/spec", altText: "Spec" },
          { url: "javascript:alert(1)", altText: "Evil" },
          { url: "www.example.org/x", altText: null },
        ],
        minutes: 90,
        totalMinutes: 120,
      },
      {
        id: "child",
        title: "Child item",
        description: null,
        points: 8,
        status: "review",
        parentId: "parent",
        backlogId: "b-child",
        rank: 1,
        teamIds: [],
        labelIds: [],
        links: [],
        minutes: 30,
        totalMinutes: 30,
      },
      {
        id: "loose",
        title: "Loose task",
        description: null,
        points: null,
        status: "done",
        parentId: null,
        backlogId: "b-root",
        rank: 2,
        teamIds: [],
        labelIds: [],
        links: [],
        minutes: 0,
        totalMinutes: 0,
      },
    ],
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
      <Routes>
        <Route path="/p/:token" element={<PublicBacklog />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpc.mockReset();
});

describe("public backlog page", () => {
  it("asks for exactly the token in the URL", async () => {
    rpc.mockResolvedValue({ data: fixture(), error: null });
    renderPage();
    await screen.findByText("Parent item");
    expect(rpc).toHaveBeenCalledWith("get_published_backlog", { _token: TOKEN });
  });

  it("shows items with their status, team, label, time and points", async () => {
    rpc.mockResolvedValue({ data: fixture(), error: null });
    renderPage();

    await screen.findByText("Parent item");
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getByText("Jarno")).toBeTruthy();
    expect(screen.getByText("Urgent")).toBeTruthy();
    // The server's total for the parent: its own 90m plus its child's 30m.
    expect(screen.getByText("2h")).toBeTruthy();
    // Backlog header: 15m on the backlog itself plus 120m on its items.
    expect(screen.getByText("2h 15m")).toBeTruthy();
    // Tree total adds the 45m logged against the tree itself.
    expect(screen.getByText("3h")).toBeTruthy();
    expect(screen.getByText("13 pts")).toBeTruthy();
    // The backlog's own label sits in its heading.
    expect(screen.getAllByText("Roadmap").length).toBeGreaterThan(0);
  });

  it("nests a child under its parent, with the child backlog's own status", async () => {
    rpc.mockResolvedValue({ data: fixture(), error: null });
    renderPage();

    await screen.findByText("Parent item");
    expect(screen.queryByText("Child item")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Child item")).toBeTruthy();
    expect(screen.getByText("In review")).toBeTruthy();
    expect(screen.getByText("30m")).toBeTruthy();
  });

  it("puts hyperlinks on the row, clickable, opening in a new tab", async () => {
    rpc.mockResolvedValue({ data: fixture(), error: null });
    renderPage();
    await screen.findByText("Parent item");

    // No click needed: the links are on the row itself.
    const spec = screen.getByText("Spec").closest("a");
    expect(spec?.getAttribute("href")).toBe("https://example.com/spec");
    expect(spec?.getAttribute("target")).toBe("_blank");
    expect(spec?.getAttribute("rel")).toContain("noopener");

    // The javascript: URL is shown, but as text — never as a link.
    expect(screen.getByText("Evil").closest("a")).toBeNull();
    expect(document.querySelectorAll('a[href^="javascript:"]').length).toBe(0);

    // A bare domain, as people type them, becomes an https link, labelled
    // by host and path since it carries no text of its own.
    const bare = screen.getByText("example.org/x").closest("a");
    expect(bare?.getAttribute("href")).toBe("https://www.example.org/x");

    // The description's first line is on the row; the rest waits behind the title.
    expect(screen.getByText(/Line one/)).toBeTruthy();
    expect(screen.queryByText(/Line two/)).toBeNull();
    fireEvent.click(screen.getByText("Parent item"));
    expect(screen.getByText(/Line two/)).toBeTruthy();
  });

  it("shows no labels or time when the organization has those features off", async () => {
    rpc.mockResolvedValue({
      data: fixture({ labelsVisible: false, timeVisible: false }),
      error: null,
    });
    renderPage();

    await screen.findByText("Parent item");
    expect(screen.queryByText("Urgent")).toBeNull();
    expect(screen.queryByText("2h")).toBeNull();
    expect(screen.queryByText("3h")).toBeNull();
    // Teams are not gated by any setting.
    expect(screen.getByText("Jarno")).toBeTruthy();
  });

  it("shows no status pill when the link hides statuses", async () => {
    // The server sends a hidden status as null; the page must not fall back to
    // a label for it.
    const data = fixture({ statusVisible: false, statusesByBacklog: {} });
    for (const item of data.items as { status: string | null }[]) item.status = null;
    rpc.mockResolvedValue({ data, error: null });
    renderPage();

    await screen.findByText("Parent item");
    expect(screen.queryByText("In Progress")).toBeNull();
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.getByText("Jarno")).toBeTruthy();
  });

  it("shows the server's item total even when children are not on the page", async () => {
    // The app counts every child, including ones in backlogs this link does
    // not show. Those arrive only as part of the total, never as items, so the
    // page must display the total as sent rather than re-add what it can see.
    const data = fixture();
    (data.items as { id: string; totalMinutes: number }[]).find((i) => i.id === "parent")!.totalMinutes = 200;
    rpc.mockResolvedValue({ data, error: null });
    renderPage();

    await screen.findByText("Parent item");
    expect(screen.getByText("3h 20m")).toBeTruthy();
  });

  it("names the tree above a published backlog, but not when it repeats the backlog's name", async () => {
    // The small line above the heading, naming the tree.
    const kicker = () => document.querySelector("header p");

    rpc.mockResolvedValue({ data: fixture({ kind: "backlog", rootBacklogId: "b-root" }), error: null });
    const { unmount } = renderPage();
    // Different names: the tree is worth naming above the heading. The backlog's
    // own name is on the page three times over — heading, nav and section — so
    // this waits on all of them rather than a single match.
    await screen.findAllByText("Roadmap backlog");
    expect(kicker()?.textContent).toBe("Product tree");
    unmount();

    // A tree's root backlog usually carries the tree's own name, and naming the
    // tree above the heading then just repeats it.
    const repeated = fixture({ kind: "backlog", rootBacklogId: "b-root", tree: { id: "t", name: "Roadmap backlog" } });
    rpc.mockResolvedValue({ data: repeated, error: null });
    renderPage();
    await screen.findAllByText("Roadmap backlog");
    expect(kicker()).toBeNull();
  });

  it("numbers the rows on screen, contiguously, as branches open", async () => {
    rpc.mockResolvedValue({ data: fixture(), error: null });
    renderPage();
    await screen.findByText("Parent item");

    const numbers = () =>
      [...document.querySelectorAll("[data-row-number]")].map((el) => el.textContent?.trim());
    // Collapsed: the child does not take a number, and none is skipped.
    expect(numbers()).toEqual(["1", "2"]);

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    // The child takes 2, and the row after it shifts to 3.
    expect(numbers()).toEqual(["1", "2", "3"]);
    const rows = [...document.querySelectorAll("li")].filter((li) => li.querySelector("[data-row-number]"));
    expect(rows[1].textContent).toContain("Child item");
    expect(rows[2].textContent).toContain("Loose task");
  });

  it("does not repeat the page heading as the section heading", async () => {
    // A link to a single backlog names it in the page heading; naming it again
    // just below was the same title twice.
    rpc.mockResolvedValue({ data: fixture({ kind: "backlog", rootBacklogId: "b-root" }), error: null });
    renderPage();
    await screen.findAllByText("Roadmap backlog");

    const h2 = document.querySelector("h2");
    expect(h2?.textContent).toBe("Roadmap backlog");
    // Kept for screen readers, out of sight.
    expect(h2?.className).toContain("sr-only");
  });

  it("shows a description's first line on the row, with its address as a link", async () => {
    // What the GitHub integration writes: a line of context and a URL. Nobody
    // can type a description in the app, so this is the shape that matters.
    const data = fixture();
    (data.items as { id: string; description: string | null }[]).find((i) => i.id === "loose")!.description =
      "Pushed to owner/repo@d05ac30 by jvahanii https://github.com/owner/repo/commit/d05ac30";
    rpc.mockResolvedValue({ data, error: null });
    renderPage();
    await screen.findByText("Loose task");

    // No click needed, and the address is a real link.
    const link = screen.getByText("https://github.com/owner/repo/commit/d05ac30").closest("a");
    expect(link?.getAttribute("href")).toBe("https://github.com/owner/repo/commit/d05ac30");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    // The words around it stay words.
    expect(screen.getByText(/Pushed to owner\/repo@d05ac30/)).toBeTruthy();
  });

  it("selects a row on click, and opens its first link on Enter", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    rpc.mockResolvedValue({ data: fixture(), error: null });
    renderPage();
    await screen.findByText("Parent item");

    const row = document.querySelector('[data-item-id="parent"]')!;
    fireEvent.click(row);
    expect(row.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(window, { key: "Enter" });
    // The first *safe* address: the javascript: one is never opened.
    expect(open).toHaveBeenCalledWith("https://example.com/spec", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("walks the selection with the arrow keys, and Enter is quiet without a link", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    rpc.mockResolvedValue({ data: fixture(), error: null });
    renderPage();
    await screen.findByText("Parent item");

    const selected = () => document.querySelector('[aria-selected="true"]')?.getAttribute("data-item-id") ?? null;
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(selected()).toBe("parent");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    // "Child item" is collapsed, so the next row is the loose one.
    expect(selected()).toBe("loose");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(open).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(selected()).toBeNull();
    open.mockRestore();
  });

  it("says the link is unavailable when the token matches nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    renderPage();
    expect(await screen.findByText("This link isn't available")).toBeTruthy();
    expect(screen.getByText(/may have been unpublished/)).toBeTruthy();
  });
});
