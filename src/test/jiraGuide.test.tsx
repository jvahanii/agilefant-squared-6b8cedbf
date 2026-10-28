/**
 * The public Jira integration guide, and the user guide's sections linked to
 * directly. Checked for what a reader relies on: every section listed in "On
 * this page" exists to jump to, the guide says what keeps a moved item synced
 * — an earlier version said moving an item out of its list deleted its issue —
 * and /user-guide#jira opens the Jira section, with the full guide a link away.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import JiraGuide from "@/pages/JiraGuide";
import { UserGuideContent } from "@/components/UserGuideDialog";

function renderGuide() {
  return render(
    <MemoryRouter initialEntries={["/user-guide/jira"]}>
      <JiraGuide />
    </MemoryRouter>,
  );
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("JiraGuide", () => {
  it("renders the guide with its title", () => {
    renderGuide();
    expect(screen.getByRole("heading", { level: 1, name: "Jira integration" })).toBeInTheDocument();
  });

  it("has a section for every entry in the table of contents", () => {
    const { container } = renderGuide();
    const anchors = within(screen.getByRole("navigation", { name: "On this page" })).getAllByRole("link");
    expect(anchors.length).toBeGreaterThan(5);
    for (const a of anchors) {
      expect(container.querySelector(`section#${a.getAttribute("href")!.slice(1)}`)).not.toBeNull();
    }
  });

  it("says an item moved out of its list keeps syncing", () => {
    renderGuide();
    expect(screen.getByText(/keeps its issue and keeps syncing/)).toBeInTheDocument();
  });
});

describe("the user guide linked to by section", () => {
  it("opens the section the address names, with its full guide a link away", () => {
    window.history.replaceState(null, "", "/user-guide#jira");
    render(<UserGuideContent linked />);
    expect(screen.getByRole("heading", { level: 2, name: "Jira Integration" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /full Jira integration guide/ })).toHaveAttribute("href", "/user-guide/jira");
  });

  it("puts the section chosen in the address, to be copied", () => {
    window.history.replaceState(null, "", "/user-guide");
    render(<UserGuideContent linked />);
    fireEvent.click(screen.getAllByRole("button", { name: "Job Ad Import" })[0]);
    expect(window.location.hash).toBe("#job-ads");
    expect(screen.getByRole("link", { name: /full job ad import guide/ })).toHaveAttribute("href", "/user-guide/job-ads");
  });

  it("leaves the address alone in the in-app dialog", () => {
    window.history.replaceState(null, "", "/");
    render(<UserGuideContent />);
    fireEvent.click(screen.getAllByRole("button", { name: "Job Ad Import" })[0]);
    expect(window.location.hash).toBe("");
  });
});
