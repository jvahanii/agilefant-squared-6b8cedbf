/**
 * Copies of public lists (2026-11-16): the request carried from the public
 * page to the app, the hourly check for new items, what the app does with
 * the answers, and what the database functions may and may not do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

import { claimSync, PENDING_COPY_HOURS, PENDING_COPY_KEY, rememberListToCopy, SYNC_EVERY_MS, takeListToCopy } from "@/lib/listCopy";
import { usePublishedListCopies } from "@/hooks/usePublishedListCopies";
import { useAppStore } from "@/store/appStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

const TOKEN = "test-token-000000000000000000000";
const ORG = "org-1";

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  toast.mockReset();
});

describe("the request to copy", () => {
  it("is taken once", () => {
    rememberListToCopy(TOKEN);
    expect(takeListToCopy()).toBe(TOKEN);
    expect(takeListToCopy()).toBeNull();
    expect(localStorage.getItem(PENDING_COPY_KEY)).toBeNull();
  });

  it(`is dropped after ${PENDING_COPY_HOURS} hours, and when it is not a link token`, () => {
    const at = new Date("2026-11-16T12:00:00Z");
    rememberListToCopy(TOKEN, at);
    expect(takeListToCopy(new Date(at.getTime() + (PENDING_COPY_HOURS + 1) * 3_600_000))).toBeNull();
    rememberListToCopy("short", at);
    expect(takeListToCopy(at)).toBeNull();
    localStorage.setItem(PENDING_COPY_KEY, "{oops");
    expect(takeListToCopy()).toBeNull();
  });
});

describe("the check for new items", () => {
  it("is made at most once an hour per organisation in a browser", () => {
    const t = 1_800_000_000_000;
    expect(claimSync(ORG, t)).toBe(true);
    expect(claimSync(ORG, t + 1000)).toBe(false);
    expect(claimSync("org-2", t + 1000)).toBe(true);
    expect(claimSync(ORG, t + SYNC_EVERY_MS)).toBe(true);
  });
});

describe("in the app", () => {
  const reload = vi.fn(async () => {});
  const loadSettings = vi.fn(async () => {});
  beforeEach(() => {
    reload.mockClear();
    loadSettings.mockClear();
    useAppStore.setState({ loadFromSupabase: reload, backlogs: {} } as never);
    useOrgSettingsStore.setState({ loadSettings } as never);
  });

  it("makes the copy asked for, reloads, and says how many ads came", async () => {
    rememberListToCopy(TOKEN);
    rpc.mockResolvedValue({ data: { treeId: "t", backlogId: "b", added: 12, existing: false }, error: null });
    renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("copy_published_list", { _token: TOKEN, _organization_id: ORG });
    expect(reload).toHaveBeenCalled();
    // Ratings, and deadlines when copied, were switched on: shown without a reload.
    expect(loadSettings).toHaveBeenCalledWith(ORG);
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "The list is in your account" });
    expect(toast.mock.calls[0][0].description).toMatch(/^12 ads copied\. New ads are added/);
  });

  it("fills a long list in batches, each within the database's limit for one request", async () => {
    rememberListToCopy(TOKEN);
    rpc.mockImplementation((name: string) => {
      if (name === "copy_published_list") return Promise.resolve({ data: { treeId: "t", backlogId: "b", added: 150, existing: false, more: true }, error: null });
      const left = rpc.mock.calls.filter(([n]) => n === "sync_published_list_copies").length;
      return Promise.resolve({ data: left <= 9 ? 150 : left === 10 ? 128 : 0, error: null });
    });
    renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(toast.mock.calls.some(([t]) => t.title === "The list is in your account")).toBe(true));
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "Copying the list…" });
    const done = toast.mock.calls.find(([t]) => t.title === "The list is in your account")![0];
    expect(done.description).toMatch(/^1628 ads copied/);
  });

  it("explains, without alarm, that a list cannot be copied into its own organisation", async () => {
    rememberListToCopy(TOKEN);
    rpc.mockResolvedValue({ data: null, error: { message: "This list is already in this organisation" } });
    renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toEqual({
      title: "This list is already in this organisation",
      description: "Its ads are here already: there is nothing to copy.",
    });
  });

  it("waits until the organisation's data has loaded", () => {
    rememberListToCopy(TOKEN);
    renderHook(() => usePublishedListCopies(ORG, false));
    expect(rpc).not.toHaveBeenCalled();
    expect(localStorage.getItem(PENDING_COPY_KEY)).not.toBeNull();
  });

  it("says so when the list is no longer public", async () => {
    rememberListToCopy(TOKEN);
    rpc.mockResolvedValue({ data: null, error: { message: "This list is no longer public" } });
    renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "The list could not be copied", description: "This list is no longer public" });
  });

  it("otherwise brings copies their new items, batch after batch, telling only when some came", async () => {
    rpc.mockResolvedValueOnce({ data: 150, error: null }).mockResolvedValueOnce({ data: 3, error: null }).mockResolvedValue({ data: 0, error: null });
    const first = renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("sync_published_list_copies", { _organization_id: ORG });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "153 ads added to your copied lists" });
    first.unmount();

    // Within the hour: not asked again.
    rpc.mockClear();
    renderHook(() => usePublishedListCopies(ORG, true));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is quiet when no new items came", async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(toast).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the database functions", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261116150000_copy_published_list.sql"), "utf8");
  const code = sql.replace(/--[^\n]*/g, "");

  it("never remove or change an item already in a copy: they only add", () => {
    expect(code).not.toMatch(/DELETE\s+FROM\s+public\.work_items/i);
    expect(code).not.toMatch(/UPDATE\s+public\.work_items/i);
    expect(code).not.toMatch(/ON CONFLICT[^;]*DO UPDATE[^;]*work_items/i);
    expect(code).toMatch(/INSERT INTO public\.work_items/);
  });

  it("switch ratings on for the copied list and its organisation, and never off", () => {
    expect(code).toContain("VALUES (_backlog, _list_name, NULL, _tree, 0, _organization_id, true)");
    expect(code).toMatch(/SET ratings_enabled = true/);
    expect(code).not.toMatch(/ratings_enabled = false|deadlines_enabled = false/);
  });

  it("copy only what the link shows, through get_published_backlog()", () => {
    expect(code.match(/public\.get_published_backlog\(/g)?.length).toBe(2);
    expect(code).not.toMatch(/get_published_backlog_unchecked/);
  });

  it("are for signed-in members only, and the tables for the functions only", () => {
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.add_new_published_items\(uuid, jsonb\) FROM PUBLIC, anon, authenticated/);
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.copy_published_list\(text, uuid\) FROM PUBLIC, anon/);
    expect(code).toMatch(/REVOKE EXECUTE ON FUNCTION public\.sync_published_list_copies\(uuid\) FROM PUBLIC, anon/);
    expect(code.match(/is_member_of\(_uid, _organization_id\)/g)?.length).toBe(2);
    expect(code).toMatch(/REVOKE ALL ON public\.published_list_copies FROM PUBLIC, anon, authenticated/);
    expect(code).toMatch(/REVOKE ALL ON public\.published_list_copy_items FROM PUBLIC, anon, authenticated/);
  });
});

