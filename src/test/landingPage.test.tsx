/**
 * The page a signed-out visitor lands on. Checked for what the visitor needs
 * from it: a way in for someone new and someone returning, and in-page links
 * that go somewhere — a "Pricing" link whose section has been renamed away
 * scrolls nowhere and says nothing.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
    renderLanding();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const href of hrefs) {
      expect(href).toMatch(/^(\/auth(\/sign-up)?|\/user-guide|#[a-z]+|mailto:sales@agilefant\.org)$/);
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

  it("shows all three plans, with the free one free", () => {
    renderLanding();
    for (const plan of ["Free", "Starter", "Enterprise"]) {
      expect(screen.getByRole("heading", { level: 3, name: plan })).toBeInTheDocument();
    }
    expect(screen.getByText("Unlimited work items")).toBeInTheDocument();
  });
});
