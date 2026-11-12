/**
 * Deleting your own account from Team settings: the database decides and
 * deletes (delete_my_account), then the Clerk sign-in goes, the browser
 * forgets its cached data, and the person is signed out. A refusal from the
 * database — an organisation left without an owner — stops it all, with the
 * reason shown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  deleteClerkAccount: vi.fn(),
  signOut: vi.fn(),
  clearAllCachedAppData: vi.fn(),
  toasts: [] as Array<{ title: string; description?: string; variant?: string }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/lib/clerkBridge", () => ({ deleteClerkAccount: h.deleteClerkAccount }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ signOut: h.signOut }) }));
vi.mock("@/store/appDataCache", () => ({ clearAllCachedAppData: h.clearAllCachedAppData }));
vi.mock("@/hooks/use-toast", () => ({
  toast: (t: { title: string; description?: string; variant?: string }) => {
    h.toasts.push(t);
    return { id: "t", dismiss: () => {}, update: () => {} };
  },
}));

import { DeleteAccountCard, CONFIRM_WORD } from "@/components/DeleteAccountCard";

function renderCard() {
  render(
    <MemoryRouter initialEntries={["/settings/team"]}>
      <Routes>
        <Route path="/settings/team" element={<DeleteAccountCard />} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function openAndConfirm(word = CONFIRM_WORD) {
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  fireEvent.change(screen.getByLabelText("Confirm account deletion"), { target: { value: word } });
  return screen.getByRole("button", { name: "Delete my account" });
}

beforeEach(() => {
  h.rpc.mockReset().mockResolvedValue({ data: { deleted_organizations: [] }, error: null });
  h.deleteClerkAccount.mockReset().mockResolvedValue(undefined);
  h.signOut.mockReset().mockResolvedValue(undefined);
  h.clearAllCachedAppData.mockReset().mockResolvedValue(undefined);
  h.toasts.length = 0;
  localStorage.setItem("activeOrgId", "org-1");
});

describe("deleting your own account", () => {
  it("asks for the word first", () => {
    renderCard();
    expect(openAndConfirm("nope")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirm account deletion"), { target: { value: " Delete " } });
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeEnabled();
  });

  it("deletes the data, then the sign-in, forgets this browser's copy, and signs out", async () => {
    renderCard();
    fireEvent.click(openAndConfirm());
    await screen.findByText("Home page");

    expect(h.rpc).toHaveBeenCalledWith("delete_my_account");
    expect(h.deleteClerkAccount).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.invocationCallOrder[0]).toBeLessThan(h.deleteClerkAccount.mock.invocationCallOrder[0]);
    expect(h.clearAllCachedAppData).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("activeOrgId")).toBeNull();
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.toasts).toEqual([expect.objectContaining({ title: "Your account is deleted" })]);
  });

  it("stops at the database's refusal, and says why", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: 'You are the only owner of "Acme". Make another member an owner first.' },
    });
    renderCard();
    fireEvent.click(openAndConfirm());
    await waitFor(() => expect(h.toasts).toHaveLength(1));

    expect(h.toasts[0]).toMatchObject({
      title: "Your account was not deleted",
      description: 'You are the only owner of "Acme". Make another member an owner first.',
      variant: "destructive",
    });
    expect(h.deleteClerkAccount).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem("activeOrgId")).toBe("org-1");
    expect(screen.queryByText("Home page")).toBeNull();
  });

  it("still signs out when Clerk keeps the sign-in, and says whom to ask", async () => {
    h.deleteClerkAccount.mockRejectedValue(new Error("not allowed"));
    renderCard();
    fireEvent.click(openAndConfirm());
    await screen.findByText("Home page");

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.toasts[0].title).toBe("Your data is deleted, but not your sign-in");
    expect(h.toasts[0].description).toContain("not allowed");
    expect(h.toasts[0].description).toContain("@");
  });
});
