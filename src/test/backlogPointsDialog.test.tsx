/**
 * Setting a backlog's own points: an estimate before its work is broken into
 * items, shown against what its contents add up to.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  updateBacklogPoints: vi.fn(),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

import { BacklogPointsDialog } from "@/components/BacklogPointsDialog";
import { useAppStore } from "@/store/appStore";

const TREE = "org::bt-1";
const BL = "org::bl-1";

beforeEach(() => {
  useAppStore.setState({
    organizationId: "org",
    backlogTrees: { [TREE]: { id: TREE, name: "Product", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Release 4.2", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    workItems: {
      "org::wi-a": { id: "org::wi-a", title: "Checkout", status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { [TREE]: BL }, ranks: {}, points: 5 },
      "org::wi-b": { id: "org::wi-b", title: "Search", status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { [TREE]: BL }, ranks: {}, points: 8 },
    },
    undoStack: [],
    redoStack: [],
  });
});

const open = () => render(<BacklogPointsDialog backlogId={BL} treeId={TREE} open onOpenChange={vi.fn()} />);

describe("BacklogPointsDialog", () => {
  it("shows what the contents add up to, beside the estimate", () => {
    open();
    expect(screen.getByText(/Its contents add up to 13 pts/)).toBeInTheDocument();
  });

  it("saves a whole number as the backlog's estimate", () => {
    open();
    fireEvent.change(screen.getByLabelText("Estimate for the whole backlog"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useAppStore.getState().backlogs[BL].points).toBe(40);
  });

  it("will not save anything but a whole number", () => {
    open();
    fireEvent.change(screen.getByLabelText("Estimate for the whole backlog"), { target: { value: "4.5" } });
    expect(screen.getByText("A whole number of zero or more.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("takes an estimate away", () => {
    useAppStore.getState().setBacklogPoints(BL, 40);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Remove estimate" }));
    expect(useAppStore.getState().backlogs[BL].points).toBeUndefined();
  });
});