describe("the batch migration (20261117090000)", () => {
  const code = readFileSync(join(process.cwd(), "supabase/migrations/20261117090000_copy_in_batches.sql"), "utf8").replace(/--[^\n]*/g, "");

  it("adds at most a batch per call, in the list's order", () => {
    expect(code).toContain("LIMIT greatest(coalesce(_limit, 150), 1)");
    expect(code).toContain("'more', _added >= _batch");
  });

  it("refuses the list's own organisation and those it is shared with", () => {
    expect(code).toContain("_link.organization_id = _organization_id");
    expect(code).toContain("s.tree_id = _link.tree_id AND s.organization_id = _organization_id");
  });

  it("still never removes or changes an item already in a copy", () => {
    expect(code).not.toMatch(/DELETE\s+FROM\s+public\.work_items/i);
    expect(code).not.toMatch(/UPDATE\s+public\.work_items/i);
  });

  it("keeps the inner function out of reach and the outer ones for signed-in members", () => {
    expect(code).toContain("REVOKE EXECUTE ON FUNCTION public.add_new_published_items(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated");
    expect(code).toContain("GRANT EXECUTE ON FUNCTION public.sync_published_list_copies(uuid, integer) TO authenticated, service_role");
    expect(code.match(/TO anon/g)).toBeNull();
  });
});
