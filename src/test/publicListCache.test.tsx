/**
 * A public list is built once per change and kept (migration 20261116190000,
 * 2026-11-16). The page shows the kept copy, saying when it was built, while
 * a fresh list is slow to come or when it fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.setConfig({ testTimeout: 15_000 });

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock("@/lib/publicBacklog", async (original) => ({
  ...(await original<typeof import("@/lib/publicBacklog")>()),
  PUBLIC_LOAD_RETRY_MS: [1, 1, 1],
}));

import PublicBacklog from "@/pages/PublicBacklog";

const TOKEN = "test-token-000000000000000000000";
const list = (title: string) => ({
  kind: "backlog",
  tree: { id: "t", name: "Jobs" },
  rootBacklogId: "b",
  pointsVisible: false,
  ratingsVisible: false,
  timeVisible: false,
  labelsVisible: false,
  descriptionVisible: false,
  statusVisible: true,
  teamsVisible: false,
  linksVisible: true,
  treeMinutes: 0,
  backlogs: [{ id: "b", name: "Open jobs", parentId: null, rank: 0, labelIds: [], minutes: 0 }],
  statusesByBacklog: {},
  teams: [],
  labels: [],
  items: [{ id: "j1", title, description: null, points: null, status: "not_started", parentId: null, backlogId: "b", rank: 1, teamIds: [], labelIds: [], links: [], minutes: 0, totalMinutes: 0 }],
});
const BUILT = "2026-11-16T15:30:00Z";
const later = (ms: number, value: unknown) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

function answer(fresh: () => Promise<unknown>) {
  rpc.mockImplementation((name: string) => {
    if (name === "get_published_backlog") return fresh();
    if (name === "get_published_backlog_last") return Promise.resolve({ data: { payload: list("Kept ad"), builtAt: BUILT }, error: null });
    return Promise.resolve({ data: { jobFilters: false }, error: null });
  });
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
      <Routes>
        <Route path="/p/:token" element={<PublicBacklog />} />
      </Routes>
    </MemoryRouter>,
  );
const lastAsked = () => rpc.mock.calls.some(([name]) => name === "get_published_backlog_last");

beforeEach(() => rpc.mockReset());

describe("a public list's kept copy", () => {
  it("is not asked for when the fresh list comes at once", async () => {
    answer(() => Promise.resolve({ data: list("Fresh ad"), error: null }));
    renderPage();
    expect(await screen.findByText("Fresh ad")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 2_700));
    expect(lastAsked()).toBe(false);
    expect(screen.queryByText(/as it was at/)).toBeNull();
  });

  it("is shown, saying when it was built, while the fresh list is slow, and gives way when it comes", async () => {
    answer(() => later(4_000, { data: list("Fresh ad"), error: null }));
    renderPage();
    expect(await screen.findByText("Kept ad", {}, { timeout: 3_500 })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/This is the list as it was at .+ It could not be brought up to date just now/);
    expect(await screen.findByText("Fresh ad", {}, { timeout: 3_000 })).toBeTruthy();
    expect(screen.queryByText(/as it was at/)).toBeNull();
  });

  it("is shown instead of the error page when the fresh list fails", async () => {
    answer(() => Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout" } }));
    renderPage();
    expect(await screen.findByText("Kept ad", {}, { timeout: 3_000 })).toBeTruthy();
    expect(screen.queryByText("This link isn't available")).toBeNull();
    expect(screen.getByText(/as it was at/)).toBeTruthy();
  });
});

describe("the migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261116190000_public_list_cache.sql"), "utf8").replace(/--[^\n]*/g, "");

  it("builds only when the fingerprint changed, and may keep what it built", () => {
    expect(sql).toMatch(/FUNCTION public\.get_published_backlog\(_token text\)[\s\S]*?VOLATILE/);
    expect(sql).toMatch(/c\.fingerprint = _fingerprint/);
    expect(sql).toMatch(/ON CONFLICT \(token\) DO UPDATE/);
  });

  it("notices any item's change, not just a newer one", () => {
    for (const table of ["work_items", "work_item_hyperlinks", "work_item_backlog_ranks"]) {
      expect(sql).toContain(`coalesce(sum(extract(epoch FROM changed_at)), 0) FROM public.${table}`);
    }
    expect(sql).toMatch(/max\(deleted_at\)[\s\S]*row_deletions/);
  });

  it("lets signed-out visitors call the two list functions, and nothing else", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_published_backlog\(text\) TO anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_published_backlog_last\(text\) TO anon/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.published_backlog_fingerprint\(text\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON public\.published_backlog_cache FROM PUBLIC, anon, authenticated/);
  });

  it("gives nothing kept for a link whose organisation has public links off", () => {
    const last = sql.slice(sql.indexOf("FUNCTION public.get_published_backlog_last"));
    expect(last).toMatch(/public_links_enabled_for_tree\(_tree\)/);
  });
});
