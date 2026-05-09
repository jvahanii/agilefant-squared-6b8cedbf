import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  snoozeOptionLaterToday,
  snoozeOptionTomorrowMorning,
  snoozeOptionNextWeek,
  snoozeOptionThisWeekend,
  snoozeOptionOneWeekFromNow,
  snoozeOptionNextMonth,
  snoozeOptionNextYear,
  useSnoozeStore,
} from "@/store/snoozeStore";
import { useOrgStore } from "@/store/orgStore";

interface SnoozeDialogProps {
  workItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Format a Date as "YYYY-MM-DDTHH:MM" for a datetime-local input. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

const QUICK_OPTIONS = [
  { label: "Tomorrow Morning", sublabel: "7:00 AM", fn: snoozeOptionTomorrowMorning },
  { label: "Later Today", sublabel: "3 hours from now", fn: snoozeOptionLaterToday },
  { label: "This Weekend", sublabel: "Saturday 7:00 AM", fn: snoozeOptionThisWeekend },
  { label: "Next Week", sublabel: "Monday 7:00 AM", fn: snoozeOptionNextWeek },
  { label: "One Week from Now", sublabel: "7 days, 7:00 AM", fn: snoozeOptionOneWeekFromNow },
  { label: "Next Month", sublabel: "In 1 month, 7:00 AM", fn: snoozeOptionNextMonth },
  { label: "Next Year", sublabel: "In 1 year, 7:00 AM", fn: snoozeOptionNextYear },
];

export function SnoozeDialog({ workItemIds, open, onOpenChange }: SnoozeDialogProps) {
  const snoozeWorkItem = useSnoozeStore((s) => s.snoozeWorkItem);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);

  const [customDatetime, setCustomDatetime] = useState(() =>
    toDatetimeLocal(snoozeOptionTomorrowMorning()),
  );
  const [isSaving, setIsSaving] = useState(false);

  const customDate = customDatetime ? new Date(customDatetime) : null;
  const customDateInvalid = !customDate || isNaN(customDate.getTime());
  const customDateInPast = !customDateInvalid && customDate <= new Date();
  const customDateError = customDateInvalid
    ? "Enter a valid date and time."
    : customDateInPast
    ? "Please pick a future date and time."
    : null;

  const doSnooze = async (until: Date) => {
    if (!activeOrgId) return;
    setIsSaving(true);
    try {
      await Promise.all(
        workItemIds.map((workItemId) =>
          snoozeWorkItem({ workItemId, organizationId: activeOrgId, snoozedUntil: until }),
        ),
      );
    } finally {
      setIsSaving(false);
    }
    onOpenChange(false);
  };

  const handleCustomSnooze = () => {
    if (!customDate || customDateInvalid || customDateInPast) return;
    doSnooze(customDate);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Snooze item</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 pt-1">
          {QUICK_OPTIONS.map((opt, index) => (
            <Button
              key={opt.label}
              variant="outline"
              className="justify-between h-auto py-2 px-3"
              onClick={() => doSnooze(opt.fn())}
              disabled={isSaving}
              autoFocus={index === 0}
            >
              <span className="font-medium text-sm">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.sublabel}</span>
            </Button>
          ))}
        </div>

        <div className="border-t pt-3 mt-1 flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground">Pick Date / Time</Label>
          <input
            type="datetime-local"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={customDatetime}
            onChange={(e) => setCustomDatetime(e.target.value)}
            min={toDatetimeLocal(new Date())}
          />
          {customDateError && (
            <p className="text-xs text-destructive">{customDateError}</p>
          )}
          <Button
            size="sm"
            onClick={handleCustomSnooze}
            disabled={isSaving || !!customDateError}
          >
            Snooze until selected time
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
