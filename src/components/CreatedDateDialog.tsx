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

interface CreatedDateDialogProps {
  /** One item, or every item of a multi-selection: all get the same date. */
  workItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Correct the day a work item was made.
 *
 * Every new item gets today's date by itself; this is for the ones that did
 * not — items older than the attribute, whose day nobody recorded — and for an
 * item entered late, whose real beginning was earlier. The same field as the
 * deadline's, written YYYY-MM-DD with a calendar a click away, so the two dates
 * are set the same way. There is no removing it: a created date can be wrong,
 * but an item cannot have been made on no day at all.
 */
export function CreatedDateDialog({ workItemIds, open, onOpenChange }: CreatedDateDialogProps) {
  const first = useAppStore((s) => s.workItems[workItemIds[0]]);
  const [value, setValue] = useState(first?.createdOn ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const made = parseDeadlineInput(value);
  const invalid = value.trim() !== "" && !made;
  const many = workItemIds.length > 1;

  const apply = (createdOn: string) => {
    const { setWorkItemCreatedOn, runBulk } = useAppStore.getState();
    // One undo step for the whole selection, as a bulk status change is.
    runBulk(() => workItemIds.forEach((id) => setWorkItemCreatedOn(id, createdOn)));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            {many ? `Created date for ${workItemIds.length} items` : "Created date"}
          </DialogTitle>
        </DialogHeader>
        {!many && first && <p className="text-sm text-muted-foreground break-words">{first.title}</p>}
        <div className="space-y-1">
          <Label htmlFor="created-date" className="text-xs">
            Created on
          </Label>
          <div className="flex gap-2">
            <Input
              id="created-date"
              value={value}
              placeholder="YYYY-MM-DD"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={invalid}
              aria-describedby={invalid ? "created-date-error" : undefined}
              onChange={(e) => setValue(e.target.value)}
              // "2026-9-30" and "20260930" are tidied to the stored form once
              // they read as a real date.
              onBlur={() => made && setValue(made)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && made) apply(made);
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
                  selected={made ? fromIsoDate(made) : undefined}
                  defaultMonth={made ? fromIsoDate(made) : undefined}
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
            <p id="created-date-error" className="text-xs text-destructive">
              Write it as YYYY-MM-DD, for example 2026-09-30. Dots work too, and the year can be left out: 30.9.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={!made} onClick={() => made && apply(made)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
