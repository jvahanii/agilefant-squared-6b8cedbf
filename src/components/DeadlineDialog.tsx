import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppStore } from "@/store/appStore";
import { fromIsoDate, parseDeadlineInput, toIsoDate } from "@/lib/deadlineFormat";

interface DeadlineDialogProps {
  /** One item, or every item of a multi-selection: all get the same date. */
  workItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Set, change or remove a work item's deadline.
 *
 * The date is written YYYY-MM-DD, as it is stored and as it reads the same in
 * every country. This was the browser's own date input, which shows whatever
 * the reader's locale says — 12/31/2027 — and no page can change that. A
 * calendar is a click away for anyone who would rather pick than type.
 */
export function DeadlineDialog({ workItemIds, open, onOpenChange }: DeadlineDialogProps) {
  const first = useAppStore((s) => s.workItems[workItemIds[0]]);
  const [value, setValue] = useState(first?.deadline ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const due = parseDeadlineInput(value);
  const invalid = value.trim() !== "" && !due;
  const many = workItemIds.length > 1;

  const apply = (deadline: string | undefined) => {
    const { setWorkItemDeadline, runBulk } = useAppStore.getState();
    // One undo step for the whole selection, as a bulk status change is.
    runBulk(() => workItemIds.forEach((id) => setWorkItemDeadline(id, deadline)));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            {many ? `Deadline for ${workItemIds.length} items` : "Deadline"}
          </DialogTitle>
        </DialogHeader>
        {!many && first && <p className="text-sm text-muted-foreground break-words">{first.title}</p>}
        <div className="space-y-1">
          <Label htmlFor="deadline-date" className="text-xs">
            Due on
          </Label>
          <div className="flex gap-2">
            <Input
              id="deadline-date"
              value={value}
              placeholder="YYYY-MM-DD"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={invalid}
              aria-describedby={invalid ? "deadline-date-error" : undefined}
              onChange={(e) => setValue(e.target.value)}
              // "2026-9-30" and "20260930" are tidied to the stored form once
              // they read as a real date.
              onBlur={() => due && setValue(due)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && due) apply(due);
              }}
              className="font-mono tabular-nums"
              autoFocus
            />
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="Pick from a calendar">
                  <CalendarDays className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  weekStartsOn={1}
                  selected={due ? fromIsoDate(due) : undefined}
                  defaultMonth={due ? fromIsoDate(due) : undefined}
                  onSelect={(d) => {
                    if (d) setValue(toIsoDate(d));
                    setPickerOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          {invalid && (
            <p id="deadline-date-error" className="text-xs text-destructive">
              Write it as YYYY-MM-DD, for example 2026-09-30.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={!first?.deadline && !many} onClick={() => apply(undefined)}>
            Remove deadline
          </Button>
          <Button disabled={!due} onClick={() => apply(due)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
