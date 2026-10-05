/**
 * A visitor sorting a public list by the dates it shows.
 *
 * The order is theirs alone and for as long as the page is open: nothing is
 * saved. Pinned here: what each click on a heading asks for, that undated rows
 * come last whichever way the list runs, that only the top level moves, and
 * that the headings appear only for dates the link actually publishes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import PublicBacklog from "@/pages/PublicBacklog";
import { nextPublicSort, sortItemNodes, type ItemNode, type PublishedItem } from "@/lib/publicBacklog";

const item = (id: string, rank: number, extra: Partial<PublishedItem> = {}): PublishedItem => ({
  id,
  title: id,
  description: null,
  points: null,
  rating: null,
  status: "not_started",
  parentId: null,
  backlogId: "b",
  rank,
  teamIds: [],
  labelIds: [],
  links: [],
  minutes: 0,
  totalMinutes: 0,
  ...extra,
});

const node = (i: PublishedItem, children: ItemNode[] = []): ItemNode => ({ item: i, children });
const ids = (nodes: ItemNode[]) => nodes.map((n) => n.item.id);

describe("what a click on a heading asks for", () => {
  it("gives deadlines soonest first, then latest first, then the owner's order", () => {
    const first = nextPublicSort(null, "deadline");
    expect(first).toEqual({ by: "deadline", direction: "asc" });
    const second = nextPublicSort(first, "deadline");
    expect(second).toEqual({ by: "deadline", direction: "desc" });
    expect(nextPublicSort(second, "deadline")).toBeNull();
  });

  it("gives created dates newest first, then oldest first, then the owner's order", () => {
    const first = nextPublicSort(null, "created");
    expect(first).toEqual({ by: "created", direction: "desc" });
    const second = nextPublicSort(first, "created");
    expect(second).toEqual({ by: "created", direction: "asc" });
    expect(nextPublicSort(second, "created")).toBeNull();
  });

  it("starts the other heading's cycle afresh", () => {
    expect(nextPublicSort({ by: "deadline", direction: "desc" }, "created")).toEqual({ by: "created", direction: "desc" });
  });
});

describe("the order itself", () => {
  const nodes = [
    node(item("a", 1, { deadline: "2026-10-20", createdOn: "2026-09-01" })),
    node(item("none", 2)),
    node(item("b", 3, { deadline: "2026-10-05", createdOn: "2026-09-20" })),
    node(item("c", 4, { deadline: "2026-10-05", createdOn: "2026-08-10" })),
  ];

  it("leaves the owner's order alone until asked", () => {
    expect(sortItemNodes(nodes, null)).toBe(nodes);
  });

  it("sorts by deadline either way, ties in the owner's order", () => {
    expect(ids(sortItemNodes(nodes, { by: "deadline", direction: "asc" }))).toEqual(["b", "c", "a", "none"]);
    expect(ids(sortItemNodes(nodes, { by: "deadline", direction: "desc" }))).toEqual(["a", "b", "c", "none"]);
  });

  it("sorts by created date either way", () => {
    expect(ids(sortItemNodes(nodes, { by: "created", direction: "desc" }))).toEqual(["b", "a", "c", "none"]);
    expect(ids(sortItemNodes(nodes, { by: "created", direction: "asc" }))).toEqual(["c", "a", "b", "none"]);
  });

  it("keeps rows without the date last, whichever way the list runs", () => {
    for (const direction of ["asc", "desc"] as const) {
      expect(ids(sortItemNodes(nodes, { by: "deadline", direction })).at(-1)).toBe("none");
      expect(ids(sortItemNodes(nodes, { by: "created", direction })).at(-1)).toBe("none");
    }
  });

  it("moves only the top level; children stay as their owner ranked them", () => {
    const parent = node(item("parent", 1, { createdOn: "2026-01-01" }), [
      node(item("old-child", 1, { createdOn: "2025-01-01" })),
      node(item("new-child", 2, { createdOn: "2026-06-01" })),
    ]);
    const sorted = sortItemNodes([parent, node(item("other", 2, { createdOn: "2026-05-01" }))], { by: "created", direction: "desc" });
    expect(ids(sorted)).toEqual(["other", "parent"]);
    expect(ids(sorted[1].children)).toEqual(["old-child", "new-child"]);
  });
});

describe("on the page", () => {
  const TOKEN = "test-token-000000000000000000000";
  const page = (over: Record<string, unknown> = {}) => ({
    kind: "backlog",
    tree: { id: "t", name: "Jobs" },
    rootBacklogId: "b",
    pointsVisible: false,
    ratingsVisible: false,
    timeVisible: false,
    labelsVisible: false,
    descriptionVisible: false,
    statusVisible: false,
    teamsVisible: false,
    linksVisible: false,
    deadlinesVisible: true,
    createdDatesVisible: true,
    treeMinutes: 0,
    backlogs: [{ id: "b", name: "Jobs", parentId: null, rank: 0, labelIds: [], minutes: 0 }],
    statusesByBacklog: {},
    teams: [],
    labels: [],
    items: [
      item("Fortum", 1, { deadline: "2026-10-20", createdOn: "2026-09-01" }),
      item("Elisa", 2, { deadline: "2026-10-05", createdOn: "2026-09-20" }),
      item("Nordea", 3),
    ],
    ...over,
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
        <Routes>
          <Route path="/p/:token" element={<PublicBacklog />} />
        </Routes>
      </MemoryRouter>,
    );

  const rows = () => [...document.querySelectorAll("[data-item-id]")].map((el) => el.getAttribute("data-item-id"));

  beforeEach(() => rpc.mockReset());

  it("heads the dates it shows, and sorts by the one clicked", async () => {
    rpc.mockResolvedValue({ data: page(), error: null });
    renderPage();
    await screen.findByText("Fortum");
    expect(rows()).toEqual(["Fortum", "Elisa", "Nordea"]);

    const deadline = screen.getByRole("button", { name: /^Deadline/ });
    const created = screen.getByRole("button", { name: /^Created/ });

    fireEvent.click(deadline); // soonest first
    expect(rows()).toEqual(["Elisa", "Fortum", "Nordea"]);
    expect(deadline).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(created); // newest first, and the deadline sort lets go
    expect(rows()).toEqual(["Elisa", "Fortum", "Nordea"]);
    expect(deadline).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(created); // oldest first
    expect(rows()).toEqual(["Fortum", "Elisa", "Nordea"]);
    fireEvent.click(created); // back to the owner's order
    expect(rows()).toEqual(["Fortum", "Elisa", "Nordea"]);
    expect(created).toHaveAttribute("aria-pressed", "false");
  });

  it("renumbers the rows in the order shown", async () => {
    rpc.mockResolvedValue({ data: page(), error: null });
    renderPage();
    await screen.findByText("Fortum");
    fireEvent.click(screen.getByRole("button", { name: /^Deadline/ }));
    const numbered = [...document.querySelectorAll("[data-item-id]")].map(
      (el) => `${el.querySelector("[data-row-number]")?.textContent?.trim()} ${el.getAttribute("data-item-id")}`,
    );
    expect(numbered).toEqual(["1 Elisa", "2 Fortum", "3 Nordea"]);
  });

  it("shows each row's created date under its heading", async () => {
    rpc.mockResolvedValue({ data: page(), error: null });
    renderPage();
    await screen.findByText("Fortum");
    expect(screen.getByTitle("Created 2026-09-01")).toBeInTheDocument();
    expect(screen.getByTitle("Created 2026-09-20")).toBeInTheDocument();
  });

  it("offers no heading for a date the link does not publish", async () => {
    rpc.mockResolvedValue({ data: page({ createdDatesVisible: false }), error: null });
    renderPage();
    await screen.findByText("Fortum");
    expect(screen.getByRole("button", { name: /^Deadline/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Created/ })).not.toBeInTheDocument();
  });

  it("offers no headings at all on a page that shows neither date", async () => {
    rpc.mockResolvedValue({ data: page({ deadlinesVisible: false, createdDatesVisible: false }), error: null });
    renderPage();
    await screen.findByText("Fortum");
    expect(screen.queryByRole("button", { name: /^Deadline/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Created/ })).not.toBeInTheDocument();
  });
});
