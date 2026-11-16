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
  beforeEach(() => {
    reload.mockClear();
    useAppStore.setState({ loadFromSupabase: reload, backlogs: {} } as never);
  });

  it("makes the copy asked for, reloads, and says how many ads came", async () => {
    rememberListToCopy(TOKEN);
    rpc.mockResolvedValue({ data: { treeId: "t", backlogId: "b", added: 12, existing: false }, error: null });
    renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("copy_published_list", { _token: TOKEN, _organization_id: ORG });
    expect(reload).toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "The list is in your account" });
    expect(toast.mock.calls[0][0].description).toMatch(/^12 ads copied\. New ads are added/);
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

  it("otherwise brings copies their new items, telling only when some came", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const first = renderHook(() => usePublishedListCopies(ORG, true));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("sync_published_list_copies", { _organization_id: ORG });
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "3 ads added to your copied lists" });
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
