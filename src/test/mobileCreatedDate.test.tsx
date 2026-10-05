/**
 * The phone's attributes sheet shows an item's created date under the same two
 * switches as its row does: the organization's, and that of the list the item
 * sits in. It used to follow the organization's alone, so a list that had
 * turned created dates off still showed them on a phone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  updateBacklogCreatedDatesEnabled: vi.fn(),
}));

import { MobileWorkItemAttributesSheet } from "@/components/MobileAttributesSheet";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

const ORG = "test-org";
const TREE = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;
const ID = `${ORG}::wi-1`;

const setUp = (orgOn: boolean, listOn: boolean) => {
  useOrgStore.setState({ activeOrgId: ORG });
  useOrgSettingsStore.setState((s) => ({
    settings: { ...s.settings, [ORG]: { ...(s.settings[ORG] ?? ({} as never)), createdDatesEnabled: orgOn } },
  }));
  useAppStore.setState({
    organizationId: ORG,
    selectedTreeId: TREE,
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: {
      [BL]: { id: BL, name: "Jobs", parentId: null, childrenIds: [], treeId: TREE, rank: 0, createdDatesEnabled: listOn },
    },
    workItems: {
      [ID]: {
        id: ID,
        title: "Fortum - Analyst",
        status: "not_started",
        parentId: null,
        childrenIds: [],
        backlogAssignments: { [TREE]: BL },
        ranks: { [BL]: 0 },
        createdOn: "2026-09-30",
      },
    },
  });
};

const openSheet = () => {
  const noop = vi.fn();
  render(
    <MobileWorkItemAttributesSheet
      workItemId={ID}
      open
      onOpenChange={noop}
      onOpenTimeLog={noop}
      onOpenRespawn={noop}
      onOpenHyperlinks={noop}
      onOpenSnooze={noop}
      onOpenMove={noop}
      onOpenReparent={noop}
      onDuplicate={noop}
      onScrambleName={noop}
      onRevealName={noop}
      onUnscrambleName={noop}
    />,
  );
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the created date on the phone's attributes sheet", () => {
  it("shows where the organization and the item's list both have it on", () => {
    setUp(true, true);
    openSheet();
    expect(screen.getByLabelText("Created")).toHaveValue("2026-09-30");
  });

  it("is left out where the item's list has it off", () => {
    setUp(true, false);
    openSheet();
    expect(screen.queryByLabelText("Created")).not.toBeInTheDocument();
  });

  it("is left out where the organization has it off, whatever the list says", () => {
    setUp(false, true);
    openSheet();
    expect(screen.queryByLabelText("Created")).not.toBeInTheDocument();
  });
});
