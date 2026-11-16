/**
 * A new account's first screen on a phone (2026-11-16): the lists took 40% of
 * the height above "Add your first item", which put the box 509 px down a
 * 812 px screen, under the keyboard once it opened. While the organisation is
 * empty the lists start folded away, once; the visitor can open them again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.setConfig({ testTimeout: 20_000 });
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

const phone = vi.hoisted(() => ({ isMobile: true }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => phone.isMobile }));
vi.mock("@/components/BacklogTreePanel", () => ({
  BacklogTreePanel: ({ mobileCollapsed, onToggleMobileCollapse }: { mobileCollapsed?: boolean; onToggleMobileCollapse?: () => void }) => (
    <button type="button" data-testid="lists" onClick={onToggleMobileCollapse}>
      {mobileCollapsed === undefined ? "desktop" : mobileCollapsed ? "folded" : "open"}
    </button>
  ),
}));
vi.mock("@/components/WorkItemTreePanel", () => ({ WorkItemTreePanel: () => null }));
vi.mock("@/components/ActionPrompt", () => ({ ActionPrompt: () => null }));
vi.mock("@/components/DeleteGuardHost", () => ({ DeleteGuardHost: () => null }));
vi.mock("@/components/RerankGuardHost", () => ({ RerankGuardHost: () => null }));
vi.mock("@/components/JobSearchRunButton", () => ({ JobSearchRunButton: () => null }));
vi.mock("@/components/PersistDebugOverlay", () => ({ PersistDebugOverlay: () => null }));
vi.mock("@/components/OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("@/components/RoleSimulator", () => ({ RoleSimulator: () => null }));
vi.mock("@/components/UserGuideDialog", () => ({ UserGuideDialog: () => null }));
vi.mock("@/components/TimesheetBrowserDialog", () => ({ TimesheetBrowserDialog: () => null }));

import AppLayout from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import type { WorkItem } from "@/types/models";

const ORG = "org-1";
const TREE = `${ORG}::bt-1`;
const L1 = `${ORG}::bl-1`;

function seed(over: Record<string, unknown> = {}) {
  useOrgStore.setState({
    activeOrgId: ORG,
    memberships: [{ organization_id: ORG, organization_name: "Acme", organization_slug: "acme", role: "owner" }],
  } as never);
  useAppStore.setState({
    organizationId: ORG,
    workItems: {},
    backlogTrees: { [TREE]: { id: TREE, name: "My work", rootBacklogIds: [L1], rank: 0 } },
    backlogs: { [L1]: { id: L1, name: "Now", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    selectedTreeId: null,
    selectedBacklogIds: [],
    selectedWorkItemIds: [],
    isLoading: false,
    workItemsLoading: false,
    workItemsRefreshing: false,
    ...over,
  } as never);
}

const renderLayout = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <AppLayout />
      </TooltipProvider>
    </MemoryRouter>,
  );
const lists = () => screen.getByTestId("lists").textContent;

beforeEach(() => {
  phone.isMobile = true;
});

describe("the first screen on a phone", () => {
  it("folds the lists away while the organisation has no items", () => {
    seed();
    renderLayout();
    expect(lists()).toBe("folded");
  });

  it("waits for the items to load before deciding", () => {
    seed({ workItemsLoading: true });
    renderLayout();
    expect(lists()).toBe("open");
  });

  it("leaves them open for an organisation with items", () => {
    const item = { id: "a", title: "A", parentId: null, childrenIds: [], status: "not_started", ranks: { [L1]: 0 }, backlogAssignments: { [TREE]: L1 }, organizationId: ORG } as WorkItem;
    seed({ workItems: { a: item } });
    renderLayout();
    expect(lists()).toBe("open");
  });

  it("folds them only once, so they stay open when the visitor opens them", () => {
    seed();
    renderLayout();
    fireEvent.click(screen.getByTestId("lists"));
    expect(lists()).toBe("open");
  });

  it("changes nothing on a wider screen", () => {
    phone.isMobile = false;
    seed();
    renderLayout();
    expect(lists()).toBe("desktop");
  });
});
