import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

import { WorkItemDescriptionDialog } from "@/components/WorkItemDescriptionDialog";
import { useAppStore } from "@/store/appStore";
import { upsertWorkItem } from "@/store/supabaseSync";

const ID = "org::wi-description";
beforeEach(() => {
  vi.mocked(upsertWorkItem).mockClear();
  useAppStore.setState({
    organizationId: "org",
    workItems: { [ID]: { id: ID, title: "Description test", description: "Written in Jira\n\nSecond paragraph", status: "not_started", parentId: null, childrenIds: [], backlogAssignments: {}, ranks: {} } },
    undoStack: [], redoStack: [],
  });
});

describe("item description", () => {
  it("edits the Jira-imported description and sends the new value to persistence", () => {
    render(<WorkItemDescriptionDialog workItemId={ID} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Written in Jira\n\nSecond paragraph");
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Edited in Agilefant\n\nDetails" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useAppStore.getState().workItems[ID].description).toBe("Edited in Agilefant\n\nDetails");
    expect(upsertWorkItem).toHaveBeenCalledWith(expect.objectContaining({ id: ID, description: "Edited in Agilefant\n\nDetails" }), "org");
    expect(useAppStore.getState().undoStack).toHaveLength(1);
  });

  it("does not persist a cancelled edit", () => {
    render(<WorkItemDescriptionDialog workItemId={ID} open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Discard this" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useAppStore.getState().workItems[ID].description).toBe("Written in Jira\n\nSecond paragraph");
    expect(upsertWorkItem).not.toHaveBeenCalled();
  });

  it("clears the persisted description when emptied", () => {
    useAppStore.getState().setWorkItemDescription(ID, "");
    expect(useAppStore.getState().workItems[ID].description).toBeUndefined();
    expect(upsertWorkItem).toHaveBeenCalledWith(expect.objectContaining({ description: undefined }), "org");
  });

  it("uses the item's owning organization when editing a shared item", () => {
    useAppStore.setState((s) => ({ workItems: { ...s.workItems, [ID]: { ...s.workItems[ID], organizationId: "partner" } } }));
    useAppStore.getState().setWorkItemDescription(ID, "Shared details");
    expect(upsertWorkItem).toHaveBeenCalledWith(expect.objectContaining({ description: "Shared details" }), "partner");
  });
});