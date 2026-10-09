/**
 * A backlog's right-click menu is the same wherever the backlog is right-clicked.
 *
 * It was written out twice — in the tree on the left and over the list on the
 * right — and the header's copy had drifted to three of nine items, offering
 * Statuses… even where custom statuses were off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { BacklogContextMenuItems } from "@/components/BacklogContextMenuItems";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { useScrambledListsStore } from "@/store/scrambledListsStore";
import { useListScrambleStore } from "@/store/listScrambleStore";
import { setCurrentUser } from "@/lib/currentUser";
import type { WorkItem } from "@/types/models";

// The switches in this menu save straight to the database; here they must not.
vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  updateBacklogRatingsEnabled: vi.fn(),
  updateBacklogCreatedDatesEnabled: vi.fn(),
  updateBacklogStartEndDatesEnabled: vi.fn(),
}));

// jsdom has no DOMRect, which a right-click menu uses to place itself at the
// pointer; without it every test passes and the run still fails on the error.
if (typeof globalThis.DOMRect === "undefined") {
  class RectForTests {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    get top() { return this.y; }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
    static fromRect(r: { x?: number; y?: number; width?: number; height?: number } = {}) {
      return new RectForTests(r.x, r.y, r.width, r.height);
    }
  }
  (globalThis as unknown as { DOMRect: unknown }).DOMRect = RectForTests;
}

const ORG = "org";
const TREE = "org::bt-1";
const BL = "org::bl-1";

const settings = (over: Record<string, boolean> = {}) =>
  useOrgSettingsStore.setState({
    settings: {
      [ORG]: {
        timeLoggingEnabled: false, pointsEnabled: true, labelsEnabled: false, customStatusesEnabled: true,
        savingsIncomeEnabled: false, boardsEnabled: false, burnupsEnabled: true, persistNotificationsEnabled: false,
        publicLinksEnabled: true, ratingsEnabled: true, deadlinesEnabled: false, createdDatesEnabled: false, startEndDatesEnabled: false, ...over,
      },
    },
  });

beforeEach(() => {
  useOrgStore.setState({ activeOrgId: ORG });
  settings();
  useAppStore.setState({
    backlogTrees: { [TREE]: { id: TREE, name: "Product", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Lanka vetämässä", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
  });
});

const handlers = () => ({
  onInsertIcon: vi.fn(), onAttributes: vi.fn(), onStatuses: vi.fn(),
  onPoints: vi.fn(), onPublish: vi.fn(), onDelete: vi.fn(),
});

const openMenu = (h = handlers()) => {
  render(
    <ContextMenu>
      <ContextMenuTrigger>list</ContextMenuTrigger>
      <ContextMenuContent>
        <BacklogContextMenuItems backlogId={BL} treeId={TREE} {...h} />
      </ContextMenuContent>
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("list"));
  return h;
};

describe("a list's right-click menu", () => {
  it("offers everything the organization has switched on", () => {
    openMenu();
    for (const item of ["Insert icon", "Attributes", "Statuses…", "View burnup…", "Set points…", "Star ratings", "Public link…", "Delete list"]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it("leaves out what is switched off — Statuses… among them, which the header used to show regardless", () => {
    settings({ customStatusesEnabled: false, burnupsEnabled: false, pointsEnabled: false, ratingsEnabled: false, publicLinksEnabled: false });
    openMenu();
    for (const item of ["Statuses…", "View burnup…", "Set points…", "Star ratings", "Public link…"]) {
      expect(screen.queryByText(item)).not.toBeInTheDocument();
    }
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.getByText("Delete list")).toBeInTheDocument();
  });

  it("hands each choice to the place that opened it", () => {
    const h = openMenu();
    fireEvent.click(screen.getByText("Set points…"));
    expect(h.onPoints).toHaveBeenCalled();
  });

  it("switches the list's stars itself", () => {
    openMenu();
    fireEvent.click(screen.getByText("Star ratings"));
    expect(useAppStore.getState().backlogs[BL].ratingsEnabled).toBe(true);
  });

  it("offers the list's created dates only where the organization has them on, and switches them itself", () => {
    openMenu();
    expect(screen.queryByText("Created dates")).not.toBeInTheDocument();
    cleanup();

    settings({ createdDatesEnabled: true });
    openMenu();
    expect(useAppStore.getState().backlogs[BL].createdDatesEnabled ?? false).toBe(false);
    fireEvent.click(screen.getByText("Created dates"));
    expect(useAppStore.getState().backlogs[BL].createdDatesEnabled).toBe(true);
  });

  it("offers showing start and end dates only where the organization has them on, and switches it itself", () => {
    openMenu();
    expect(screen.queryByText("Start and end dates")).not.toBeInTheDocument();
    cleanup();

    settings({ startEndDatesEnabled: true });
    openMenu();
    expect(useAppStore.getState().backlogs[BL].startEndDatesEnabled ?? false).toBe(false);
    fireEvent.click(screen.getByText("Start and end dates"));
    expect(useAppStore.getState().backlogs[BL].startEndDatesEnabled).toBe(true);
  });
});

describe("labels on a list", () => {
  const assignLabel = vi.fn();
  const unassignLabel = vi.fn();
  const label = (id: string, name: string, organizationId = ORG) => ({ id, name, color: "#16a34a", organizationId });
  const withLabels = (assigned: string[] = []) =>
    useLabelsStore.setState({
      labels: { urgent: label("urgent", "Urgent"), applied: label("applied", "Applied"), theirs: label("theirs", "Another org's", "other") },
      byEntity: assigned.length ? { [`backlog:${BL}`]: assigned } : {},
      assignLabel,
      unassignLabel,
    });
  const openLabels = () => fireEvent.click(screen.getByText("Labels"));

  beforeEach(() => {
    assignLabel.mockReset();
    unassignLabel.mockReset();
    withLabels();
  });

  it("are offered only where the organization has labels on", () => {
    openMenu();
    expect(screen.queryByText("Labels")).not.toBeInTheDocument();
    cleanup();

    settings({ labelsEnabled: true });
    openMenu();
    expect(screen.getByText("Labels")).toBeInTheDocument();
  });

  it("lists the organization's labels by name, and gives the one chosen to the list", () => {
    settings({ labelsEnabled: true });
    openMenu();
    openLabels();
    expect(screen.getAllByRole("menuitemcheckbox").map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["Applied", "Urgent"]),
    );
    expect(screen.queryByText("Another org's")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Urgent" }));
    expect(assignLabel).toHaveBeenCalledWith("urgent", "backlog", BL, ORG);
    // Still open, for the next label.
    expect(screen.getByRole("menuitemcheckbox", { name: "Applied" })).toBeInTheDocument();
  });

  it("shows which labels the list has, counts them, and takes one off", () => {
    settings({ labelsEnabled: true });
    withLabels(["applied"]);
    openMenu();
    expect(screen.getByText("(1)")).toBeInTheDocument();
    openLabels();
    expect(screen.getByRole("menuitemcheckbox", { name: "Applied" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Urgent" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Applied" }));
    expect(unassignLabel).toHaveBeenCalledWith("applied", "backlog", BL);
  });

  it("says where to make labels when there are none", () => {
    settings({ labelsEnabled: true });
    useLabelsStore.setState({ labels: {}, byEntity: {} });
    openMenu();
    openLabels();
    expect(screen.getByText(/No labels yet/)).toBeInTheDocument();
  });
});

describe("scrambling a list from its menu", () => {
  const ME = "me";
  const scramble = vi.fn();
  const askReveal = vi.fn();
  const askUnscramble = vi.fn();
  const inList = (id: string): WorkItem =>
    ({ id, title: id, parentId: null, backlogAssignments: { [TREE]: BL }, ranks: {} }) as unknown as WorkItem;

  beforeEach(() => {
    scramble.mockReset();
    askReveal.mockReset();
    askUnscramble.mockReset();
    setCurrentUser({ id: ME, email: null, fullName: null, avatarUrl: null });
    useListScrambleStore.setState({ scramble, askReveal, askUnscramble });
    useScrambledListsStore.setState({ byList: new Map() });
    useScrambledItemsStore.setState({ byItem: new Map() });
    useAppStore.setState({ workItems: { a: inList("a"), b: inList("b") } });
  });

  it("offers to scramble a list that is not", () => {
    openMenu();
    fireEvent.click(screen.getByText("Scramble list…"));
    expect(scramble).toHaveBeenCalledWith(BL);
    for (const item of ["Show real name…", "Unscramble list…", "Scrambled by someone else"]) {
      expect(screen.queryByText(item)).not.toBeInTheDocument();
    }
  });

  it("offers its real name and to put it back, to the person who scrambled it", () => {
    useScrambledListsStore.setState({ byList: new Map([[BL, ME]]) });
    useScrambledItemsStore.setState({ byItem: new Map([["a", ME], ["b", ME]]) });
    openMenu();
    expect(screen.queryByText("Scramble list…")).not.toBeInTheDocument();
    // Everything in it is scrambled: nothing was added since.
    expect(screen.queryByText(/Scramble what was added/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Show real name…"));
    expect(askReveal).toHaveBeenCalledWith(BL);
    cleanup();

    openMenu();
    fireEvent.click(screen.getByText("Unscramble list…"));
    expect(askUnscramble).toHaveBeenCalledWith(BL);
  });

  it("offers to scramble what has been added to a scrambled list since", () => {
    useScrambledListsStore.setState({ byList: new Map([[BL, ME]]) });
    useScrambledItemsStore.setState({ byItem: new Map([["a", ME]]) });
    openMenu();
    fireEvent.click(screen.getByText("Scramble what was added (1)"));
    expect(scramble).toHaveBeenCalledWith(BL);
  });

  it("offers nothing to anyone else", () => {
    useScrambledListsStore.setState({ byList: new Map([[BL, "someone"]]) });
    openMenu();
    expect(screen.getByText("Scrambled by someone else").closest("[role=menuitem]")).toHaveAttribute("data-disabled");
    for (const item of ["Scramble list…", "Show real name…", "Unscramble list…"]) {
      expect(screen.queryByText(item)).not.toBeInTheDocument();
    }
  });

  it("takes Insert icon away while the name is scrambled: an icon is typed into the name", () => {
    useScrambledListsStore.setState({ byList: new Map([[BL, ME]]) });
    openMenu();
    expect(screen.queryByText("Insert icon")).not.toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });
});

describe("both places a list is right-clicked", () => {
  it("use the one menu, so they cannot drift apart again", () => {
    for (const file of ["BacklogTreePanel.tsx", "WorkItemTreePanel.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src", "components", file), "utf8");
      expect(source, file).toContain("<BacklogContextMenuItems");
    }
  });
});
