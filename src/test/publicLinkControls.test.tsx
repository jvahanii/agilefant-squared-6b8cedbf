/**
 * The public link controls' attribute choices: which are offered, and that a
 * change is saved through the RPC — the only way to write them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: () => maybeSingle(),
  };
  return { supabase: { rpc: (...args: unknown[]) => rpc(...args), from: () => query } };
});
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { PublicLinkControls } from "@/components/PublicLinkControls";

function options(hidden: string[], available: string[]) {
  return (name: string) => {
    if (name === "get_published_link_options") return Promise.resolve({ data: { hidden, available }, error: null });
    if (name === "set_published_link_hidden_attributes") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

beforeEach(() => {
  rpc.mockReset();
  maybeSingle.mockReset();
  maybeSingle.mockResolvedValue({ data: null, error: null });
});

describe("public link attribute choices", () => {
  it("offers only what the organization has on, all checked by default", async () => {
    rpc.mockImplementation(options([], ["status", "description", "teams", "links"]));
    render(<PublicLinkControls treeId="t" backlogId={null} />);

    expect(await screen.findByLabelText("Statuses")).toBeTruthy();
    for (const shown of ["Statuses", "Descriptions", "Teams", "Links"]) {
      expect(screen.getByLabelText(shown).getAttribute("data-state")).toBe("checked");
    }
    // Points, labels and time are off for this organization: not offered at all.
    for (const off of ["Points", "Labels", "Logged time"]) {
      expect(screen.queryByLabelText(off)).toBeNull();
    }
    // Nor is the time-entry privacy note, with no time to speak of.
    expect(screen.queryByText(/Individual time entries/)).toBeNull();
  });

  it("shows a stored choice, and saves a change through the RPC", async () => {
    rpc.mockImplementation(options(["description"], ["status", "description", "teams", "links", "time"]));
    render(<PublicLinkControls treeId="t" backlogId="b" />);

    const descriptions = await screen.findByLabelText("Descriptions");
    expect(descriptions.getAttribute("data-state")).toBe("unchecked");
    expect(screen.getByText(/Individual time entries/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Logged time"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("set_published_link_hidden_attributes", {
        _tree_id: "t",
        _backlog_id: "b",
        _hidden: ["description", "time"],
      }),
    );
    expect(screen.getByLabelText("Logged time").getAttribute("data-state")).toBe("unchecked");
  });

  it("rolls the checkbox back when saving fails", async () => {
    rpc.mockImplementation((name: string) =>
      name === "set_published_link_hidden_attributes"
        ? Promise.resolve({ data: null, error: { message: "nope" } })
        : options([], ["status", "description", "teams", "links"])(name),
    );
    render(<PublicLinkControls treeId="t" backlogId={null} />);

    const statuses = await screen.findByLabelText("Statuses");
    fireEvent.click(statuses);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("set_published_link_hidden_attributes", expect.anything()));
    await waitFor(() => expect(screen.getByLabelText("Statuses").getAttribute("data-state")).toBe("checked"));
  });
});
