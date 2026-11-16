/**
 * The sign-up page speaks to a newcomer (2026-11-16): whose it is and the
 * way back, the terms, a way to try first, and the items waiting from the
 * try-out. The note about the move to the new sign-in is for sign-in only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@clerk/clerk-react", () => ({
  SignUp: () => <div>Clerk sign-up form</div>,
  SignIn: () => <div>Clerk sign-in form</div>,
}));
vi.mock("@/lib/clerkBridge", () => ({ clerkEnabled: true }));

import Auth from "@/pages/Auth";
import { saveTryList } from "@/lib/tryList";
import { onIosSafari, useInstallWay } from "@/lib/installPrompt";

const renderAuth = (mode: "sign-in" | "sign-up") =>
  render(
    <MemoryRouter>
      <Auth mode={mode} />
    </MemoryRouter>,
  );
const MOVE_NOTE = /new enterprise grade sign-in/;

beforeEach(() => localStorage.clear());

describe("the sign-up page", () => {
  it("names Agilefant and leads back to the front page, without the note meant for returning users", () => {
    renderAuth("sign-up");
    expect(screen.getByRole("link", { name: /Agilefant/ }).getAttribute("href")).toBe("/");
    expect(screen.queryByText(MOVE_NOTE)).toBeNull();
    expect(screen.getByText("Clerk sign-up form")).toBeTruthy();
  });

  it("says that creating an account means agreeing to the terms, and offers the try-out", () => {
    renderAuth("sign-up");
    expect(screen.getByText(/By creating an account you agree to the/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "terms and privacy notice" }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: "Try it first" }).getAttribute("href")).toBe("/try");
  });

  it("tells someone from the try-out that their items are waiting, instead of offering the try-out again", () => {
    saveTryList([
      { id: "a", title: "One", depth: 0, done: false },
      { id: "b", title: "Two", depth: 1, done: true },
    ]);
    renderAuth("sign-up");
    expect(screen.getByText("The 2 items you added in the try-out will be waiting in your new account.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Try it first" })).toBeNull();
  });
});

describe("the sign-in page", () => {
  it("keeps the note for people who had an account before the move", () => {
    renderAuth("sign-in");
    expect(screen.getByText(MOVE_NOTE)).toBeTruthy();
    expect(screen.queryByText(/By creating an account/)).toBeNull();
  });
});

describe("putting the app on the home screen", () => {
  it("knows Safari on an iPhone from other browsers there", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(onIosSafari(iphone)).toBe(true);
    expect(onIosSafari(iphone.replace("Version/17.0", "CriOS/120.0"))).toBe(false);
    expect(onIosSafari("Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36")).toBe(false);
  });

  it("offers the browser's own install once the browser offers it", async () => {
    const { result } = renderHook(() => useInstallWay());
    expect(result.current).toBeNull();
    const prompt = vi.fn(async () => {});
    const offer = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    act(() => {
      window.dispatchEvent(offer);
    });
    expect(result.current?.kind).toBe("prompt");
    let accepted = false;
    await act(async () => {
      if (result.current?.kind === "prompt") accepted = await result.current.install();
    });
    expect(prompt).toHaveBeenCalled();
    expect(accepted).toBe(true);
    expect(result.current).toBeNull();
  });
});
