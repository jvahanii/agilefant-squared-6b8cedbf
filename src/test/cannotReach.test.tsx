/**
 * Organisations that could not be loaded are not "no organisations"
 * (2026-11-17): while the database was down, an empty list sent a signed-in
 * person to Onboarding, which tried to make them a new organisation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/supabaseRetry", () => ({ withSupabaseRetry: (f: () => unknown) => f() }));
const auth = vi.hoisted(() => ({ user: { id: "user-1", email: "a@example.com", user_metadata: {} } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user }) }));

import { useOrgStore } from "@/store/orgStore";
import { CannotReach, CANNOT_REACH_RETRY_MS } from "@/components/CannotReach";
import Onboarding from "@/pages/Onboarding";

beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
  useOrgStore.setState({ memberships: [], activeOrgId: null, loading: true, unreachable: false } as never);
});
afterEach(() => vi.useRealTimers());

describe("loading the organisations", () => {
  it("marks them unreachable when the load fails, and clears that when one succeeds", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "connection timeout" } });
    await useOrgStore.getState().loadMemberships("user-1");
    expect(useOrgStore.getState()).toMatchObject({ memberships: [], loading: false, unreachable: true });

    rpc.mockResolvedValueOnce({ data: [{ organization_id: "o", organization_name: "Acme", organization_slug: "acme", role: "owner" }], error: null });
    await useOrgStore.getState().loadMemberships("user-1");
    expect(useOrgStore.getState()).toMatchObject({ loading: false, unreachable: false });
    expect(useOrgStore.getState().memberships).toHaveLength(1);
  });

  it("marks them unreachable when no answer comes in 10 seconds", async () => {
    vi.useFakeTimers();
    rpc.mockReturnValue(new Promise(() => {}));
    void useOrgStore.getState().loadMemberships("user-1");
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(useOrgStore.getState()).toMatchObject({ loading: false, unreachable: true });
  });
});

describe("while they cannot be reached", () => {
  it("the app says so and tries again by itself", () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    render(<CannotReach onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toMatch(/can't be reached right now/);
    act(() => vi.advanceTimersByTime(CANNOT_REACH_RETRY_MS * 2));
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("the app shows that instead of Onboarding", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const reach = app.indexOf("memberships.length === 0 && membershipsUnreachable");
    const onboarding = app.indexOf('path="/onboarding"');
    expect(reach).toBeGreaterThan(-1);
    expect(reach).toBeLessThan(onboarding);
  });

  it("Onboarding makes no organisation", async () => {
    const createOrganization = vi.fn(async () => "new-org");
    useOrgStore.setState({ unreachable: true, createOrganization, loadMemberships: vi.fn() } as never);
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(createOrganization).not.toHaveBeenCalled();
  });
});
