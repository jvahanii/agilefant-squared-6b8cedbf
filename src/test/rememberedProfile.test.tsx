import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  fetchAppUserId: vi.fn<() => Promise<string | null>>(),
  linkClerkIdentity: vi.fn<() => Promise<string | null>>(),
  clerkSignOut: vi.fn(async () => {}),
  // One object, as the real bridge hands out: useSyncExternalStore loops on a fresh one.
  state: {
    status: "signed-in",
    identity: { clerkUserId: "user_clerk1", email: "a@example.com", fullName: "A", avatarUrl: null },
  },
}));

vi.mock("@/lib/clerkBridge", () => ({
  getClerkState: () => bridge.state,
  subscribeToClerk: () => () => {},
  fetchAppUserId: bridge.fetchAppUserId,
  linkClerkIdentity: bridge.linkClerkIdentity,
  clerkSignOut: bridge.clerkSignOut,
}));

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { rememberProfileFor, rememberedProfileFor } from "@/lib/profileMapping";

function Probe() {
  const { user, loading, signOut } = useAuth();
  return (
    <div>
      <span data-testid="state">{loading ? "loading" : user ? `user:${user.id}` : "none"}</span>
      <button onClick={() => void signOut()}>out</button>
    </div>
  );
}

const renderApp = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

describe("the remembered profile", () => {
  beforeEach(() => {
    localStorage.clear();
    bridge.fetchAppUserId.mockReset();
    bridge.linkClerkIdentity.mockReset();
  });

  it("opens straight away on a repeat start, without waiting for the lookup", async () => {
    rememberProfileFor("user_clerk1", "profile-1");
    bridge.fetchAppUserId.mockReturnValue(new Promise(() => {}));
    renderApp();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("user:profile-1"));
  });

  it("waits for the lookup the first time, then remembers its answer", async () => {
    let answer!: (id: string) => void;
    bridge.fetchAppUserId.mockReturnValue(new Promise((r) => (answer = r)));
    renderApp();
    expect(screen.getByTestId("state").textContent).toBe("loading");
    await act(async () => answer("profile-1"));
    expect(screen.getByTestId("state").textContent).toBe("user:profile-1");
    expect(rememberedProfileFor("user_clerk1")).toBe("profile-1");
  });

  it("follows the lookup when it disagrees with what was remembered", async () => {
    rememberProfileFor("user_clerk1", "profile-old");
    bridge.fetchAppUserId.mockResolvedValue("profile-new");
    renderApp();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("user:profile-new"));
    expect(rememberedProfileFor("user_clerk1")).toBe("profile-new");
  });

  it("keeps the remembered profile when the check fails on a bad connection", async () => {
    rememberProfileFor("user_clerk1", "profile-1");
    bridge.fetchAppUserId.mockRejectedValue(new Error("Failed to fetch"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderApp();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.getByTestId("state").textContent).toBe("user:profile-1");
    expect(rememberedProfileFor("user_clerk1")).toBe("profile-1");
    warn.mockRestore();
  });

  it("is forgotten on signing out", async () => {
    rememberProfileFor("user_clerk1", "profile-1");
    bridge.fetchAppUserId.mockResolvedValue("profile-1");
    renderApp();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("user:profile-1"));
    await act(async () => screen.getByText("out").click());
    expect(rememberedProfileFor("user_clerk1")).toBeNull();
  });
});
