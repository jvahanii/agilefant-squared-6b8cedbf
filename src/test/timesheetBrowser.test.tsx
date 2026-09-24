/**
 * The logged-time report, and the state it opens in.
 *
 * It answered "who spent time on what" all along, but opened on every entry
 * ever logged, one per row, grouped by date — and lived only in Settings. What
 * is pinned here is the opening state, since that is what makes it answer the
 * question without being rearranged first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [
              { id: "u-ann", email: "ann@example.com", full_name: "Ann" },
              { id: "u-bo", email: "bo@example.com", full_name: "Bo" },
            ],
          }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u-ann" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { TimesheetBrowserDialog } from "@/components/TimesheetBrowserDialog";
import { defaultGroupDims, presetRange } from "@/lib/timesheetDefaults";
import { useTimeEntryStore, type TimeEntry } from "@/store/timeEntryStore";
import { useAppStore } from "@/store/appStore";

const month = presetRange("month");

const entry = (id: string, userId: string, workItemId: string, minutes: number, spentDate = month.from): TimeEntry => ({
  id,
  organizationId: "org-1",
  userId,
  workItemId,
  backlogId: "org-1::bl-1",
  treeId: "org-1::bt-1",
  durationMinutes: minutes,
  spentDate,
  note: null,
  createdAt: `${spentDate}T09:00:00Z`,
});

const seed = (entries: TimeEntry[]) => {
  useTimeEntryStore.setState({ timeEntries: Object.fromEntries(entries.map((e) => [e.id, e])) });
  useAppStore.setState({
    workItems: {
      "org-1::wi-a": { id: "org-1::wi-a", title: "Checkout", status: "in_progress", parentId: null, childrenIds: [], backlogAssignments: {}, ranks: {} },
      "org-1::wi-b": { id: "org-1::wi-b", title: "Search", status: "in_progress", parentId: null, childrenIds: [], backlogAssignments: {}, ranks: {} },
    },
    backlogs: { "org-1::bl-1": { id: "org-1::bl-1", name: "Sprint", parentId: null, childrenIds: [], treeId: "org-1::bt-1", rank: 0 } },
    backlogTrees: { "org-1::bt-1": { id: "org-1::bt-1", name: "Product", rootBacklogIds: ["org-1::bl-1"], rank: 0 } },
  });
};

const open = () =>
  render(<TimesheetBrowserDialog open onOpenChange={vi.fn()} orgName="Acme" />);

beforeEach(() => seed([]));

describe("presetRange", () => {
  it("runs a month from its first day to its last, leap years included", () => {
    expect(presetRange("month", new Date(2026, 8, 24))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("month", new Date(2028, 1, 10))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("runs a week from Monday to Sunday, even when today is Sunday", () => {
    // 27 September 2026 is a Sunday; its week began on the 21st.
    expect(presetRange("week", new Date(2026, 8, 27))).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("leaves both dates empty for all time", () => {
    expect(presetRange("all")).toEqual({ from: "", to: "" });
  });
});

describe("defaultGroupDims", () => {
  it("groups by person first once more than one person has logged time", () => {
    expect(defaultGroupDims(2)).toEqual(["user", "item"]);
  });

  it("leaves the person out when there is only one", () => {
    expect(defaultGroupDims(1)).toEqual(["item"]);
    expect(defaultGroupDims(0)).toEqual(["item"]);
  });
});

describe("TimesheetBrowserDialog, as it opens", () => {
  it("opens on the summary, this month", () => {
    seed([entry("t1", "u-ann", "org-1::wi-a", 60)]);
    open();
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("data-state", "active");
    expect(screen.getByLabelText("From")).toHaveValue(month.from);
    expect(screen.getByLabelText("To")).toHaveValue(month.to);
  });

  it("groups a team's time by person, then work item", async () => {
    seed([
      entry("t1", "u-ann", "org-1::wi-a", 60),
      entry("t2", "u-bo", "org-1::wi-b", 30),
    ]);
    open();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Person › Work Item" })).toBeInTheDocument();
    // The names arrive from profiles after the dialog opens.
    expect(await within(table).findByText("Ann")).toBeInTheDocument();
    expect(within(table).getByText("Bo")).toBeInTheDocument();
  });

  it("groups one person's time by work item alone", () => {
    seed([
      entry("t1", "u-ann", "org-1::wi-a", 60),
      entry("t2", "u-ann", "org-1::wi-b", 30),
    ]);
    open();
    expect(screen.getByRole("columnheader", { name: "Work Item" })).toBeInTheDocument();
  });

  it("leaves out what was logged before this month until asked", () => {
    seed([
      entry("t1", "u-ann", "org-1::wi-a", 60),
      entry("t2", "u-ann", "org-1::wi-b", 45, "2020-01-15"),
    ]);
    open();
    expect(screen.getByText(/1 entry/)).toBeInTheDocument();
  });
});
