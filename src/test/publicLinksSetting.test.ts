/**
 * The organization switch for public links. It decides whether backlogs can be
 * read by anyone holding an address, so the one way it must never be wrong is
 * by showing a state that was not saved — a switch reading "off" while links
 * still serve. The database enforces the setting on every request; these tests
 * cover the app's side of telling the truth about it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const upsert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: (...args: unknown[]) => upsert(...args) }) },
}));

import { useOrgSettingsStore, usePublicLinksEnabled } from "@/store/orgSettingsStore";
import { useOrgStore } from "@/store/orgStore";

const ORG = "org-a";
const OTHER = "org-b";

beforeEach(() => {
  upsert.mockReset();
  useOrgSettingsStore.setState({ settings: {} });
  useOrgStore.setState({ activeOrgId: ORG });
});

describe("setPublicLinksEnabled", () => {
  it("is off until an organization turns it on", () => {
    const { result } = renderHook(() => usePublicLinksEnabled());
    expect(result.current).toBe(false);
  });

  it("saves the choice and reports success", async () => {
    upsert.mockResolvedValue({ error: null });

    const saved = await useOrgSettingsStore.getState().setPublicLinksEnabled(ORG, true);

    expect(saved).toBe(true);
    expect(useOrgSettingsStore.getState().settings[ORG]?.publicLinksEnabled).toBe(true);
    expect(upsert.mock.calls[0][0]).toMatchObject({ organization_id: ORG, public_links_enabled: true });
  });

  it("puts the switch back when the save is refused", async () => {
    // A member who is not an owner or admin, or a dropped connection. The switch
    // flips at once for responsiveness, then must return to what is true.
    useOrgSettingsStore.getState().applyRealtimeSettings({
      eventType: "UPDATE",
      new: { organization_id: ORG, public_links_enabled: true },
      old: null,
    });
    upsert.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });

    const saved = await useOrgSettingsStore.getState().setPublicLinksEnabled(ORG, false);

    expect(saved).toBe(false);
    expect(useOrgSettingsStore.getState().settings[ORG]?.publicLinksEnabled).toBe(true);
  });

  it("follows a change made elsewhere, as it arrives", () => {
    const { result } = renderHook(() => usePublicLinksEnabled());
    act(() => {
      useOrgSettingsStore.getState().applyRealtimeSettings({
        eventType: "UPDATE",
        new: { organization_id: ORG, public_links_enabled: true },
        old: null,
      });
    });
    expect(result.current).toBe(true);
  });
});

describe("usePublicLinksEnabled", () => {
  it("answers for the active organization, not any other", () => {
    useOrgSettingsStore.getState().applyRealtimeSettings({
      eventType: "UPDATE",
      new: { organization_id: OTHER, public_links_enabled: true },
      old: null,
    });
    const { result } = renderHook(() => usePublicLinksEnabled());
    expect(result.current).toBe(false);

    act(() => useOrgStore.setState({ activeOrgId: OTHER }));
    expect(result.current).toBe(true);
  });

  it("is off with no organization active", () => {
    useOrgStore.setState({ activeOrgId: null });
    const { result } = renderHook(() => usePublicLinksEnabled());
    expect(result.current).toBe(false);
  });
});
