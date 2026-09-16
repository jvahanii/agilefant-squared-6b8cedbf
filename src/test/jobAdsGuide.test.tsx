/**
 * The public job ad import guide. Checked for what a reader relies on: every
 * section listed in "On this page" exists to jump to, and the warning about
 * scheduled runs re-importing postings is there — that one costs a reader
 * duplicate items if it goes missing.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import JobAdsGuide from "@/pages/JobAdsGuide";

function renderGuide() {
  return render(
    <MemoryRouter initialEntries={["/user-guide/job-ads"]}>
      <JobAdsGuide />
    </MemoryRouter>,
  );
}

describe("JobAdsGuide", () => {
  it("renders the guide with its title", () => {
    renderGuide();
    expect(screen.getByRole("heading", { level: 1, name: "Job ad import" })).toBeInTheDocument();
  });

  it("has a section for every entry in the table of contents", () => {
    const { container } = renderGuide();
    const toc = screen.getByRole("navigation", { name: "On this page" });
    const anchors = within(toc).getAllByRole("link");
    expect(anchors.length).toBeGreaterThan(5);
    for (const a of anchors) {
      const id = a.getAttribute("href")!.slice(1);
      expect(container.querySelector(`section#${id}`)).not.toBeNull();
    }
  });

  it("warns that a scheduled run imports postings again", () => {
    renderGuide();
    expect(screen.getByText(/A scheduled run imports every posting it finds/)).toBeInTheDocument();
  });

  it("lists the supported job boards", () => {
    renderGuide();
    const table = screen.getByRole("table");
    for (const board of ["LinkedIn", "Duunitori", "Jobly", "The Hub", "Työmarkkinatori", "Teamtailor"]) {
      expect(within(table).getByText(board)).toBeInTheDocument();
    }
  });
});
