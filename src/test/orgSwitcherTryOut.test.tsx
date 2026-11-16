/**
 * The organisation menu in the try-out (/try) offers only the try-out's own
 * organisation: creating one, its settings and signing out lead nowhere
 * without an account (2026-11-16).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const demo = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/demoMode", () => ({ isDemoMode: () => demo.on }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, signOut: vi.fn() }) }));
vi.mock("@/lib/superuser", () => ({ fetchIsSuperuser: async () => ({ isSuperuser: false, needsSecondFactor: false }) }));

import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useOrgStore } from "@/store/orgStore";

function openMenu() {
  render(
    <MemoryRouter>
      <OrgSwitcher />
    </MemoryRouter>,
  );
  const trigger = screen.getByRole("button", { name: /Try-out/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.keyDown(trigger, { key: "Enter" });
}

beforeEach(() => {
  useOrgStore.setState({
    activeOrgId: "org",
    memberships: [{ organization_id: "org", organization_name: "Try-out", organization_slug: "try-out", role: "owner" }],
  } as never);
});

describe("the organisation menu", () => {
  it("in the try-out, offers only the organisation itself", async () => {
    demo.on = true;
    openMenu();
    expect(await screen.findByRole("menuitem", { name: /Try-out/ })).toBeTruthy();
    for (const name of [/New Organization/, /Org Settings/, /Sign Out/]) {
      expect(screen.queryByRole("menuitem", { name })).toBeNull();
    }
  });

  it("elsewhere, still offers creating one, its settings and signing out", async () => {
    demo.on = false;
    openMenu();
    expect(await screen.findByRole("menuitem", { name: /New Organization/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Org Settings/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Sign Out/ })).toBeTruthy();
  });
});
