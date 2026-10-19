/**
 * Connecting Gmail through the Google sign-in window.
 *
 * On 2026-10-19 a reconnect "hung forever": the button spun on, because the
 * card waited for a message from the sign-in window and nothing else would
 * ever stop it — not the window being closed, not any amount of time. These
 * pin that it now stops waiting, and that the answer still gets through when
 * the window has lost track of the page that opened it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const callGmail = vi.fn();
vi.mock("@/lib/gmailConnector", () => ({ callGmail: (body: Record<string, unknown>) => callGmail(body) }));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (t: unknown) => toast(t), useToast: () => ({ toasts: [], toast }) }));

// Short waits, so the tests run in real time.
vi.mock("@/lib/gmailOAuth", async (original) => ({
  ...(await original<typeof import("@/lib/gmailOAuth")>()),
  GMAIL_POPUP_TIMEOUT_MS: 1_500,
  GMAIL_POPUP_GRACE_MS: 50,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "delete", "insert", "update"]) chain[name] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return { supabase: { from: () => chain } };
});

import { GmailIntegrationsCard } from "@/components/GmailIntegrationsCard";
import { useOrgStore } from "@/store/orgStore";

/** The channel the callback page broadcasts on, as the browser would carry it between pages. */
class FakeChannel {
  static open: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.open.push(this);
  }
  postMessage() {}
  close() {
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this);
  }
  /** What the callback page's broadcast looks like to a page listening. */
  static deliver(data: unknown) {
    for (const c of FakeChannel.open) c.onmessage?.({ data } as MessageEvent);
  }
}

const popup = { closed: false, close: vi.fn() };
const actions = () => callGmail.mock.calls.map(([body]) => (body as { action: string }).action);

beforeEach(() => {
  callGmail.mockReset();
  toast.mockReset();
  popup.closed = false;
  popup.close.mockReset();
  FakeChannel.open = [];
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  vi.spyOn(window, "open").mockImplementation(() => popup as unknown as Window);
  useOrgStore.setState({ activeOrgId: "org-1" } as never);
  callGmail.mockImplementation(async (body: { action: string }) => {
    if (body.action === "status") {
      return { connected: true, email: "me@example.com", oauth: { mode: "shared" } };
    }
    if (body.action === "start") return { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" };
    if (body.action === "exchange") return { connected: true, email: "me@example.com" };
    return {};
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startReconnect() {
  render(<GmailIntegrationsCard />);
  const button = await screen.findByRole("button", { name: /Reconnect/ });
  fireEvent.click(button);
  await waitFor(() => expect(window.open).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /Reconnect/ })).toBeDisabled();
}

describe("connecting Gmail through the sign-in window", () => {
  it("stops waiting when the window is closed without an answer, and asks again whether Gmail is connected", async () => {
    await startReconnect();
    popup.closed = true;
    await waitFor(() => expect(screen.getByRole("button", { name: /Reconnect/ })).toBeEnabled(), { timeout: 3000 });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Gmail is not connected" }));
    expect(actions().filter((a) => a === "status")).toHaveLength(2);
    expect(actions()).not.toContain("exchange");
  });

  it("stops waiting after a while however long the window stays open", async () => {
    await startReconnect();
    await waitFor(() => expect(screen.getByRole("button", { name: /Reconnect/ })).toBeEnabled(), { timeout: 4000 });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/took too long/) }),
    );
  });

  it("finishes from the broadcast when the window no longer knows its opener — and spends the code once", async () => {
    await startReconnect();
    const answer = { source: "gmail-oauth", code: "code-1", state: null, error: null };
    await act(async () => {
      FakeChannel.deliver(answer);
      // The same answer through the opener as well, as when both ways work.
      window.dispatchEvent(new MessageEvent("message", { data: answer, origin: window.location.origin }));
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Gmail connected" })));
    expect(actions().filter((a) => a === "exchange")).toHaveLength(1);
    expect(callGmail).toHaveBeenCalledWith(expect.objectContaining({ action: "exchange", code: "code-1" }));
    expect(screen.getByRole("button", { name: /Reconnect/ })).toBeEnabled();
    // And the window closing afterwards is no failure.
    popup.closed = true;
    await new Promise((r) => setTimeout(r, 900));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Gmail is not connected" }));
  });

  it("leaves a broadcast alone in a page that started no connection — another tab's sign-in is not its own", async () => {
    render(<GmailIntegrationsCard />);
    await screen.findByRole("button", { name: /Reconnect/ });
    await act(async () => {
      FakeChannel.deliver({ source: "gmail-oauth", code: "someone-elses", state: null, error: null });
    });
    expect(actions()).not.toContain("exchange");
  });

  it("says so when Google answers with an error, and stops waiting", async () => {
    await startReconnect();
    await act(async () => {
      FakeChannel.deliver({ source: "gmail-oauth", code: null, state: null, error: "access_denied" });
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Gmail connection cancelled", description: "access_denied" })),
    );
    expect(screen.getByRole("button", { name: /Reconnect/ })).toBeEnabled();
  });
});
