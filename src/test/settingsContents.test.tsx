/**
 * The table of contents at the top of Bells & Whistles.
 *
 * It never points at nothing — every link leads to a section the page shows —
 * and its Features group is exactly the twelve the all-features switch moves,
 * by the names that switch uses, so "12 of 12 are on" and the list beside it
 * count the same things. (A first version listed every section in one list,
 * seventeen of them, beside a switch that said twelve.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "order", "maybeSingle", "upsert"]) chain[name] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
  return { supabase: { from: () => chain } };
});
// The cards the page borrows from elsewhere, as stand-ins: each is tested on its own.
vi.mock("@/components/TeamManagement", () => ({ TeamManagement: () => <div>Teams card</div> }));
vi.mock("@/components/BackupsCard", () => ({ BackupsCard: () => <div>Backups card</div> }));
vi.mock("@/components/GithubIntegrationsCard", () => ({ GithubIntegrationsCard: () => <div>GitHub card</div> }));
vi.mock("@/components/GmailIntegrationsCard", () => ({
  GmailIntegrationsCard: () => <div>Gmail link import card</div>,
  JobAdImportCard: () => <div>Job ad import card</div>,
}));
vi.mock("@/components/LabelsManager", () => ({ LabelsManager: () => null }));
vi.mock("@/components/TimesheetBrowserDialog", () => ({ TimesheetBrowserDialog: () => null }));
vi.mock("@/components/AllBellsAndWhistlesToggle", () => ({ AllBellsAndWhistlesToggle: () => <div>All switch</div> }));
vi.mock("@/store/labelsStore", () => ({
  useLabelsStore: (select: (s: { loadLabels: () => void }) => unknown) => select({ loadLabels: () => {} }),
}));

import { BellsAndWhistlesSection } from "@/components/BellsAndWhistlesSection";
import { useOrgStore } from "@/store/orgStore";
import { BELLS_AND_WHISTLES } from "@/store/orgSettingsStore";

function asMember(role: "owner" | "member", slug = "agilefant") {
  useOrgStore.setState({
    activeOrgId: "org-1",
    roleOverride: null,
    memberships: [{ organization_id: "org-1", organization_name: "Agilefant", organization_slug: slug, role }],
  } as never);
}

const contents = () => screen.getByRole("navigation", { name: "On this page" });
const group = (name: string | RegExp) => within(contents()).getByRole("region", { name });
const texts = (el: HTMLElement) => within(el).getAllByRole("listitem").map((li) => li.textContent);
const linksLeadSomewhere = () => {
  for (const a of within(contents()).getAllByRole("link")) {
    expect(document.getElementById(a.getAttribute("href")!.slice(1)), a.textContent ?? "").not.toBeNull();
  }
};

beforeEach(() => {
  window.history.replaceState(null, "", "/settings/bells-whistles");
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the contents of Bells & Whistles", () => {
  it("comes first, in two groups, and every link leads to a section on the page", () => {
    asMember("owner");
    render(<BellsAndWhistlesSection showHeader={false} />);
    expect(contents().compareDocumentPosition(screen.getByText("All switch")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(texts(group("General"))).toEqual([
      "All bells & whistles", "Teams", "Backups & Restore", "GitHub repositories", "Gmail link import", "Job ad import",
    ]);
    linksLeadSomewhere();
  });

  it("lists as features exactly the twelve the switch moves, by its names, Labs' two among them", () => {
    asMember("owner");
    render(<BellsAndWhistlesSection showHeader={false} />);
    const features = group(`Features (${BELLS_AND_WHISTLES.length})`);
    expect(texts(features)).toEqual(BELLS_AND_WHISTLES.map((f) => f.label));
    expect(texts(features)).toHaveLength(12);
    expect(within(features).getByRole("link", { name: "Burnups" })).toHaveAttribute("href", "#labs");
    expect(within(features).getByRole("link", { name: "Persist notifications" })).toHaveAttribute("href", "#persist-notifications");
  });

  it("still counts twelve for a member, naming custom statuses without a link to a section they are not shown", () => {
    asMember("member", "another-org");
    render(<BellsAndWhistlesSection showHeader={false} />);
    expect(texts(group("General"))).not.toContain("Gmail link import");
    const features = group("Features (12)");
    expect(texts(features)).toHaveLength(12);
    expect(within(features).queryByRole("link", { name: "Custom statuses" })).toBeNull();
    expect(within(features).getByText("Custom statuses")).toBeInTheDocument();
    expect(within(features).getByText(/owners and admins/)).toBeInTheDocument();
    linksLeadSomewhere();
  });

  it("brings the section into view, gives it focus, and leaves its address to link to", () => {
    asMember("owner");
    render(<BellsAndWhistlesSection showHeader={false} />);
    fireEvent.click(within(contents()).getByRole("link", { name: "Labels" }));
    const labels = document.getElementById("labels")!;
    expect(labels.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.activeElement).toBe(labels);
    expect(window.location.hash).toBe("#labels");
  });

  it("opens at the section an address names", async () => {
    window.history.replaceState(null, "", "/settings/bells-whistles#scrambling");
    asMember("owner");
    render(<BellsAndWhistlesSection showHeader={false} />);
    await vi.waitFor(() => expect(document.getElementById("scrambling")!.scrollIntoView).toHaveBeenCalled());
  });
});
