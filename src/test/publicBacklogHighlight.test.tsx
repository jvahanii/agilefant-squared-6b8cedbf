/**
 * Marking what the public page's filter found.
 *
 * A row stays in a filtered list because it contains one of the strings typed;
 * the marks show which one, and where. Pinned here: how a text is cut into
 * matched and unmatched stretches, that the marks appear only while a filter
 * is on and only on the rows, and that a match folded away in a description
 * is brought into view rather than left unmarked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import PublicBacklog from "@/pages/PublicBacklog";
import { highlightSegments, type PublishedItem } from "@/lib/publicBacklog";

const hits = (text: string, terms: string[]) => highlightSegments(text, terms).filter((s) => s.hit).map((s) => s.text);

describe("cutting a text into its matches", () => {
  it("marks every occurrence, keeping the text's own case", () => {
    expect(highlightSegments("Helsinki or helsinki", ["helsinki"])).toEqual([
      { text: "Helsinki", hit: true },
      { text: " or ", hit: false },
      { text: "helsinki", hit: true },
    ]);
  });

  it("marks each of several strings", () => {
    expect(hits("Lead in Espoo and Helsinki", ["espoo", "helsinki"])).toEqual(["Espoo", "Helsinki"]);
  });

  it("joins matches that overlap or touch into one", () => {
    expect(hits("Helsinki", ["hels", "sinki"])).toEqual(["Helsinki"]);
    expect(hits("Helsinki", ["hel", "sinki"])).toEqual(["Helsinki"]);
  });

  it("returns the text whole when nothing matches or nothing is asked", () => {
    expect(highlightSegments("Tampere", ["oulu"])).toEqual([{ text: "Tampere", hit: false }]);
    expect(highlightSegments("Tampere", [])).toEqual([{ text: "Tampere", hit: false }]);
    expect(highlightSegments("", ["x"])).toEqual([]);
  });

  it("puts the pieces back together as the text it was given", () => {
    const text = "Senior Lead, Helsinki / Espoo (hybrid)";
    expect(highlightSegments(text, ["lead", "espoo", "hy"]).map((s) => s.text).join("")).toBe(text);
  });
});

describe("on the page", () => {
  const TOKEN = "test-token-000000000000000000000";
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
  const data = {
    kind: "backlog",
    tree: { id: "t", name: "Jobs" },
    rootBacklogId: "b",
    pointsVisible: false,
    ratingsVisible: false,
    timeVisible: false,
    labelsVisible: true,
    descriptionVisible: true,
    statusVisible: false,
    teamsVisible: true,
    linksVisible: true,
    treeMinutes: 0,
    backlogs: [{ id: "b", name: "Jobs", parentId: null, rank: 0, labelIds: ["l-1"], minutes: 0 }],
    statusesByBacklog: {},
    teams: [{ id: "team-1", name: "Recruiting" }],
    labels: [{ id: "l-1", name: "Remote", color: "#000" }],
    items: [
      item("Fortum - Analyst (Espoo)", 1, { labelIds: ["l-1"] }),
      item("Elisa - Lead (Helsinki)", 2, { teamIds: ["team-1"], links: [{ url: "https://x.example/1", altText: "Elisa posting" }] }),
      item("Nordea - Quant", 3, { description: "Stockholm office\nRelocation to Helsinki is possible" }),
    ],
  };

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
        <Routes>
          <Route path="/p/:token" element={<PublicBacklog />} />
        </Routes>
      </MemoryRouter>,
    );

  const marks = () => [...document.querySelectorAll("mark")].map((m) => m.textContent);
  const type = (value: string) =>
    fireEvent.change(screen.getByRole("textbox", { name: "Filter rows" }), { target: { value } });

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data, error: null });
  });

  it("marks nothing until something is typed", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    expect(marks()).toEqual([]);
  });

  it("marks the string in the titles of the rows that stay", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    type("espoo");
    expect(marks()).toEqual(["Espoo"]);
  });

  it("marks it in link labels, team names and labels as well", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    type("elisa recruit remote");
    // The title and the link label of the Elisa row, its team, and the Fortum row's label.
    expect(marks().sort()).toEqual(["Elisa", "Elisa", "Recruit", "Remote"]);
  });

  it("leaves the list's own labels, above the rows, unmarked", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    type("remote");
    // "Remote" is on the list's heading too; only the row's copy is marked.
    expect(screen.getAllByText("Remote")).toHaveLength(2);
    expect(marks()).toEqual(["Remote"]);
  });

  it("opens a description whose folded part holds the match, and marks it there", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    expect(screen.queryByText(/Relocation to/)).not.toBeInTheDocument();
    type("relocation");
    expect(marks()).toEqual(["Relocation"]);
    expect(screen.getByText(/to Helsinki is possible/)).toBeInTheDocument();
  });

  it("takes the marks away with the filter", async () => {
    renderPage();
    await screen.findByText("Fortum - Analyst (Espoo)");
    type("espoo");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(marks()).toEqual([]);
    expect(screen.getByText("Fortum - Analyst (Espoo)")).toBeInTheDocument();
  });
});
