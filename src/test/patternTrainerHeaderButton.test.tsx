/**
 * "Talentloom IQ" in the app header: a link to the static trainer page, shown
 * only while the active organization is the one called agilefant.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PatternTrainerHeaderButton, PATTERN_TRAINER_URL } from "@/components/PatternTrainerHeaderButton";
import { useOrgStore, type Membership } from "@/store/orgStore";

const membership = (id: string, name: string, slug: string): Membership => ({
  organization_id: id,
  organization_name: name,
  organization_slug: slug,
  role: "member",
});

beforeEach(() => {
  useOrgStore.setState({
    memberships: [membership("af", "Agilefant", "agilefant"), membership("other", "Acme", "acme")],
    activeOrgId: "af",
  });
});

describe("the Talentloom IQ button in the header", () => {
  it("opens the trainer in its own tab for the agilefant organization", () => {
    render(<PatternTrainerHeaderButton />);
    const link = screen.getByRole("link", { name: /talentloom iq/i });
    expect(link).toHaveAttribute("href", PATTERN_TRAINER_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("recognises the organization by its name when the slug differs", () => {
    useOrgStore.setState({ memberships: [membership("af", " AgileFant ", "af-2")], activeOrgId: "af" });
    render(<PatternTrainerHeaderButton />);
    expect(screen.getByRole("link", { name: /talentloom iq/i })).toBeInTheDocument();
  });

  it("is not there for any other organization", () => {
    useOrgStore.setState({ activeOrgId: "other" });
    const { container } = render(<PatternTrainerHeaderButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is not there while no organization is active", () => {
    useOrgStore.setState({ activeOrgId: null });
    const { container } = render(<PatternTrainerHeaderButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
