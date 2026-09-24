/**
 * The logged-time report, and the state it opens in.
 *
 * It answered "who spent time on what" all along, but opened on every entry
 * ever logged, one per row, grouped by date — and lived only in Settings. What
 * is pinned here is the opening state, the period buttons, and that any total
 * can be followed down to the entries that make it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

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
import { DEFAULT_GROUP_DIMS, activePreset, presetRange } from "@/lib/timesheetDefaults";
import { useTimeEntryStore, type TimeEntry } from "@/store/timeEntryStore";
import { useAppStore } from "@/store/appStore";

const today = presetRange("today").from;

const entry = (
  id: string,
  userId: string,
  workItemId: string,
  minutes: number,
  spentDate = today,
  note: string | null = null,
): TimeEntry => ({
  id,
  organizationId: "org-1",
  userId,
  workItemId,
  backlogId: "org-1::bl-1",
  treeId: "org-1::bt-1",
  durationMinutes: minutes,
  spentDate,
  note,
  createdAt: `${spentDate}T09:00:00Z`,
});

const seed = (entries: TimeEntry[]) => {
  useTimeEntryStore.setState({ timeEntries: Object.fromEntries(entries.map((e) => [e.id, e])) });
  useAppStore.setState({
    workItems: {
      "org-1::wi-a": { id: "org-1::wi-a", title: "Checkout", status: "in_progress", parentId: null, childrenIds: [], backlogAssignments: { "org-1::bt-1": "org-1::bl-1" }, ranks: {} },
      "org-1::wi-b": { id: "org-1::wi-b", title: "Search", status: "in_progress", parentId: null, childrenIds: [], backlogAssignments: { "org-1::bt-1": "org-1::bl-1" }, ranks: {} },
    },
    backlogs: { "org-1::bl-1": { id: "org-1::bl-1", name: "Sprint", parentId: null, childrenIds: [], treeId: "org-1::bt-1", rank: 0 } },
    backlogTrees: { "org-1::bt-1": { id: "org-1::bt-1", name: "Product", rootBacklogIds: ["org-1::bl-1"], rank: 0 } },
  });
};

const open = () => render(<TimesheetBrowserDialog open onOpenChange={vi.fn()} orgName="Acme" />);
const periodButton = (name: string) => within(screen.getByRole("group", { name: "Period" })).getByRole("button", { name });

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

  it("takes yesterday across the turn of a month and of a year", () => {
    expect(presetRange("yesterday", new Date(2026, 8, 25))).toEqual({ from: "2026-09-24", to: "2026-09-24" });
    expect(presetRange("yesterday", new Date(2026, 9, 1))).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(presetRange("yesterday", new Date(2027, 0, 1))).toEqual({ from: "2026-12-31", to: "2026-12-31" });
  });

  it("leaves both dates empty for all time", () => {
    expect(presetRange("all")).toEqual({ from: "", to: "" });
  });
});

describe("activePreset", () => {
  const now = new Date(2026, 8, 24);

  it("names the preset the dates are", () => {
    expect(activePreset("2026-09-24", "2026-09-24", now)).toBe("today");
    expect(activePreset("2026-09-23", "2026-09-23", now)).toBe("yesterday");
    expect(activePreset("2026-09-21", "2026-09-27", now)).toBe("week");
    expect(activePreset("2026-09-01", "2026-09-30", now)).toBe("month");
    expect(activePreset("", "", now)).toBe("all");
  });

  it("names none for a range that is no preset", () => {
    expect(activePreset("2026-09-02", "2026-09-10", now)).toBeNull();
    expect(activePreset("2026-09-24", "", now)).toBeNull();
  });
});

describe("TimesheetBrowserDialog, as it opens", () => {
  it("opens on the summary, today", () => {
    seed([entry("t1", "u-ann", "org-1::wi-a", 60)]);
    open();
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveAttribute("data-state", "active");
    expect(screen.getByLabelText("From")).toHaveValue(today);
    expect(screen.getByLabelText("To")).toHaveValue(today);
  });

  it("groups from each person down to the work item, even when there is only one person", () => {
    expect(DEFAULT_GROUP_DIMS).toEqual(["user", "tree", "backlog", "item"]);
    seed([entry("t1", "u-ann", "org-1::wi-a", 60)]);
    open();
    expect(screen.getByRole("columnheader", { name: "Person › Tree › Backlog › Work Item" })).toBeInTheDocument();
  });

  it("names every person in a team", async () => {
    seed([entry("t1", "u-ann", "org-1::wi-a", 60), entry("t2", "u-bo", "org-1::wi-b", 30)]);
    open();
    const table = screen.getByRole("table");
    // The names arrive from profiles after the dialog opens.
    expect(await within(table).findByText("Ann")).toBeInTheDocument();
    expect(within(table).getByText("Bo")).toBeInTheDocument();
  });

  it("leaves out what was logged before today until asked", () => {
    seed([entry("t1", "u-ann", "org-1::wi-a", 60), entry("t2", "u-ann", "org-1::wi-b", 45, "2020-01-15")]);
    open();
    expect(screen.getByText(/1 entry/)).toBeInTheDocument();
  });
});

describe("the period buttons", () => {
  it("show which period is selected, and follow a click", () => {
    open();
    expect(periodButton("Today")).toHaveAttribute("aria-pressed", "true");
    expect(periodButton("Yesterday")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(periodButton("Yesterday"));
    expect(periodButton("Yesterday")).toHaveAttribute("aria-pressed", "true");
    expect(periodButton("Today")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("From")).toHaveValue(presetRange("yesterday").from);
  });

  it("show none for a range typed by hand that is no preset", () => {
    open();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2020-01-01" } });
    for (const name of ["Today", "Yesterday", "This week", "This month", "All time"]) {
      expect(periodButton(name)).toHaveAttribute("aria-pressed", "false");
    }
  });
});

describe("following a total to what made it", () => {
  it("opens the last level onto the entries themselves, with their notes", async () => {
    seed([
      entry("t1", "u-ann", "org-1::wi-a", 45, today, "paulan vienti"),
      entry("t2", "u-ann", "org-1::wi-a", 30, today),
    ]);
    open();
    const table = screen.getByRole("table");
    // Person is open already; follow Tree › Backlog › Work Item down.
    fireEvent.click(await within(table).findByText("Product"));
    fireEvent.click(within(table).getByText("Sprint"));
    fireEvent.click(within(table).getByText("Checkout"));

    expect(within(table).getByText("paulan vienti")).toBeInTheDocument();
    expect(within(table).getByText("no note")).toBeInTheDocument();
    expect(within(table).getByText("45m")).toBeInTheDocument();
    expect(within(table).getByText("30m")).toBeInTheDocument();
  });
});
