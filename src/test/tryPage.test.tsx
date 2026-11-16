/**
 * /try runs the real app on an example organisation with the database
 * switched off (2026-11-16): the examples are what the app shows, nothing
 * reaches the database, and only what the visitor adds is kept for sign-up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The page's own part is under test, not the app it shows.
vi.mock("@/components/AppLayout", () => ({
  default: ({ banner, tryOut }: { banner?: React.ReactNode; tryOut?: boolean }) => (
    <div data-testid="app" data-try-out={String(tryOut)}>
      {banner}
    </div>
  ),
}));

import Try from "@/pages/Try";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/demoMode";
import { demoContent, DEMO_ORG, visitorOutline } from "@/lib/demoContent";
import { loadTryList, saveTryList, TRY_LIST_KEY } from "@/lib/tryList";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import type { WorkItem } from "@/types/models";

const titles = () => Object.values(useAppStore.getState().workItems).map((i) => i.title);

beforeEach(() => localStorage.clear());

describe("the example organisation", () => {
  const today = new Date("2026-11-16T10:00:00Z");
  const demo = demoContent(today);
  const trees = Object.values(demo.backlogTrees).map((t) => t.name);

  it("has one person's lists and a team's, with nesting, a deadline, done items and a board", () => {
    expect(trees).toEqual(["Personal", "Team"]);
    const items = Object.values(demo.workItems);
    expect(items.some((i) => i.childrenIds.length > 0)).toBe(true);
    expect(items.some((i) => i.status === "done")).toBe(true);
    expect(Object.values(demo.backlogs).some((b) => b.viewMode === "board")).toBe(true);
    expect(items.every((i) => i.id.startsWith(`${DEMO_ORG}::`))).toBe(true);
  });

  it("counts deadlines from today, and was made a month ago so the new-account checklist stays away", () => {
    const deadlines = Object.values(demo.workItems).map((i) => i.deadline).filter(Boolean) as string[];
    expect(deadlines.length).toBeGreaterThan(0);
    expect(deadlines.every((d) => d > "2026-11-16")).toBe(true);
    expect(new Set(Object.values(demo.workItems).map((i) => i.createdOn))).toEqual(new Set(["2026-10-17"]));
  });
});

describe("the try-out page", () => {
  it("shows the app in try-out mode, under a bar that says nothing is saved", () => {
    render(<Try />);
    expect(screen.getByTestId("app").dataset.tryOut).toBe("true");
    expect(screen.getByText("Try-out")).toBeTruthy();
    expect(screen.getByText(/Nothing is saved, but what you add comes with you/)).toBeTruthy();
    // Plain links: leaving reloads, so a real session never runs on the stand-in client.
    expect(screen.getByRole("link", { name: "Sign up to keep it" }).getAttribute("href")).toBe("/auth/sign-up");
    expect(screen.getByRole("link", { name: "Front page" }).getAttribute("href")).toBe("/");
  });

  it("opens on the examples, with boards and deadlines on, and the database off", async () => {
    render(<Try />);
    expect(isDemoMode()).toBe(true);
    expect(useOrgStore.getState().activeOrgId).toBe(DEMO_ORG);
    expect(useOrgSettingsStore.getState().settings[DEMO_ORG]).toMatchObject({ boardsEnabled: true, deadlinesEnabled: true });
    expect(titles()).toContain("Plan the trip to Lapland");
    expect(useAppStore.getState().backlogs[useAppStore.getState().selectedBacklogIds[0]]?.name).toBe("This week");

    // The database answers itself: reads empty, writes done, nothing sent.
    await expect(supabase.from("work_items").select("*").eq("id", "x")).resolves.toMatchObject({ data: [], error: null });
    await expect(supabase.from("work_items").upsert({} as never).select().maybeSingle()).resolves.toMatchObject({ data: null, error: null });
    await expect(supabase.functions.invoke("x")).resolves.toMatchObject({ error: { message: "Not available in the try-out" } });

    // And a reload of the data cannot wipe the examples.
    await useAppStore.getState().loadFromSupabase();
    expect(titles()).toContain("Plan the trip to Lapland");
  });

  it("keeps what the visitor adds for sign-up, and not the examples", () => {
    render(<Try />);
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
    const { backlogTrees, selectedBacklogIds } = useAppStore.getState();
    const tree = Object.values(backlogTrees).find((t) => t.name === "Personal")!;
    act(() => useAppStore.getState().addWorkItem("Buy a present", null, selectedBacklogIds[0], tree.id, 0));
    expect(loadTryList()?.map((i) => i.title)).toEqual(["Buy a present"]);
  });

  it("brings back what the visitor added before a reload", () => {
    saveTryList([{ id: "a", title: "From before", depth: 0, done: false }]);
    render(<Try />);
    expect(titles().filter((t) => t === "From before")).toHaveLength(1);
    expect(useAppStore.getState().undoStack).toHaveLength(0);
  });
});

describe("the visitor's outline", () => {
  it("leaves the examples out and keeps the nesting among the visitor's own items", () => {
    const demo = demoContent();
    const items: Record<string, WorkItem> = { ...demo.workItems };
    const tree = Object.values(demo.backlogTrees)[0];
    const list = tree.rootBacklogIds[0];
    const example = Object.values(items).find((i) => i.backlogAssignments[tree.id] === list && !i.parentId)!;
    const mk = (id: string, title: string, parentId: string | null, rank: number, status = "not_started") =>
      ({ id, title, parentId, childrenIds: [], status, backlogAssignments: { [tree.id]: list }, ranks: { [list]: rank } }) as WorkItem;
    items.mine = mk("mine", "Mine", null, -1);
    items.sub = mk("sub", "Under mine", "mine", 0, "done");
    items.mine.childrenIds = ["sub"];
    items.underExample = mk("underExample", "Under an example", example.id, 99);
    items[example.id] = { ...example, childrenIds: [...example.childrenIds, "underExample"] };
    expect(visitorOutline(items, demo.backlogs, demo.backlogTrees, demo.seedItemIds).map((i) => [i.title, i.depth, i.done])).toEqual([
      ["Mine", 0, false],
      ["Under mine", 1, true],
      ["Under an example", 0, false],
    ]);
  });
});

describe("the way there", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the front page links to it twice, as plain links that start a page of its own", () => {
    expect(read("src/pages/Landing.tsx").match(/href="\/try"/g)).toHaveLength(2);
  });

  it("is a public route, outside the signed-in routes", () => {
    const app = read("src/App.tsx");
    expect(app.indexOf('path="/try"')).toBeGreaterThan(-1);
    expect(app.indexOf('path="/try"')).toBeLessThan(app.indexOf("<AppRoutes />"));
  });
});
