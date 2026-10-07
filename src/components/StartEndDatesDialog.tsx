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
import { endsBeforeItStarts } from "@/lib/workItemStartEnd";

interface StartEndDatesDialogProps {
  /** One item, or every item of a multi-selection. */
  workItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Set, change or remove the days work on an item started and ended.
 *
 * Two fields of the same kind as the deadline's — written YYYY-MM-DD, with a
 * calendar a click away — so every date on an item is set the same way. Either
 * may be left empty: work that has started has no end yet. Emptying a field
 * removes that date.
 *
 * For a multi-selection only the fields actually edited are applied, so giving
 * twenty items an end date does not wipe their twenty different start dates.
 */
export function StartEndDatesDialog({ workItemIds, open, onOpenChange }: StartEndDatesDialogProps) {
  const first = useAppStore((s) => s.workItems[workItemIds[0]]);
  const many = workItemIds.length > 1;
  const [start, setStart] = useState(first?.startedOn ?? "");
  const [end, setEnd] = useState(first?.endedOn ?? "");
  const [touched, setTouched] = useState({ start: false, end: false });

  const startDay = parseDeadlineInput(start);
  const endDay = parseDeadlineInput(end);
  const startInvalid = start.trim() !== "" && !startDay;
  const endInvalid = end.trim() !== "" && !endDay;
  const backwards = endsBeforeItStarts(startDay, endDay);
  const canSave = !startInvalid && !endInvalid && !backwards && (!many || touched.start || touched.end);

  const save = () => {
    if (!canSave) return;
    const { setWorkItemStartEnd, runBulk } = useAppStore.getState();
    const change = {
      ...(!many || touched.start ? { startedOn: startDay ?? null } : {}),
      ...(!many || touched.end ? { endedOn: endDay ?? null } : {}),
    };
    // One undo step for the whole selection, as a bulk status change is.
    runBulk(() => workItemIds.forEach((id) => setWorkItemStartEnd(id, change)));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            {many ? `Start and end dates for ${workItemIds.length} items` : "Start and end dates"}
          </DialogTitle>
        </DialogHeader>
        {!many && first && <p className="text-sm text-muted-foreground break-words">{first.title}</p>}
        {many && (
          <p className="text-xs text-muted-foreground">
            Only the date you change here is applied; the other is left as each item has it.
          </p>
        )}
        <DateField
          id="started-on"
          label="Started on"
          value={start}
          day={startDay}
          invalid={startInvalid}
          autoFocus
          onChange={(value) => {
            setStart(value);
            setTouched((t) => ({ ...t, start: true }));
          }}
          onEnter={save}
        />
        <DateField
          id="ended-on"
          label="Ended on"
          value={end}
          day={endDay}
          invalid={endInvalid}
          onChange={(value) => {
            setEnd(value);
            setTouched((t) => ({ ...t, end: true }));
          }}
          onEnter={save}
        />
        {backwards && (
          <p className="text-xs text-destructive" role="alert">
            The end date is before the start date.
          </p>
        )}
        <DialogFooter>
          <Button disabled={!canSave} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateField({
  id,
  label,
  value,
  day,
  invalid,
  autoFocus,
  onChange,
  onEnter,
}: {
  id: string;
  label: string;
  value: string;
  /** The value as a real date, when it reads as one. */
  day: string | undefined;
  invalid: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          placeholder="YYYY-MM-DD — empty for none"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
          // "2026-9-30" and "20260930" are tidied to the stored form once
          // they read as a real date.
          onBlur={() => day && day !== value && onChange(day)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEnter();
          }}
          className="font-mono tabular-nums"
          autoFocus={autoFocus}
        />
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label={`Pick ${label.toLowerCase()} from a calendar`}>
              <CalendarDays className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              weekStartsOn={1}
              selected={day ? fromIsoDate(day) : undefined}
              defaultMonth={day ? fromIsoDate(day) : undefined}
              onSelect={(d) => {
                if (d) onChange(toIsoDate(d));
                setPickerOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      {invalid && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          Write it as YYYY-MM-DD, for example 2026-09-30. Dots work too, and the year can be left out: 30.9.
        </p>
      )}
    </div>
  );
}
