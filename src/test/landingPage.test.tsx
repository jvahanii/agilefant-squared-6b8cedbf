/**
 * The page a signed-out visitor lands on. Checked for what the visitor needs
 * from it: a way in for someone new and someone returning, and in-page links
 * that go somewhere — a "Pricing" link whose section has been renamed away
 * scrolls nowhere and says nothing.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Landing from "@/pages/Landing";

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Landing />
    </MemoryRouter>,
  );
}

describe("Landing", () => {
  it("says what Agilefant is in one heading", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/every backlog you have/i);
  });

  it("offers both a sign-up and a sign-in from the header", () => {
    renderLanding();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth");
    expect(within(header).getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/auth/sign-up");
  });

  it("points every call to action somewhere real", () => {
    // The wording of this page is edited in Lovable, so the assertions below
    // are about where a link goes, never about what it says. A route is worth
    // pinning — a signed-out visitor sent to one the app does not serve lands
    // back on the sign-in form with no explanation.
    renderLanding();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      expect(href, "a link with no destination").not.toBe("");
      if (href.startsWith("#")) continue;
      if (href.startsWith("mailto:")) {
        expect(href, href).toMatch(/^mailto:[^@\s]+@[^@\s.]+\.[^@\s]+$/);
        continue;
      }
      expect(href, href).toMatch(/^\/(auth(\/sign-up)?|user-guide)$/);
    }
  });

  it("has a section for every in-page link", () => {
    const { container } = renderLanding();
    const anchors = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.startsWith("#"));
    expect(anchors).toEqual(expect.arrayContaining(["#features", "#pricing"]));
    for (const href of anchors) {
      expect(container.querySelector(href), href).not.toBeNull();
    }
  });

  it("is where Clerk drops someone who has just signed out", () => {
    // Read from the source because main.tsx mounts the whole app on import.
    // Signing out used to land on the sign-in form, which invites the person
    // who has just left to go straight back in.
    const main = readFileSync(join(process.cwd(), "src", "main.tsx"), "utf8");
    expect(main).toMatch(/afterSignOutUrl="\/"/);
  });

  it("gives every plan a name and something under it", () => {
    // Which plans there are, and what each promises, is a pricing decision
    // that changes without the code changing shape — so this checks only that
    // each one arrives whole. A blank bullet is the failure worth catching:
    // it renders as a tick with nothing beside it.
    const { container } = renderLanding();
    const pricing = container.querySelector("#pricing");
    expect(pricing).not.toBeNull();
    const names = within(pricing as HTMLElement).getAllByRole("heading", { level: 3 });
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.map((h) => h.textContent)).toContain("Free");

    const bullets = within(pricing as HTMLElement).getAllByRole("listitem");
    expect(bullets.length).toBeGreaterThanOrEqual(names.length);
    for (const li of bullets) expect(li.textContent?.trim(), "a bullet with no text").not.toBe("");
  });
});
