/**
 * Logging time on an item: what the field says it read, and that one entry
 * goes in once.
 *
 * Two slips reached the database the same minute: "45" stored as 45 hours, and
 * a 45-minute entry saved twice, a second apart, because Enter and the Save
 * button could both add while the first save was still on its way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [] }) }) }) },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u-ann" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { TimeLogDialog } from "@/components/TimeLogDialog";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";

// jsdom has no scrollIntoView, and the dialog scrolls its add form into view on
// a timer once it opens. Whether that timer fired inside a test or after it was
// a matter of machine speed: locally it never did, on CI it failed the run.
Element.prototype.scrollIntoView = vi.fn();

const ITEM = "org-1::wi-a";
let addTimeEntry: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // A save that takes a moment, as a real one over the network does.
  addTimeEntry = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  useTimeEntryStore.setState({ timeEntries: {}, addTimeEntry } as never);
  useOrgStore.setState({ activeOrgId: "org-1" });
  useAppStore.setState({
    workItems: {
      [ITEM]: { id: ITEM, title: "Checkout", status: "in_progress", parentId: null, childrenIds: [], backlogAssignments: {}, ranks: {} },
    },
  });
});

const openDialog = () => {
  render(<TimeLogDialog workItemId={ITEM} open onOpenChange={vi.fn()} />);
  return screen.getByPlaceholderText('e.g. "45", "1.5" or "1h 30m"');
};

describe("the duration field", () => {
  it("says how it read the input before anything is saved", () => {
    const field = openDialog();
    fireEvent.change(field, { target: { value: "45" } });
    expect(screen.getByText("= 45m")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "1,5" } });
    expect(screen.getByText("= 1h 30m")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "lunch" } });
    expect(screen.getByText(/Not a duration/)).toBeInTheDocument();
  });

  it("saves a bare 45 as 45 minutes", async () => {
    const field = openDialog();
    fireEvent.change(field, { target: { value: "45" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(addTimeEntry).toHaveBeenCalledTimes(1));
    expect(addTimeEntry.mock.calls[0][0]).toMatchObject({ durationMinutes: 45, workItemId: ITEM });
  });
});

describe("saving", () => {
  it("adds one entry however quickly Enter and Save follow each other", async () => {
    const field = openDialog();
    fireEvent.change(field, { target: { value: "45" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /Log Time/ }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(addTimeEntry).toHaveBeenCalledTimes(1);
  });

  it("dates a new entry by the local calendar, not UTC's", () => {
    // 01:30 on 25 September in Helsinki is still the 24th in UTC. Pinned, both
    // the zone and the clock: on a machine running on UTC, as CI's does, the
    // two calendars never disagree and the check would pass with or without
    // the fix.
    const zone = process.env.TZ;
    process.env.TZ = "Europe/Helsinki";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T22:30:00Z"));
    try {
      openDialog();
      expect(screen.getByDisplayValue("2026-09-25")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      process.env.TZ = zone;
    }
  });
});
