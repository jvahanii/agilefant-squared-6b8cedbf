/**
 * The "manage your job search" call to action (2026-11-16): on a public link
 * to a list of job ads, and on no other page. It offers a copy of the list in
 * the visitor's own account, made in the app once they are signed in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import PublicBacklog from "@/pages/PublicBacklog";
import { PENDING_COPY_KEY, takeListToCopy } from "@/lib/listCopy";

const TOKEN = "test-token-000000000000000000000";
const list = {
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
  items: [
    { id: "j1", title: "Acme – Product Owner", description: null, points: null, status: "not_started", parentId: null, backlogId: "b", rank: 1, teamIds: [], labelIds: [], links: [], minutes: 0, totalMinutes: 0 },
  ],
};

function renderPage(jobFilters: boolean) {
  rpc.mockImplementation((name: string) =>
    Promise.resolve(name === "get_published_backlog" ? { data: list, error: null } : { data: { jobFilters }, error: null }),
  );
  return render(
    <MemoryRouter initialEntries={[`/p/${TOKEN}`]}>
      <Routes>
        <Route path="/p/:token" element={<PublicBacklog />} />
        <Route path="/auth/sign-up" element={<p>Sign-up page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const callout = () => screen.queryByRole("complementary", { name: /Job hunting among this many ads/ });

beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
});

describe("the job-search call to action", () => {
  it("is on a public list of job ads, and says what Agilefant is at the front page", async () => {
    renderPage(true);
    await screen.findByRole("heading", { level: 1, name: "Open jobs" });
    expect(callout()).toBeTruthy();
    expect(screen.getByText(/Make your own prioritised list of the ones you are really into. Free forever./)).toBeTruthy();
    expect(screen.getByRole("link", { name: /What is Agilefant/ }).getAttribute("href")).toBe("/");
  });

  it("copying remembers this list and goes on to sign up, or straight to the app when signed in", async () => {
    renderPage(true);
    await screen.findByRole("heading", { level: 1, name: "Open jobs" });
    fireEvent.click(screen.getByRole("button", { name: "Copy this list to my account" }));
    expect(await screen.findByText("Sign-up page")).toBeTruthy();
    expect(localStorage.getItem(PENDING_COPY_KEY)).toContain(TOKEN);
    expect(takeListToCopy()).toBe(TOKEN);
  });

  it("is not on a public list without the job-ad filters", async () => {
    renderPage(false);
    await screen.findByRole("heading", { level: 1, name: "Open jobs" });
    expect(callout()).toBeNull();
  });

  it("stays closed in this browser once closed", async () => {
    const { unmount } = renderPage(true);
    await screen.findByRole("heading", { level: 1, name: "Open jobs" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(callout()).toBeNull();
    unmount();
    renderPage(true);
    await screen.findByRole("heading", { level: 1, name: "Open jobs" });
    expect(callout()).toBeNull();
  });

  it("long words in titles may break, so a phone's page does not scroll sideways", async () => {
    renderPage(true);
    const title = await screen.findByText("Acme – Product Owner");
    expect(title.closest("span[class*='overflow-wrap:anywhere']")).toBeTruthy();
  });

  it("is used by no other page", () => {
    const pages = readdirSync(join(process.cwd(), "src/pages"));
    const using = pages.filter((f) => readFileSync(join(process.cwd(), "src/pages", f), "utf8").includes("JobSearchCallout"));
    expect(using).toEqual(["PublicBacklog.tsx"]);
  });
});
