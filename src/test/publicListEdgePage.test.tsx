/**
 * The public page takes its list from Cloudflare (2026-11-17) and asks the
 * database itself only when Cloudflare has nothing to give.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
      <Routes>
        <Route path="/p/:token" element={<PublicBacklog />} />
      </Routes>
    </MemoryRouter>,
  );

const cloudflare = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", async (url: string) => {
    expect(url).toBe(`/api/public-list/${TOKEN}`);
    return Response.json(body, { status });
  });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((name: string) =>
    Promise.resolve(name === "get_published_backlog" ? { data: list("From the database"), error: null } : { data: null, error: null }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the public page", () => {
  it("shows Cloudflare's list without asking the database", async () => {
    cloudflare({ list: list("From Cloudflare"), features: { jobFilters: false }, at: "2026-11-17T09:00:00Z" });
    renderPage();
    expect(await screen.findByText("From Cloudflare")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByText(/as it was at/)).toBeNull();
  });

  it("says when an older copy was fetched, when that is what Cloudflare had", async () => {
    cloudflare({ list: list("Older copy"), features: null, at: "2026-11-17T09:00:00Z", spare: true });
    renderPage();
    expect(await screen.findByText("Older copy")).toBeTruthy();
    expect(screen.getByText(/as it was at/)).toBeTruthy();
  });

  it("says the link is not there when Cloudflare finds no list", async () => {
    cloudflare({ list: null, features: null, at: "2026-11-17T09:00:00Z" });
    renderPage();
    expect(await screen.findByText("This link isn't available")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks the database itself when Cloudflare has nothing to give", async () => {
    cloudflare({ error: "The list could not be fetched just now" }, 503);
    renderPage();
    expect(await screen.findByText("From the database")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("get_published_backlog", { _token: TOKEN });
  });
});
