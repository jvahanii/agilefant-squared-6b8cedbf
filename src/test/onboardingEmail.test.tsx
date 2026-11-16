/**
 * The email the day after someone first signs in, its unsubscribe links, and
 * the page those links open (2026-11-16).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildReminder,
  greetingName,
  isUserId,
  signUnsubscribe,
  verifyUnsubscribe,
} from "../../supabase/functions/_shared/onboardingEmail";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import Unsubscribe from "@/pages/Unsubscribe";

const base = { appUrl: "https://agilefant.org", unsubscribeUrl: "https://agilefant.org/unsubscribe?u=1&s=2" };
const USER = "8b7ae8ae-5d07-4da0-b26a-13661b1f7392";

describe("the reminder", () => {
  it("asks someone with no items for a first one", () => {
    const r = buildReminder({ ...base, fullName: "Anna Virtanen", itemsAdded: 0 });
    expect(r.subject).toBe("Add your first item to Agilefant");
    expect(r.text).toMatch(/^Hi Anna,/);
    expect(r.text).toContain("Add your first item: https://agilefant.org");
    expect(r.html).toContain(">Add your first item</a>");
  });

  it("points someone with items back to them, with tips", () => {
    const one = buildReminder({ ...base, fullName: null, itemsAdded: 1 });
    expect(one.subject).toBe("Your first item is waiting in Agilefant");
    expect(one.text).toMatch(/^Hi,/);
    const many = buildReminder({ ...base, fullName: "Bo", itemsAdded: 7 });
    expect(many.subject).toBe("Your 7 items are waiting in Agilefant");
    expect(many.text).toContain("- Select an item and press Tab");
    expect(many.html).toContain("<li");
  });

  it("always says why it came and how to stop it", () => {
    for (const itemsAdded of [0, 3]) {
      const r = buildReminder({ ...base, fullName: "x", itemsAdded });
      expect(r.text).toContain("once, the day after you signed up");
      expect(r.text).toContain(`Unsubscribe: ${base.unsubscribeUrl}`);
      expect(r.html).toContain(`href="${base.unsubscribeUrl.replace(/&/g, "&amp;")}"`);
    }
  });

  it("greets by first name, never by an email address, and escapes it", () => {
    expect(greetingName("  Anna  Maria ")).toBe("Anna");
    expect(greetingName("anna@example.com")).toBeNull();
    expect(greetingName("")).toBeNull();
    expect(buildReminder({ ...base, fullName: "<b>x</b>", itemsAdded: 0 }).html).toContain("Hi &lt;b&gt;x&lt;/b&gt;,");
  });
});

describe("unsubscribe links", () => {
  it("are signed for one person", async () => {
    const s = await signUnsubscribe(USER, "secret");
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyUnsubscribe(USER, s, "secret")).toBe(true);
    expect(await verifyUnsubscribe(USER, s, "other secret")).toBe(false);
    expect(await verifyUnsubscribe("00000000-0000-0000-0000-000000000000", s, "secret")).toBe(false);
    expect(await verifyUnsubscribe(USER, "abc", "secret")).toBe(false);
  });

  it("name a user by id only", () => {
    expect(isUserId(USER)).toBe(true);
    expect(isUserId("x'; drop table profiles")).toBe(false);
    expect(isUserId(undefined)).toBe(false);
  });
});

describe("the unsubscribe page", () => {
  beforeEach(() => invoke.mockReset());
  const open = (search: string) =>
    render(
      <MemoryRouter initialEntries={[`/unsubscribe${search}`]}>
        <Unsubscribe />
      </MemoryRouter>,
    );

  it("asks first, then unsubscribes with the link's signature", async () => {
    invoke.mockResolvedValue({ data: { unsubscribed: true }, error: null });
    open(`?u=${USER}&s=abc`);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByRole("heading", { name: "You're unsubscribed" })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("onboarding-reminder", { body: { unsubscribe: { u: USER, s: "abc" } } });
  });

  it("shows the server's reason when the link is refused", async () => {
    const context = new Response(JSON.stringify({ error: "This unsubscribe link is not valid." }), { status: 400 });
    invoke.mockResolvedValue({ data: null, error: { context } });
    open(`?u=${USER}&s=abc`);
    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This unsubscribe link is not valid.");
  });

  it("explains an incomplete link and offers no button", () => {
    open("?u=only");
    expect(screen.getByRole("alert").textContent).toMatch(/incomplete/);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the schedule", () => {
  const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261116120000_next_day_reminder.sql"), "utf8");

  it("emails each person once, a day after first sign-in, never the superuser or someone opted out", () => {
    expect(sql).toContain("user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE");
    expect(sql).toMatch(/created_at <= now\(\) - interval '24 hours'/);
    expect(sql).toMatch(/NOT p\.is_superuser/);
    expect(sql).toMatch(/NOT p\.product_emails_off/);
  });

  it("keeps the table and the claim to the server", () => {
    expect(sql).toContain("REVOKE ALL ON public.onboarding_emails FROM anon, authenticated");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.claim_onboarding_reminders(integer) FROM PUBLIC, anon, authenticated");
  });
});
