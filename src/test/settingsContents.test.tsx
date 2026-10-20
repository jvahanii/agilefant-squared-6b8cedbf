/**
 * The table of contents at the top of Bells & Whistles.
 *
 * What matters is that it never points at nothing: every entry leads to a
 * section the page actually shows, and a section the page leaves out for
 * someone — custom statuses for a member, the link import outside Agilefant's
 * own organization — is left out of the contents too.
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

function asMember(role: "owner" | "member", slug = "agilefant") {
  useOrgStore.setState({
    activeOrgId: "org-1",
    roleOverride: null,
    memberships: [{ organization_id: "org-1", organization_name: "Agilefant", organization_slug: slug, role }],
  } as never);
}

const contents = () => screen.getByRole("navigation", { name: "On this page" });
const entries = () => within(contents()).getAllByRole("link");

beforeEach(() => {
  window.history.replaceState(null, "", "/settings/bells-whistles");
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the contents of Bells & Whistles", () => {
  it("comes first, and every entry leads to a section that is on the page", () => {
    asMember("owner");
    render(<BellsAndWhistlesSection showHeader={false} />);
    // Before the first section on the page.
    expect(contents().compareDocumentPosition(screen.getByText("All switch")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const ids = entries().map((a) => a.getAttribute("href")!.slice(1));
    expect(ids).toHaveLength(17);
    for (const id of ids) expect(document.getElementById(id), id).not.toBeNull();
    expect(entries().map((a) => a.textContent)).toEqual([
      "All bells & whistles", "Teams", "Backups & Restore", "GitHub repositories", "Gmail link import", "Job ad import",
      "Points", "Ratings", "Deadlines", "Created dates", "Start and end dates", "Scrambling", "Time Logging",
      "Custom Statuses", "Labels", "Savings & Income", "Labs",
    ]);
  });

  it("leaves out what the page leaves out: custom statuses for a member, the link import elsewhere", () => {
    asMember("member", "another-org");
    render(<BellsAndWhistlesSection showHeader={false} />);
    const labels = entries().map((a) => a.textContent);
    expect(labels).not.toContain("Custom Statuses");
    expect(labels).not.toContain("Gmail link import");
    expect(labels).toHaveLength(15);
    for (const a of entries()) expect(document.getElementById(a.getAttribute("href")!.slice(1))).not.toBeNull();
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
