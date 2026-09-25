/**
 * The deadline dialog writes dates as YYYY-MM-DD. It used the browser's own
 * date input, which shows the reader's locale — 12/31/2027 — and cannot be
 * made to show anything else.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

import { DeadlineDialog } from "@/components/DeadlineDialog";
import { parseDeadlineInput } from "@/lib/deadlineFormat";
import { useAppStore } from "@/store/appStore";

const ID = "org::wi-1";

beforeEach(() => {
  useAppStore.setState({
    organizationId: "org",
    workItems: {
      [ID]: { id: ID, title: "Academic Work — Backend Developer", status: "not_started", parentId: null, childrenIds: [], backlogAssignments: {}, ranks: {}, deadline: "2026-09-30" },
    },
    undoStack: [],
    redoStack: [],
  });
});

describe("parseDeadlineInput", () => {
  it("takes YYYY-MM-DD, and the quick forms of it", () => {
    expect(parseDeadlineInput("2026-09-30")).toBe("2026-09-30");
    expect(parseDeadlineInput("2026-9-30")).toBe("2026-09-30");
    expect(parseDeadlineInput(" 20260930 ")).toBe("2026-09-30");
  });

  it("refuses other orders and dates that do not exist", () => {
    expect(parseDeadlineInput("30.9.2026")).toBeUndefined();
    expect(parseDeadlineInput("12/31/2027")).toBeUndefined();
    expect(parseDeadlineInput("2026-02-31")).toBeUndefined();
    expect(parseDeadlineInput("2027031")).toBeUndefined();
  });
});

describe("DeadlineDialog", () => {
  const open = () => render(<DeadlineDialog workItemIds={[ID]} open onOpenChange={vi.fn()} />);

  it("shows the deadline as YYYY-MM-DD", () => {
    open();
    expect(screen.getByLabelText("Due on")).toHaveValue("2026-09-30");
    expect(screen.getByLabelText("Due on")).toHaveAttribute("placeholder", "YYYY-MM-DD");
  });

  it("saves a date typed quickly, in the stored form", () => {
    open();
    fireEvent.change(screen.getByLabelText("Due on"), { target: { value: "20261015" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useAppStore.getState().workItems[ID].deadline).toBe("2026-10-15");
  });

  it("says how to write it, and will not save, when it is not a date", () => {
    open();
    fireEvent.change(screen.getByLabelText("Due on"), { target: { value: "12/31/2027" } });
    expect(screen.getByText(/Write it as YYYY-MM-DD/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers a calendar for anyone who would rather pick", () => {
    open();
    expect(screen.getByRole("button", { name: "Pick from a calendar" })).toBeInTheDocument();
  });
});
