/**
 * A backlog's own star switch.
 *
 * The organization setting says ratings exist at all; each backlog then says
 * whether its own items show them, starting off. So a backlog that nobody has
 * switched on shows no stars and offers no rating sort, even where the
 * organization rates everything else.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  updateBacklogRatingsEnabled: vi.fn(),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

import { useAppStore } from "@/store/appStore";
import { updateBacklogRatingsEnabled } from "@/store/supabaseSync";
import { listSortModes } from "@/lib/listSort";

const ORG = "test-org";
const TREE = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;

const seed = () =>
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Shortlist", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    workItems: {},
  });

beforeEach(() => {
  (updateBacklogRatingsEnabled as unknown as { mockClear: () => void }).mockClear();
  seed();
});

describe("a backlog's star switch", () => {
  it("starts off, so a backlog shows no stars until someone says so", () => {
    expect(useAppStore.getState().backlogs[BL].ratingsEnabled).toBeFalsy();
  });

  it("is switched on for that backlog alone, and saved", () => {
    useAppStore.getState().setBacklogRatingsEnabled(BL, true);
    expect(useAppStore.getState().backlogs[BL].ratingsEnabled).toBe(true);
    expect(updateBacklogRatingsEnabled).toHaveBeenCalledWith(BL, true);
  });

  it("is switched off again", () => {
    useAppStore.getState().setBacklogRatingsEnabled(BL, true);
    useAppStore.getState().setBacklogRatingsEnabled(BL, false);
    expect(useAppStore.getState().backlogs[BL].ratingsEnabled).toBe(false);
    expect(updateBacklogRatingsEnabled).toHaveBeenLastCalledWith(BL, false);
  });

  it("writes nothing when the switch is already where it is being put", () => {
    useAppStore.getState().setBacklogRatingsEnabled(BL, false);
    expect(updateBacklogRatingsEnabled).not.toHaveBeenCalled();
  });

  it("does nothing for a backlog that is not there", () => {
    useAppStore.getState().setBacklogRatingsEnabled(`${ORG}::bl-gone`, true);
    expect(updateBacklogRatingsEnabled).not.toHaveBeenCalled();
  });

  it("decides, with the organization setting, whether rating sort is offered", () => {
    // Both have to hold: the organization rates its items, and this backlog
    // shows them. listSortModes takes the two already combined.
    const orgOn = true;
    const backlogOff = useAppStore.getState().backlogs[BL].ratingsEnabled ?? false;
    expect(listSortModes(orgOn && backlogOff).map((m) => m.mode)).not.toContain("rating-desc");

    useAppStore.getState().setBacklogRatingsEnabled(BL, true);
    const backlogOn = useAppStore.getState().backlogs[BL].ratingsEnabled ?? false;
    expect(listSortModes(orgOn && backlogOn).map((m) => m.mode)).toContain("rating-desc");
    expect(listSortModes(false && backlogOn).map((m) => m.mode)).not.toContain("rating-desc");
  });
});
