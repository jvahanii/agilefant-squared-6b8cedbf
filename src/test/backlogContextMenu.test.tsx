/**
 * A backlog's right-click menu is the same wherever the backlog is right-clicked.
 *
 * It was written out twice — in the tree on the left and over the list on the
 * right — and the header's copy had drifted to three of nine items, offering
 * Statuses… even where custom statuses were off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { BacklogContextMenuItems } from "@/components/BacklogContextMenuItems";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

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
        publicLinksEnabled: true, ratingsEnabled: true, deadlinesEnabled: false, ...over,
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
      <ContextMenuTrigger>backlog</ContextMenuTrigger>
      <ContextMenuContent>
        <BacklogContextMenuItems backlogId={BL} treeId={TREE} {...h} />
      </ContextMenuContent>
    </ContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("backlog"));
  return h;
};

describe("a backlog's right-click menu", () => {
  it("offers everything the organization has switched on", () => {
    openMenu();
    for (const item of ["Insert icon", "Attributes", "Statuses…", "View burnup…", "Set points…", "Star ratings", "Public link…", "Delete backlog"]) {
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
    expect(screen.getByText("Delete backlog")).toBeInTheDocument();
  });

  it("hands each choice to the place that opened it", () => {
    const h = openMenu();
    fireEvent.click(screen.getByText("Set points…"));
    expect(h.onPoints).toHaveBeenCalled();
  });

  it("switches the backlog's stars itself", () => {
    openMenu();
    fireEvent.click(screen.getByText("Star ratings"));
    expect(useAppStore.getState().backlogs[BL].ratingsEnabled).toBe(true);
  });
});

describe("both places a backlog is right-clicked", () => {
  it("use the one menu, so they cannot drift apart again", () => {
    for (const file of ["BacklogTreePanel.tsx", "WorkItemTreePanel.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src", "components", file), "utf8");
      expect(source, file).toContain("<BacklogContextMenuItems");
    }
  });
});
