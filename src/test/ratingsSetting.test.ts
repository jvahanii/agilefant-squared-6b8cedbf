/**
 * The organization switch for star ratings, and what it governs.
 *
 * Off is the default for every organization, so an organization that has never
 * heard of ratings sees no stars on its rows and no rating in its sort menu.
 * Turning it off again hides the stars; the ratings themselves are left alone,
 * which is why nothing here clears them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const upsert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: (...args: unknown[]) => upsert(...args) }) },
}));

import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useOrgStore } from "@/store/orgStore";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { listSortModes } from "@/lib/listSort";

const ORG = "org-a";
const OTHER = "org-b";

beforeEach(() => {
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  useOrgSettingsStore.setState({ settings: {} });
  useOrgStore.setState({ activeOrgId: ORG });
});

describe("the ratings setting", () => {
  it("is off until an organization turns it on", () => {
    const { result } = renderHook(() => useRatingsEnabled());
    expect(result.current).toBe(false);
  });

  it("saves the choice on the organization", async () => {
    await useOrgSettingsStore.getState().setRatingsEnabled(ORG, true);

    expect(useOrgSettingsStore.getState().settings[ORG]?.ratingsEnabled).toBe(true);
    expect(upsert.mock.calls[0][0]).toMatchObject({ organization_id: ORG, ratings_enabled: true });
  });

  it("belongs to one organization, not to the app", async () => {
    await useOrgSettingsStore.getState().setRatingsEnabled(OTHER, true);

    const { result } = renderHook(() => useRatingsEnabled());
    expect(result.current).toBe(false);
  });

  it("switches the stars on for the organization in view", async () => {
    await useOrgSettingsStore.getState().setRatingsEnabled(ORG, true);

    const { result } = renderHook(() => useRatingsEnabled());
    expect(result.current).toBe(true);
  });

  it("decides whether a backlog can be sorted by rating", () => {
    expect(listSortModes(false).map((m) => m.mode)).not.toContain("rating-desc");
    expect(listSortModes(true).map((m) => m.mode)).toContain("rating-desc");
  });

  it("reads the setting a realtime update brings, without losing the others", () => {
    useOrgSettingsStore.getState().applyRealtimeSettings({
      eventType: "UPDATE",
      new: { organization_id: ORG, points_enabled: true, ratings_enabled: true },
      old: {},
    });

    expect(useOrgSettingsStore.getState().settings[ORG]).toMatchObject({
      ratingsEnabled: true,
      pointsEnabled: true,
    });
  });
});
