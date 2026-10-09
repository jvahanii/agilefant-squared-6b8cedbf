/**
 * A list's labels in the heading over its items.
 *
 * A list could be given labels, but only its row in the tree showed them — as
 * dots. Open the list and its heading gave no sign of them. They are written
 * out there now, by name, the way an item's row writes its own.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LabelNames, ListHeadingLabels } from "@/components/LabelNames";
import { useLabelsStore } from "@/store/labelsStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

const ORG = "org";
const BL = "org::bl-1";

const label = (id: string, name: string, color: string) => ({ id, organizationId: ORG, name, color });
const labelsOn = (on: boolean) =>
  useOrgSettingsStore.setState({ settings: { [ORG]: { labelsEnabled: on } } } as never);

beforeEach(() => {
  useOrgStore.setState({ activeOrgId: ORG });
  labelsOn(true);
  useLabelsStore.setState({
    labels: {
      urgent: label("urgent", "Urgent", "#ff0000"),
      applied: label("applied", "Applied", "#00aa00"),
    },
    byEntity: {},
  });
});

describe("labels after a name", () => {
  it("writes one label as it is, in its colour", () => {
    render(<LabelNames labels={[label("urgent", "Urgent", "#ff0000")]} />);
    expect(screen.getByText("Urgent")).toHaveStyle({ color: "#ff0000" });
    expect(screen.queryByText(/\[/)).not.toBeInTheDocument();
  });

  it("writes several in brackets", () => {
    const { container } = render(
      <LabelNames labels={[label("applied", "Applied", "#00aa00"), label("urgent", "Urgent", "#ff0000")]} />,
    );
    expect(container.textContent).toBe("[Applied, Urgent]");
  });

  it("writes nothing for none", () => {
    const { container } = render(<LabelNames labels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a list's heading", () => {
  it("shows the list's labels by name, in name order", () => {
    useLabelsStore.setState({ byEntity: { [`backlog:${BL}`]: ["urgent", "applied"] } });
    const { container } = render(<ListHeadingLabels backlogId={BL} />);
    expect(container.textContent).toBe("[Applied, Urgent]");
    expect(screen.getByText("Applied")).toHaveStyle({ color: "#00aa00" });
  });

  it("shows nothing for a list without labels, or another list's labels", () => {
    useLabelsStore.setState({ byEntity: { "backlog:org::bl-2": ["urgent"] } });
    const { container } = render(<ListHeadingLabels backlogId={BL} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing where the organization has labels off", () => {
    labelsOn(false);
    useLabelsStore.setState({ byEntity: { [`backlog:${BL}`]: ["urgent"] } });
    const { container } = render(<ListHeadingLabels backlogId={BL} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("passes over a label that has been deleted", () => {
    useLabelsStore.setState({ byEntity: { [`backlog:${BL}`]: ["urgent", "deleted"] } });
    const { container } = render(<ListHeadingLabels backlogId={BL} />);
    expect(container.textContent).toBe("Urgent");
  });

  it("is in the heading over the list's items", () => {
    const source = readFileSync(join(process.cwd(), "src", "components", "WorkItemTreePanel.tsx"), "utf8");
    const heading = source.slice(source.indexOf("function EditableBacklogName"), source.indexOf("function InlineWorkItemInput"));
    expect(heading).toContain("<ListHeadingLabels backlogId={backlogId} />");
  });
});
