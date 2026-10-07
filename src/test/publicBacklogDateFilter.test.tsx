/**
 * Filtering a public list by deadline and by created date.
 *
 * A visitor sets a span of days — either end may be left open — for each date
 * the page shows. Pinned here: that both ends are included, that a row without
 * the date is outside any span set, that spans combine with each other and
 * with the text filter, and that the controls appear only for dates the link
 * publishes.
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
  dateFilterActive,
  filterItemNodes,
  filterSummary,
  filterTerms,
  inDateRange,
  type DateFilter,
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
    createdDatesVisible: true,
    treeMinutes: 0,
    backlogs: [{ id: "b", name: "Jobs", parentId: null, rank: 0, labelIds: [], minutes: 0 }],
    statusesByBacklog: {},
    teams: [],
    labels: [],
    items,
    ...over,
  }) as PublishedPayload;

const ids = (nodes: ItemNode[]): string[] => nodes.flatMap((n) => [n.item.id, ...ids(n.children)]);

describe("a day and a span", () => {
  it("includes both ends", () => {
    const range = { from: "2026-10-05", to: "2026-10-20" };
    expect(inDateRange("2026-10-05", range)).toBe(true);
    expect(inDateRange("2026-10-20", range)).toBe(true);
    expect(inDateRange("2026-10-04", range)).toBe(false);
    expect(inDateRange("2026-10-21", range)).toBe(false);
  });

  it("takes an open end as no limit", () => {
    expect(inDateRange("2020-01-01", { to: "2026-10-20" })).toBe(true);
    expect(inDateRange("2030-01-01", { from: "2026-10-05" })).toBe(true);
    expect(inDateRange("2026-10-04", { from: "2026-10-05" })).toBe(false);
  });

  it("puts a row with no date outside any span that is set, and inside none", () => {
    expect(inDateRange(null, { from: "2026-10-05" })).toBe(false);
    expect(inDateRange(undefined, { to: "2026-10-05" })).toBe(false);
    expect(inDateRange(null, {})).toBe(true);
    expect(inDateRange(null, undefined)).toBe(true);
  });

  it("knows whether anything is set", () => {
    expect(dateFilterActive({})).toBe(false);
    expect(dateFilterActive({ deadline: {} })).toBe(false);
    expect(dateFilterActive({ created: { from: "2026-10-01" } })).toBe(true);
  });
});

describe("which rows stay", () => {
  const data = payload([
    item("Fortum - Architect", 1, { deadline: "2026-10-05", createdOn: "2026-09-22" }),
    item("Elisa - Lead", 2, { deadline: "2026-10-18", createdOn: "2026-10-04" }),
    item("Nordea - Architect", 3, { deadline: "2026-11-02", createdOn: "2026-10-05" }),
    item("Wolt - Engineer", 4, { createdOn: "2026-10-05" }),
    item("Undated", 5),
  ]);
  const tree = buildItemTree(data.items, new Set(["b"]));
  const index = buildSearchIndex(data);
  const kept = (dates: DateFilter, text = "", match: "any" | "all" = "any") =>
    ids(filterItemNodes(tree, filterTerms(text), index, match, dates).nodes);

  it("keeps everything while nothing is set", () => {
    expect(filterItemNodes(tree, [], index, "any", {}).nodes).toBe(tree);
  });

  it("keeps the rows whose deadline falls in the span", () => {
    expect(kept({ deadline: { from: "2026-10-05", to: "2026-10-20" } })).toEqual(["Fortum - Architect", "Elisa - Lead"]);
    expect(kept({ deadline: { from: "2026-10-10" } })).toEqual(["Elisa - Lead", "Nordea - Architect"]);
  });

  it("keeps the rows made in the span", () => {
    expect(kept({ created: { from: "2026-10-04" } })).toEqual(["Elisa - Lead", "Nordea - Architect", "Wolt - Engineer"]);
    expect(kept({ created: { to: "2026-09-30" } })).toEqual(["Fortum - Architect"]);
  });

  it("asks a row to fall in both spans when both are set", () => {
    expect(kept({ deadline: { to: "2026-10-31" }, created: { from: "2026-10-01" } })).toEqual(["Elisa - Lead"]);
  });

  it("asks for the words as well, when words are typed", () => {
    expect(kept({ deadline: { from: "2026-10-01" } }, "architect")).toEqual(["Fortum - Architect", "Nordea - Architect"]);
    expect(kept({ deadline: { from: "2026-10-10" } }, "architect")).toEqual(["Nordea - Architect"]);
  });

  it("keeps the parent of a row in the span, as the way down to it", () => {
    const nested = payload([
      item("Applications", 1),
      item("Fortum", 1, { parentId: "Applications", deadline: "2026-10-05" }),
      item("Elisa", 2, { parentId: "Applications", deadline: "2026-12-01" }),
    ]);
    const result = filterItemNodes(
      buildItemTree(nested.items, new Set(["b"])),
      [],
      buildSearchIndex(nested),
      "any",
      { deadline: { to: "2026-10-31" } },
    );
    expect(ids(result.nodes)).toEqual(["Applications", "Fortum"]);
    expect(result.matched).toBe(1);
  });
});

describe("the line under the box", () => {
  const base = { total: 251, terms: [] as string[], match: "any" as const, byDate: false };

  it("says what the rows shown have in common", () => {
    expect(filterSummary({ ...base, matched: 12, byDate: true })).toBe("Showing 12 of 251 rows — those in the date range.");
    expect(filterSummary({ ...base, matched: 5, terms: ["espoo"], byDate: true })).toBe(
      "Showing 5 of 251 rows — those in the date range.",
    );
    expect(filterSummary({ ...base, matched: 5, terms: ["espoo", "lead"], match: "all", byDate: true })).toBe(
      "Showing 5 of 251 rows — those containing all of the words, in the date range.",
    );
    expect(filterSummary({ ...base, matched: 5, terms: ["espoo", "lead"] })).toBe(
      "Showing 5 of 251 rows — those containing any of the words.",
    );
    expect(filterSummary({ ...base, matched: 5, terms: ["espoo"] })).toBe("Showing 5 of 251 rows.");
  });

  it("says why nothing is shown", () => {
    expect(filterSummary({ ...base, matched: 0, byDate: true })).toBe("No rows in that date range.");
    expect(filterSummary({ ...base, matched: 0, terms: ["oulu"], byDate: true })).toBe(
      "No rows contain “oulu” in that date range.",
    );
    expect(filterSummary({ ...base, matched: 0, terms: ["oulu"] })).toBe("No rows contain “oulu”.");
  });
});

describe("on the page", () => {
  const TOKEN = "test-token-000000000000000000000";
  const items = [
    item("Fortum - Architect", 1, { deadline: "2026-10-05", createdOn: "2026-09-22" }),
    item("Elisa - Lead", 2, { deadline: "2026-10-18", createdOn: "2026-10-04" }),
    item("Nordea - Architect", 3, { deadline: "2026-11-02", createdOn: "2026-10-05" }),
    item("Undated", 4),
  ];

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
        <Routes>
          <Route path="/p/:token" element={<PublicBacklog />} />
        </Routes>
      </MemoryRouter>,
    );
  const rows = () => [...document.querySelectorAll("[data-item-id]")].map((el) => el.getAttribute("data-item-id"));
  const setDate = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: payload(items), error: null });
  });

  it("keeps the spans out of the way until asked for", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    expect(screen.queryByLabelText("Deadline from")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Date range filter" }));
    for (const label of ["Deadline from", "Deadline to", "Created from", "Created to"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("filters by a deadline span, and says how many rows are left", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    fireEvent.click(screen.getByRole("button", { name: "Date range filter" }));
    setDate("Deadline from", "2026-10-10");
    expect(rows()).toEqual(["Elisa - Lead", "Nordea - Architect"]);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 4 rows — those in the date range.");
    setDate("Deadline to", "2026-10-31");
    expect(rows()).toEqual(["Elisa - Lead"]);
  });

  it("combines a created span with the words typed", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    fireEvent.click(screen.getByRole("button", { name: "Date range filter" }));
    setDate("Created from", "2026-10-01");
    expect(rows()).toEqual(["Elisa - Lead", "Nordea - Architect"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Filter rows" }), { target: { value: "architect" } });
    expect(rows()).toEqual(["Nordea - Architect"]);
  });

  it("clears the spans in one go, and keeps them in view while one is set", async () => {
    renderPage();
    await screen.findByText("Fortum - Architect");
    const toggle = screen.getByRole("button", { name: "Date range filter" });
    fireEvent.click(toggle);
    setDate("Deadline to", "2026-10-06");
    expect(rows()).toEqual(["Fortum - Architect"]);
    // Folding the controls away would hide why the list is short; they stay.
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Deadline to")).toHaveValue("2026-10-06");

    fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));
    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers a span only for a date the link publishes", async () => {
    rpc.mockResolvedValue({ data: payload(items, { createdDatesVisible: false }), error: null });
    renderPage();
    await screen.findByText("Fortum - Architect");
    fireEvent.click(screen.getByRole("button", { name: "Date range filter" }));
    expect(screen.getByLabelText("Deadline from")).toBeInTheDocument();
    expect(screen.queryByLabelText("Created from")).not.toBeInTheDocument();
  });

  it("offers no date filter on a page that shows neither date", async () => {
    rpc.mockResolvedValue({ data: payload(items, { deadlinesVisible: false, createdDatesVisible: false }), error: null });
    renderPage();
    await screen.findByText("Fortum - Architect");
    expect(screen.queryByRole("button", { name: "Date range filter" })).not.toBeInTheDocument();
  });
});
