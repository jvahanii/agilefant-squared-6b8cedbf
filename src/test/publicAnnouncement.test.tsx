/**
 * The notice above every public link. What matters is that its link is a real
 * one a visitor can follow, and that it goes away by itself once the event it
 * announces is over — nobody should have to remember to take it down.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CURRENT_ANNOUNCEMENT, PublicAnnouncement } from "@/components/PublicAnnouncement";

const BEFORE = Date.parse("2026-09-16T12:00:00+03:00");
const EVENING_OF = Date.parse("2026-09-22T21:30:00+03:00");
const DAY_AFTER = Date.parse("2026-09-23T09:00:00+03:00");

describe("PublicAnnouncement", () => {
  it("shows the meetup, with its sign-up link as a real link to a new tab", () => {
    render(<PublicAnnouncement now={BEFORE} />);

    expect(screen.getByRole("complementary", { name: "Announcement" })).toBeInTheDocument();
    expect(screen.getByText(/Helsinki LeSS meetup is back/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://lnkd.in/dTtRQVSV" });
    expect(link).toHaveAttribute("href", "https://lnkd.in/dTtRQVSV");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("is still up on the evening itself", () => {
    render(<PublicAnnouncement now={EVENING_OF} />);
    expect(screen.getByRole("complementary", { name: "Announcement" })).toBeInTheDocument();
  });

  it("takes itself down once the day is over", () => {
    const { container } = render(<PublicAnnouncement now={DAY_AFTER} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is nothing to announce", () => {
    const { container } = render(<PublicAnnouncement announcement={null} now={BEFORE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not take a sentence's full stop into the link", () => {
    render(
      <PublicAnnouncement
        now={BEFORE}
        announcement={{ ...CURRENT_ANNOUNCEMENT!, paragraphs: ["Sign up at https://example.com/join."] }}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/join");
  });
});
