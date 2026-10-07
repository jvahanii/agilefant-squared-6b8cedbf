/**
 * Leaving out the rows with no deadline on a public list.
 *
 * A switch in the filter bar, off to begin with. Pinned here: which rows stay,
 * that a dated row keeps the undated rows above it as its way down, that it
 * combines with the words and the date spans, what the line under the box
 * says, and that the switch is there only where the link shows deadlines.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import PublicBacklog from "@/pages/PublicBacklog";
import {
  buildItemTree,
  buildSearchIndex,
  filterItemNodes,
  filterSummary,
  filterTerms,
  type ItemNode,
  type PublishedItem,
  type PublishedPayload,
} from "@/lib/publicBacklog";

const item = (id: string, rank: number, extra: Partial<PublishedItem> = {}): PublishedItem => ({
  id,
  title: id,
  description: null,
  points: null,
  rating: null,
  status: null,
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

const payload = (items: PublishedItem[], over: Record<string, unknown> = {}): PublishedPayload =>
  ({
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
    createdDatesVisible: false,
    treeMinutes: 0,
    backlogs: [{ id: "b", name: "Jobs", parentId: null, rank: 0, labelIds: [], minutes: 0 }],
    statusesByBacklog: {},
    teams: [],
    labels: [],
    items,
    ...over,
  }) as PublishedPayload;

const ids = (nodes: ItemNode[]): string[] => nodes.flatMap((n) => [n.item.id, ...ids(n.children)]);

const ITEMS = [
  item("Fortum - Architect", 1, { deadline: "2026-10-05" }),
  item("Open application", 2),
  item("Nordea - Architect", 3, { deadline: "2026-11-02" }),
  item("Group", 4),
  item("Elisa - Lead", 1, { parentId: "Group", deadline: "2026-10-18" }),
  item("Undated child", 2, { parentId: "Group" }),
];

describe("which rows stay", () => {
  const p = payload(ITEMS);
  const tree = buildItemTree(p.items, new Set(["b"]));
  const index = buildSearchIndex(p);
  const kept = (words: string, withDeadlineOnly: boolean, dates = {}) =>
    filterItemNodes(tree, filterTerms(words), index, "any", dates, withDeadlineOnly);

  it("keeps everything while the switch is off", () => {
    expect(kept("", false).nodes).toBe(tree);
  });

  it("keeps the rows with a deadline, and the undated row above one as the way down to it", () => {
    const { nodes, matched } = kept("", true);
    expect(ids(nodes)).toEqual(["Fortum - Architect", "Nordea - Architect", "Group", "Elisa - Lead"]);
    // The undated parent is shown, not counted.
    expect(matched).toBe(3);
  });

  it("asks for the words as well, when words are typed", () => {
    expect(ids(kept("architect open", true).nodes)).toEqual(["Fortum - Architect", "Nordea - Architect"]);
    expect(ids(kept("open", true).nodes)).toEqual([]);
  });

  it("asks for the span as well, when one is set", () => {
    expect(ids(kept("", true, { deadline: { from: "2026-10-10" } }).nodes)).toEqual([
      "Nordea - Architect",
      "Group",
      "Elisa - Lead",
    ]);
  });
});

describe("the line under the box", () => {
  const base = { total: 6, terms: [] as string[], match: "any" as const, byDate: false };

  it("says the rows shown are the ones with a deadline", () => {
    expect(filterSummary({ ...base, matched: 3, withDeadlineOnly: true })).toBe("Showing 3 of 6 rows — those with a deadline.");
    expect(filterSummary({ ...base, matched: 2, byDate: true, withDeadlineOnly: true })).toBe(
      "Showing 2 of 6 rows — those in the date range, with a deadline.",
    );
    expect(filterSummary({ ...base, matched: 1, terms: ["a", "b"], withDeadlineOnly: true })).toBe(
      "Showing 1 of 6 rows — those containing any of the words, with a deadline.",
    );
  });

  it("says why nothing is shown", () => {
    expect(filterSummary({ ...base, matched: 0, withDeadlineOnly: true })).toBe("No rows have a deadline.");
    expect(filterSummary({ ...base, matched: 0, byDate: true, withDeadlineOnly: true })).toBe(
      "No rows with a deadline in that date range.",
    );
    expect(filterSummary({ ...base, matched: 0, terms: ["open"], withDeadlineOnly: true })).toBe(
      "No rows contain “open” and have a deadline.",
    );
  });

  it("says what it said before while the switch is off", () => {
    expect(filterSummary({ ...base, matched: 0, byDate: true })).toBe("No rows in that date range.");
    expect(filterSummary({ ...base, matched: 2, byDate: true })).toBe("Showing 2 of 6 rows — those in the date range.");
  });
});

describe("on the page", () => {
  const TOKEN = "test-token-000000000000000000000";
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
        <Routes>
          <Route path="/p/:token" element={<PublicBacklog />} />
        </Routes>
      </MemoryRouter>,
    );
  const rows = () => [...document.querySelectorAll("[data-item-id]")].map((el) => el.getAttribute("data-item-id"));
  const toggle = () => screen.getByRole("switch", { name: "Show only jobs with deadline" });

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: payload(ITEMS), error: null });
  });

  it("starts off, showing every row", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    expect(toggle()).toHaveAttribute("aria-checked", "false");
    expect(toggle()).toHaveTextContent("Show only jobs with deadline");
    expect(toggle().querySelector("[data-state]")).toHaveAttribute("data-state", "off");
    // The group is folded, so its children are not on screen yet.
    expect(rows()).toEqual(["Fortum - Architect", "Open application", "Nordea - Architect", "Group"]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("leaves out the rows with no deadline when switched on, and says how many are left", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-checked", "true");
    // Drawn as an on/off switch, whose knob has moved across.
    expect(toggle().querySelector("[data-state]")).toHaveAttribute("data-state", "on");
    // The group opens by itself: the dated row inside it is why it is still here.
    expect(rows()).toEqual(["Fortum - Architect", "Nordea - Architect", "Group", "Elisa - Lead"]);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 3 of 6 rows — those with a deadline.");
  });

  it("brings every row back when switched off again", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(rows()).toEqual(["Fortum - Architect", "Open application", "Nordea - Architect", "Group"]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("works together with the words typed", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    fireEvent.click(toggle());
    fireEvent.change(screen.getByRole("textbox", { name: "Filter rows" }), { target: { value: "architect" } });
    expect(rows()).toEqual(["Fortum - Architect", "Nordea - Architect"]);
  });

  it("is not offered on a page that does not show deadlines", async () => {
    rpc.mockResolvedValue({ data: payload(ITEMS, { deadlinesVisible: false }), error: null });
    renderPage();
    await screen.findByText("Fortum - Architect");
    expect(screen.queryByRole("switch", { name: "Show only jobs with deadline" })).not.toBeInTheDocument();
  });
});
