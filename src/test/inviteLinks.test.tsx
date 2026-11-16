/**
 * Invite links (2026-11-16; migration 20261116220000): made in Team
 * settings, opened at /join/<token>, accepted once signed in (a new account
 * joins instead of getting an organisation of its own).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string; user_metadata: Record<string, string> } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user }) }));
const navigate = vi.fn();
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

import Join from "@/pages/Join";
import Onboarding from "@/pages/Onboarding";
import { InviteLinkCard } from "@/components/InviteLinkCard";
import { acceptPendingInvite, PENDING_INVITE_DAYS, pendingInvite, rememberInvite } from "@/lib/invites";
import { useOrgStore } from "@/store/orgStore";

const TOKEN = "a".repeat(64);
const answers = (map: Record<string, unknown>) =>
  rpc.mockImplementation((name: string) =>
    Promise.resolve(name in map ? map[name] : { data: null, error: null }),
  );

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  navigate.mockReset();
  auth.user = null;
});

describe("the invite waiting in the browser", () => {
  it("is kept for a week, then dropped", () => {
    const at = new Date("2026-11-16T12:00:00Z");
    rememberInvite({ token: TOKEN, organizationName: "Acme" }, at);
    expect(pendingInvite(new Date(at.getTime() + 86_400_000))).toEqual({ token: TOKEN, organizationName: "Acme" });
    expect(pendingInvite(new Date(at.getTime() + (PENDING_INVITE_DAYS + 1) * 86_400_000))).toBeNull();
  });

  it("is accepted once, and forgotten even when accepting fails", async () => {
    rememberInvite({ token: TOKEN, organizationName: "Acme" });
    answers({ accept_invite: { data: null, error: { message: "This invite link no longer works" } } });
    await expect(acceptPendingInvite()).rejects.toThrow("This invite link no longer works");
    expect(pendingInvite()).toBeNull();
    await expect(acceptPendingInvite()).resolves.toBeNull();
  });
});

describe("the invite page", () => {
  const openJoin = () =>
    render(
      <MemoryRouter initialEntries={[`/join/${TOKEN}`]}>
        <Routes>
          <Route path="/join/:token" element={<Join />} />
        </Routes>
      </MemoryRouter>,
    );

  it("names the organisation, leads to sign-up or sign-in, and remembers the invite", async () => {
    answers({ get_invite: { data: { organizationName: "Acme" }, error: null } });
    openJoin();
    expect(await screen.findByRole("heading", { name: "You're invited to join Acme" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign up to join" }).getAttribute("href")).toBe("/auth/sign-up");
    expect(screen.getByRole("link", { name: /I have an account/ }).getAttribute("href")).toBe("/auth");
    expect(pendingInvite()).toEqual({ token: TOKEN, organizationName: "Acme" });
  });

  it("says so when the link no longer works, and remembers nothing", async () => {
    answers({ get_invite: { data: null, error: null } });
    openJoin();
    expect(await screen.findByRole("heading", { name: "This invite link no longer works" })).toBeTruthy();
    expect(pendingInvite()).toBeNull();
  });

  it("does not count visits, as its address holds the link's secret", () => {
    expect(readFileSync(join(process.cwd(), "src/pages/Join.tsx"), "utf8")).not.toContain("useWebAnalytics");
  });
});

describe("a new account with an invite", () => {
  it("joins the organisation instead of getting one of its own", async () => {
    rememberInvite({ token: TOKEN, organizationName: "Acme" });
    auth.user = { id: "user-1", email: "new@example.com", user_metadata: { full_name: "New Person" } };
    const loadMemberships = vi.fn(async () => {});
    const createOrganization = vi.fn(async () => "own-org");
    const setActiveOrg = vi.fn();
    useOrgStore.setState({ loadMemberships, createOrganization, setActiveOrg } as never);
    answers({ accept_invite: { data: { organizationId: "acme-id", organizationName: "Acme", joined: true }, error: null } });
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/", { replace: true }));
    expect(rpc).toHaveBeenCalledWith("accept_invite", { _token: TOKEN });
    expect(setActiveOrg).toHaveBeenCalledWith("acme-id", "Acme");
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("gets its own organisation as usual when the invite no longer works", async () => {
    rememberInvite({ token: TOKEN, organizationName: "Acme" });
    auth.user = { id: "user-1", email: "new@example.com", user_metadata: { full_name: "New Person" } };
    const createOrganization = vi.fn(async () => "own-org");
    useOrgStore.setState({ loadMemberships: vi.fn(async () => {}), createOrganization } as never);
    answers({ accept_invite: { data: null, error: { message: "This invite link no longer works" } } });
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );
    await waitFor(() => expect(createOrganization).toHaveBeenCalled());
  });
});

describe("the invite link in Team settings", () => {
  it("is made, replaced and turned off by an owner or admin", async () => {
    let current: string | null = null;
    rpc.mockImplementation((name: string) => {
      if (name === "get_invite_link") return Promise.resolve({ data: current, error: null });
      if (name === "create_invite_link") {
        current = current ? "b".repeat(64) : TOKEN;
        return Promise.resolve({ data: current, error: null });
      }
      if (name === "revoke_invite_link") {
        current = null;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    render(<InviteLinkCard orgId="org-1" />);
    const make = await screen.findByRole("button", { name: "Make an invite link" });
    await act(async () => {
      fireEvent.click(make);
    });
    expect((screen.getByRole("textbox", { name: "Invite link" }) as HTMLInputElement).value).toMatch(new RegExp(`/join/${TOKEN}$`));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New link" }));
    });
    expect((screen.getByRole("textbox", { name: "Invite link" }) as HTMLInputElement).value).toMatch(/\/join\/b{64}$/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    });
    expect(screen.getByRole("button", { name: "Make an invite link" })).toBeTruthy();
  });
});

describe("the migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261116220000_invite_links_and_feedback.sql"), "utf8").replace(/--[^\n]*/g, "");

  it("lets only owners and admins see, make and turn off a link", () => {
    for (const fn of ["get_invite_link", "create_invite_link", "revoke_invite_link"]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      expect(body.slice(0, 600)).toContain("public.can_manage_invites(_organization_id)");
    }
    expect(sql).toContain("m.role IN ('owner', 'admin')");
  });

  it("makes a joiner a member, never more, and only with a working link", () => {
    const accept = sql.slice(sql.indexOf("FUNCTION public.accept_invite("));
    expect(accept).toContain("NOT public.invite_works(_invite)");
    expect(accept).toContain("VALUES (_uid, _org, 'member')");
    expect(accept).toContain("SET use_count = use_count + 1");
  });

  it("builds on the invites table the database already had, and turns links off by expiring them", () => {
    expect(sql).not.toMatch(/CREATE TABLE public\.organization_invites/);
    expect(sql).toContain("(_invite.expires_at IS NULL OR _invite.expires_at > now())");
    expect(sql.match(/SET expires_at = now\(\)/g)).toHaveLength(2);
  });

  it("lets signed-out visitors ask only which organisation a link is for", () => {
    expect(sql.match(/TO anon/g)).toHaveLength(1);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_invite(text) TO anon");
    expect(sql).toMatch(/REVOKE ALL ON public\.onboarding_feedback FROM PUBLIC, anon, authenticated/);
  });
});
