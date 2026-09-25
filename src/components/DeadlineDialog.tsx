import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/store/appStore";
import { wellFormedDeadline } from "@/lib/deadlineFormat";

interface DeadlineDialogProps {
  /** One item, or every item of a multi-selection: all get the same date. */
  workItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Set, change or remove a work item's deadline.
 *
 * Starts from the first item's deadline, so changing one date is a small edit
 * rather than retyping it. A date field the browser can check beats parsing
 * free text: "30.9." would be read differently in different countries.
 */
export function DeadlineDialog({ workItemIds, open, onOpenChange }: DeadlineDialogProps) {
  const first = useAppStore((s) => s.workItems[workItemIds[0]]);
  const [value, setValue] = useState(first?.deadline ?? "");
  const due = wellFormedDeadline(value);
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
          <Input
            id="deadline-date"
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && due) apply(due);
            }}
            autoFocus
          />
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
