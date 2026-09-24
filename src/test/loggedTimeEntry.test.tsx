/**
 * The door to the logged-time report: a "Logged time" entry in the header's
 * menu and Shift+L, both present only while the organization logs time.
 *
 * The report itself answered "who spent time on what" long before it had a
 * door here; it lived in Settings and was forgotten. So what is pinned is that
 * the door exists, opens it, and is absent where there is no time to report.
 *
 * AppLayout is rendered for real, with its heavy children — the two panels, the
 * guard hosts, the dialogs that are not under test — stubbed out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Every test here renders the whole of AppLayout. Alone each takes well under a
// second, but in a full run on a busy machine one went past the default five
// and failed for no fault of its own — the same allowance the picker's
// tests needed, for the same reason.
vi.setConfig({ testTimeout: 20_000 });
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/** What App supplies around AppLayout: a router, since it navigates, and tooltips. */
const render = (ui: ReactElement) =>
  rtlRender(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );

vi.mock("@/components/BacklogTreePanel", () => ({ BacklogTreePanel: () => null }));
vi.mock("@/components/WorkItemTreePanel", () => ({ WorkItemTreePanel: () => null }));
vi.mock("@/components/ActionPrompt", () => ({ ActionPrompt: () => null }));
vi.mock("@/components/DeleteGuardHost", () => ({ DeleteGuardHost: () => null }));
vi.mock("@/components/RerankGuardHost", () => ({ RerankGuardHost: () => null }));
vi.mock("@/components/JobSearchRunButton", () => ({ JobSearchRunButton: () => null }));
vi.mock("@/components/PersistDebugOverlay", () => ({ PersistDebugOverlay: () => null }));
vi.mock("@/components/OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("@/components/RoleSimulator", () => ({ RoleSimulator: () => null }));
vi.mock("@/components/UserGuideDialog", () => ({ UserGuideDialog: () => null }));
// The report is the lazy chunk the door opens; its own behaviour is tested in
// timesheetBrowser.test.tsx, so here it only has to say that it opened.
vi.mock("@/components/TimesheetBrowserDialog", () => ({
  TimesheetBrowserDialog: ({ open, orgName }: { open: boolean; orgName: string }) =>
    open ? <div role="dialog" aria-label="Logged time report">{orgName}</div> : null,
}));

import AppLayout from "@/components/AppLayout";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

const ORG = "org-1";

/** Every switch off except the one under test. */
const timeLogging = (enabled: boolean) =>
  useOrgSettingsStore.setState({
    settings: {
      [ORG]: {
        timeLoggingEnabled: enabled,
        pointsEnabled: false,
        labelsEnabled: false,
        customStatusesEnabled: false,
        savingsIncomeEnabled: false,
        boardsEnabled: false,
        burnupsEnabled: false,
        persistNotificationsEnabled: false,
        publicLinksEnabled: false,
        ratingsEnabled: false,
      },
    },
  });

beforeEach(() => {
  useOrgStore.setState({
    activeOrgId: ORG,
    memberships: [{ organization_id: ORG, organization_name: "Acme", organization_slug: "acme", role: "owner" }],
  });
  timeLogging(false);
});

/**
 * The header's ⋮ menu, opened from the keyboard. Radix opens it by pointer
 * only for a primary-button pointerdown, and jsdom has no PointerEvent to carry
 * which button it was — the keyboard is the path that works here, and is a real
 * way in for anyone not using a mouse.
 */
const openMenu = () => fireEvent.keyDown(screen.getByRole("button", { name: "More" }), { key: "Enter" });

describe("the Logged time entry", () => {
  it("is in the menu while the organization logs time, and opens the report", async () => {
    timeLogging(true);
    render(<AppLayout />);
    openMenu();
    const item = await screen.findByRole("menuitem", { name: /Logged time/ });
    expect(item).toHaveTextContent("Shift+L");

    fireEvent.click(item);
    expect(await screen.findByRole("dialog", { name: "Logged time report" })).toHaveTextContent("Acme");
  });

  it("is not in the menu where no time is logged", async () => {
    render(<AppLayout />);
    openMenu();
    await screen.findByRole("menuitem", { name: /User Guide/ });
    expect(screen.queryByRole("menuitem", { name: /Logged time/ })).not.toBeInTheDocument();
  });

  it("appears as soon as time logging is switched on, without a reload", async () => {
    render(<AppLayout />);
    timeLogging(true);
    openMenu();
    expect(await screen.findByRole("menuitem", { name: /Logged time/ })).toBeInTheDocument();
  });
});

/**
 * The header comes in two versions: the wide one lays its buttons out in a
 * row, and the narrow one folds them into the ⋮ menu. jsdom applies no CSS, so
 * both render here — which is how a door placed only in the ⋮ menu passed
 * every test above while no desktop user could see it. So this looks for the
 * button by the version it sits in.
 */
const wideHeader = (el: HTMLElement) => el.closest(".md\\:flex");
const narrowHeader = (el: HTMLElement) => el.closest(".md\\:hidden");

describe("the Logged time button in the wide header", () => {
  it("is there while the organization logs time, and opens the report", async () => {
    timeLogging(true);
    render(<AppLayout />);
    const button = screen.getByRole("button", { name: "Logged time" });
    expect(wideHeader(button)).not.toBeNull();
    expect(narrowHeader(button)).toBeNull();

    fireEvent.click(button);
    expect(await screen.findByRole("dialog", { name: "Logged time report" })).toHaveTextContent("Acme");
  });

  it("is not there where no time is logged", () => {
    render(<AppLayout />);
    expect(screen.queryByRole("button", { name: "Logged time" })).not.toBeInTheDocument();
  });

  it("sits beside the exports, which a desktop user already knows to look at", () => {
    timeLogging(true);
    render(<AppLayout />);
    const button = screen.getByRole("button", { name: "Logged time" });
    const row = wideHeader(button)!;
    expect(row).toContainElement(screen.getAllByText("Export data").find((el) => wideHeader(el)) ?? null);
  });
});

describe("Shift+L", () => {
  it("opens the report with nothing selected", async () => {
    timeLogging(true);
    render(<AppLayout />);
    fireEvent.keyDown(document.body, { key: "L", shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Logged time report" })).toBeInTheDocument();
  });

  it("does nothing where no time is logged", async () => {
    render(<AppLayout />);
    fireEvent.keyDown(document.body, { key: "L", shiftKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Logged time report" })).not.toBeInTheDocument());
  });

  it("is only a capital letter while someone is typing", async () => {
    timeLogging(true);
    render(
      <>
        <input aria-label="notes" />
        <AppLayout />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("notes"), { key: "L", shiftKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Logged time report" })).not.toBeInTheDocument());
  });
});
