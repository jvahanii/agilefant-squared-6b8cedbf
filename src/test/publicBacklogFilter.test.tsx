/**
 * A visitor filtering a public list by text.
 *
 * Rows that contain none of the strings typed are dropped. Pinned here: that
 * several strings mean "any of them", what counts as a row's text, that a
 * match keeps the parents above it, and that the box stays on screen.
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
  countItemNodes,
  filterItemNodes,
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

const payload = (items: PublishedItem[], over: Partial<PublishedPayload> = {}): PublishedPayload =>
  ({
    kind: "backlog",
    tree: { id: "t", name: "Jobs" },
    rootBacklogId: "b",
    pointsVisible: false,
    ratingsVisible: false,
    timeVisible: false,
    labelsVisible: true,
    descriptionVisible: true,
    statusVisible: true,
    teamsVisible: true,
    linksVisible: true,
    treeMinutes: 0,
    backlogs: [{ id: "b", name: "Jobs", parentId: null, rank: 0, labelIds: [], minutes: 0 }],
    statusesByBacklog: {},
    teams: [{ id: "team-1", name: "Recruiting" }],
    labels: [{ id: "l-1", name: "Remote", color: "#000" }],
    items,
    ...over,
  }) as PublishedPayload;

const ids = (nodes: ItemNode[]): string[] => nodes.flatMap((n) => [n.item.id, ...ids(n.children)]);

describe("the strings typed", () => {
  it("are split on spaces and commas, lower-cased, and counted once", () => {
    expect(filterTerms("  Helsinki,espoo   HELSINKI ")).toEqual(["helsinki", "espoo"]);
    expect(filterTerms("   ")).toEqual([]);
  });
});

describe("which rows stay", () => {
  const data = payload([
    item("Fortum - Analyst (Espoo)", 1),
    item("Elisa - Lead (Helsinki)", 2),
    item("Nordea - Quant (Stockholm)", 3),
  ]);
  const tree = buildItemTree(data.items, new Set(["b"]));
  const index = buildSearchIndex(data);
  const kept = (text: string) => ids(filterItemNodes(tree, filterTerms(text), index).nodes);

  it("keeps everything while the box is empty", () => {
    const all = filterItemNodes(tree, [], index);
    expect(all.nodes).toBe(tree);
    expect(all.matched).toBe(3);
  });

  it("keeps the rows containing the string, whatever its case", () => {
    expect(kept("helsinki")).toEqual(["Elisa - Lead (Helsinki)"]);
    expect(kept("LEAD")).toEqual(["Elisa - Lead (Helsinki)"]);
  });

  it("keeps a row containing any one of several strings", () => {
    expect(kept("helsinki espoo")).toEqual(["Fortum - Analyst (Espoo)", "Elisa - Lead (Helsinki)"]);
  });

  it("drops every row when none contains any of them", () => {
    const none = filterItemNodes(tree, filterTerms("tampere oulu"), index);
    expect(none.nodes).toEqual([]);
    expect(none.matched).toBe(0);
  });

  it("matches part of a word", () => {
    expect(kept("stock")).toEqual(["Nordea - Quant (Stockholm)"]);
  });
});

describe("what counts as a row's text", () => {
  const data = payload([
    item("plain", 1),
    item("described", 2, { description: "Apply through the Workday portal" }),
    item("linked", 3, { links: [{ url: "https://careers.example.com/job/42", altText: "Posting at Example" }] }),
    item("teamed", 4, { teamIds: ["team-1"] }),
    item("labelled", 5, { labelIds: ["l-1"] }),
    item("stated", 6, { status: "in_progress" }),
  ]);
  const tree = buildItemTree(data.items, new Set(["b"]));
  const index = buildSearchIndex(data);
  const kept = (text: string) => ids(filterItemNodes(tree, filterTerms(text), index).nodes);

  it("includes the description, link labels and addresses, teams, labels and status", () => {
    expect(kept("workday")).toEqual(["described"]);
    expect(kept("posting")).toEqual(["linked"]);
    expect(kept("careers.example.com")).toEqual(["linked"]);
    expect(kept("recruiting")).toEqual(["teamed"]);
    expect(kept("remote")).toEqual(["labelled"]);
    expect(kept("progress")).toEqual(["stated"]);
  });
});

describe("a match beneath other rows", () => {
  const data = payload([
    item("Applications", 1),
    item("Fortum", 1, { parentId: "Applications" }),
    item("Elisa", 2, { parentId: "Applications" }),
    item("Archive", 2),
    item("Nordea", 1, { parentId: "Archive" }),
  ]);
  const tree = buildItemTree(data.items, new Set(["b"]));
  const index = buildSearchIndex(data);

  it("keeps its parents as the way down to it, and drops its siblings", () => {
    const result = filterItemNodes(tree, filterTerms("elisa"), index);
    expect(ids(result.nodes)).toEqual(["Applications", "Elisa"]);
    // Only the row that matched is counted, not the parent kept to reach it.
    expect(result.matched).toBe(1);
  });

  it("drops the children of a matching parent that do not match themselves", () => {
    expect(ids(filterItemNodes(tree, filterTerms("archive"), index).nodes)).toEqual(["Archive"]);
  });

  it("counts every row at every depth", () => {
    expect(countItemNodes(tree)).toBe(5);
  });
});

describe("on the page", () => {
  const TOKEN = "test-token-000000000000000000000";
  const data = payload([
    item("Fortum - Analyst (Espoo)", 1),
    item("Elisa - Lead (Helsinki)", 2),
    item("Applications", 3),
    item("Nordea - Quant (Stockholm)", 1, { parentId: "Applications" }),
  ]);

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
        <Routes>
          <Route path="/p/:token" element={<PublicBacklog />} />
        </Routes>
      </MemoryRouter>,
    );

  const rows = () => [...document.querySelectorAll("[data-item-id]")].map((el) => el.getAttribute("data-item-id"));
  const box = () => screen.getByRole("textbox", { name: "Filter rows" });

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data, error: null });
  });

  it("filters as the visitor types, and says how many rows are left", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    expect(rows()).toHaveLength(3); // the child is folded away

    fireEvent.change(box(), { target: { value: "espoo helsinki" } });
    expect(rows()).toEqual(["Fortum - Analyst (Espoo)", "Elisa - Lead (Helsinki)"]);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 4 rows");
  });

  it("opens the branch a match sits in, and numbers what is shown", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    fireEvent.change(box(), { target: { value: "stockholm" } });
    expect(rows()).toEqual(["Applications", "Nordea - Quant (Stockholm)"]);
    const numbers = [...document.querySelectorAll("[data-row-number]")].map((el) => el.textContent?.trim());
    expect(numbers).toEqual(["1", "2"]);
  });

  it("says so when nothing matches, and brings the list back when cleared", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    fireEvent.change(box(), { target: { value: "tampere" } });
    expect(rows()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("No rows contain “tampere”.");

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(rows()).toHaveLength(3);
    expect(box()).toHaveValue("");
  });

  it("clears on Escape, without the page's own shortcuts firing", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    fireEvent.change(box(), { target: { value: "espoo" } });
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(box()).toHaveValue("");
    expect(rows()).toHaveLength(3);
  });

  it("keeps the box stuck to the top of the window", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    expect(box().closest(".sticky")).toHaveClass("top-0");
  });

  it("offers no box on a list with nothing in it", async () => {
    rpc.mockResolvedValue({ data: payload([]), error: null });
    renderPage();
    await screen.findByText("Nothing in this list yet.");
    expect(screen.queryByRole("textbox", { name: "Filter rows" })).not.toBeInTheDocument();
  });
});
