/**
 * One switch at the top of Bells & Whistles for all of them.
 *
 * It reads "on" only when every feature is on, asks before switching either
 * way — naming what will change — and writes them all in one go. Owners and
 * admins only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const upsert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: (...args: unknown[]) => upsert(...args) }) },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (t: unknown) => toast(t), useToast: () => ({ toasts: [], toast }) }));

import { AllBellsAndWhistlesToggle } from "@/components/AllBellsAndWhistlesToggle";
import { BELLS_AND_WHISTLES, useOrgSettingsStore } from "@/store/orgSettingsStore";

const ORG = "org-1";
type Settings = ReturnType<typeof useOrgSettingsStore.getState>["settings"][string];

function settings(on: (key: string) => boolean): Settings {
  const base = {
    timeLoggingEnabled: false, pointsEnabled: false, labelsEnabled: false, customStatusesEnabled: false,
    savingsIncomeEnabled: false, boardsEnabled: true, burnupsEnabled: false, persistNotificationsEnabled: false,
    publicLinksEnabled: true, ratingsEnabled: false, deadlinesEnabled: false, createdDatesEnabled: false,
    startEndDatesEnabled: false, scramblingEnabled: false,
  } as Settings;
  for (const f of BELLS_AND_WHISTLES) (base as Record<string, boolean>)[f.key] = on(f.key);
  return base;
}

const switchEl = () => screen.getByRole("switch", { name: "All bells & whistles" });
const current = () => useOrgSettingsStore.getState().settings[ORG];

beforeEach(() => {
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  toast.mockReset();
});

describe("the switch for all bells & whistles", () => {
  it("reads on only when every feature is on, and says how many are", () => {
    useOrgSettingsStore.setState({ settings: { [ORG]: settings((k) => k === "pointsEnabled" || k === "labelsEnabled") } });
    const { unmount } = render(<AllBellsAndWhistlesToggle orgId={ORG} canManage />);
    expect(switchEl()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/2 of 12 are on now/)).toBeInTheDocument();
    unmount();

    useOrgSettingsStore.setState({ settings: { [ORG]: settings(() => true) } });
    render(<AllBellsAndWhistlesToggle orgId={ORG} canManage />);
    expect(switchEl()).toHaveAttribute("aria-checked", "true");
  });

  it("asks before switching them all on, naming the ones that will change — and changes nothing if cancelled", async () => {
    useOrgSettingsStore.setState({ settings: { [ORG]: settings((k) => k === "pointsEnabled") } });
    render(<AllBellsAndWhistlesToggle orgId={ORG} canManage />);
    fireEvent.click(switchEl());

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Switch on all bells & whistles?")).toBeInTheDocument();
    const named = within(dialog).getAllByRole("listitem").map((li) => li.textContent);
    expect(named).toHaveLength(11);
    expect(named).not.toContain("Points");
    expect(named).toContain("Time logging");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(upsert).not.toHaveBeenCalled();
    expect(current().timeLoggingEnabled).toBe(false);
  });

  it("switches them all on in one write once confirmed, and leaves public links and boards alone", async () => {
    useOrgSettingsStore.setState({ settings: { [ORG]: settings(() => false) } });
    render(<AllBellsAndWhistlesToggle orgId={ORG} canManage />);
    fireEvent.click(switchEl());
    fireEvent.click(await screen.findByRole("button", { name: "Switch all on" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "All bells & whistles switched on" }));
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, options] = upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: "organization_id" });
    for (const f of BELLS_AND_WHISTLES) expect(row[f.column]).toBe(true);
    expect(row).not.toHaveProperty("public_links_enabled");
    expect(row).not.toHaveProperty("boards_enabled");
    expect(BELLS_AND_WHISTLES.every((f) => current()[f.key])).toBe(true);
    expect(current().publicLinksEnabled).toBe(true);
    expect(switchEl()).toHaveAttribute("aria-checked", "true");
  });

  it("asks before switching them all off too, and says nothing is deleted", async () => {
    useOrgSettingsStore.setState({ settings: { [ORG]: settings(() => true) } });
    render(<AllBellsAndWhistlesToggle orgId={ORG} canManage />);
    fireEvent.click(switchEl());
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Switch off all bells & whistles?")).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing is deleted/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(12);

    fireEvent.click(within(dialog).getByRole("button", { name: "Switch all off" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "All bells & whistles switched off" }));
    expect(BELLS_AND_WHISTLES.some((f) => current()[f.key])).toBe(false);
    expect(upsert.mock.calls[0][0].points_enabled).toBe(false);
  });

  it("puts everything back and says so when the database refuses", async () => {
    upsert.mockResolvedValue({ error: { message: "permission denied for table organization_settings" } });
    useOrgSettingsStore.setState({ settings: { [ORG]: settings((k) => k === "labelsEnabled") } });
    render(<AllBellsAndWhistlesToggle orgId={ORG} canManage />);
    fireEvent.click(switchEl());
    fireEvent.click(await screen.findByRole("button", { name: "Switch all on" }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not change the settings", variant: "destructive" })),
    );
    expect(current().labelsEnabled).toBe(true);
    expect(current().pointsEnabled).toBe(false);
  });

  it("is for owners and admins only", () => {
    useOrgSettingsStore.setState({ settings: { [ORG]: settings(() => false) } });
    render(<AllBellsAndWhistlesToggle orgId={ORG} canManage={false} />);
    expect(switchEl()).toBeDisabled();
    expect(screen.getByText(/Only an owner or admin can use this/)).toBeInTheDocument();
  });
});
