/**
 * Any of the words, or all of them.
 *
 * The public page's filter keeps a row containing any one of the strings typed
 * — unless the visitor asks for all, and then only rows containing every one.
 * A string still counts as part of a longer word either way.
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

const payload = (items: PublishedItem[]): PublishedPayload =>
  ({
    kind: "backlog",
    tree: { id: "t", name: "Jobs" },
    rootBacklogId: "b",
    pointsVisible: false,
    ratingsVisible: false,
    timeVisible: false,
    labelsVisible: false,
    descriptionVisible: true,
    statusVisible: false,
    teamsVisible: false,
    linksVisible: false,
    treeMinutes: 0,
    backlogs: [{ id: "b", name: "Jobs", parentId: null, rank: 0, labelIds: [], minutes: 0 }],
    statusesByBacklog: {},
    teams: [],
    labels: [],
    items,
  }) as PublishedPayload;

const ids = (nodes: ItemNode[]): string[] => nodes.flatMap((n) => [n.item.id, ...ids(n.children)]);

const data = payload([
  item("Fortum - Software Architect (Espoo)", 1),
  item("Elisa - Product Lead (Espoo)", 2),
  item("Nordea - Solution Architect (Helsinki)", 3),
  item("Wolt - Engineer", 4, { description: "Architecture guild, based in Espoo" }),
]);
const tree = buildItemTree(data.items, new Set(["b"]));
const index = buildSearchIndex(data);
const kept = (text: string, match: "any" | "all") => ids(filterItemNodes(tree, filterTerms(text), index, match).nodes);

describe("which rows stay", () => {
  it("keeps rows containing any of the words unless told otherwise", () => {
    expect(ids(filterItemNodes(tree, filterTerms("espoo architect"), index).nodes)).toHaveLength(4);
    expect(kept("espoo architect", "any")).toHaveLength(4);
  });

  it("keeps only rows containing every word when all are asked for", () => {
    expect(kept("espoo architect", "all")).toEqual(["Fortum - Software Architect (Espoo)", "Wolt - Engineer"]);
  });

  it("counts a word wherever in the row it is, and as part of a longer one", () => {
    // "architect" is inside "Architecture", in the description; "espoo" beside it.
    expect(kept("espoo architect", "all")).toContain("Wolt - Engineer");
    expect(kept("arch poo", "all")).toHaveLength(2);
  });

  it("makes no difference with a single word", () => {
    expect(kept("helsinki", "all")).toEqual(kept("helsinki", "any"));
  });

  it("asks all the words of one row, not of a parent and child between them", () => {
    const nested = payload([item("Espoo offices", 1), item("Architect", 1, { parentId: "Espoo offices" })]);
    const nestedTree = buildItemTree(nested.items, new Set(["b"]));
    const result = filterItemNodes(nestedTree, filterTerms("espoo architect"), buildSearchIndex(nested), "all");
    expect(result.nodes).toEqual([]);
    expect(result.matched).toBe(0);
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
  const type = (value: string) =>
    fireEvent.change(screen.getByRole("textbox", { name: "Filter rows" }), { target: { value } });

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data, error: null });
  });

  it("starts on Any, and narrows to rows with every word on All", async () => {
    renderPage();
    await screen.findByText("Fortum - Software Architect (Espoo)");
    const any = screen.getByRole("radio", { name: "Any" });
    const all = screen.getByRole("radio", { name: "All" });
    expect(any).toHaveAttribute("aria-checked", "true");
    expect(all).toHaveAttribute("aria-checked", "false");

    type("espoo architect");
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 4 of 4 rows — those containing any of the words.");

    fireEvent.click(all);
    expect(all).toHaveAttribute("aria-checked", "true");
    expect(rows()).toEqual(["Fortum - Software Architect (Espoo)", "Wolt - Engineer"]);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 of 4 rows — those containing all of the words.");

    fireEvent.click(any);
    expect(rows()).toHaveLength(4);
  });

  it("says so when no row has every word", async () => {
    renderPage();
    await screen.findByText("Fortum - Software Architect (Espoo)");
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    type("helsinki espoo");
    expect(rows()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("No rows contain all of those.");
  });

  it("still marks each word found on the rows that stay", async () => {
    renderPage();
    await screen.findByText("Fortum - Software Architect (Espoo)");
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    type("espoo architect");
    const marks = [...document.querySelectorAll("mark")].map((m) => m.textContent?.toLowerCase());
    expect(marks.sort()).toEqual(["architect", "architect", "espoo", "espoo"]);
  });
});
