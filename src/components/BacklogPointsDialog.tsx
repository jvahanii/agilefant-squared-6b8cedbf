import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore } from "@/store/appStore";
import { backlogPoints } from "@/lib/backlogPoints";

interface BacklogPointsDialogProps {
  backlogId: string;
  treeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Set, change or remove a backlog's own points — an estimate for the whole of
 * it before its work is broken into items. The backlog then counts as the larger
 * of this and its contents, which the dialog shows so the two can be compared.
 */
export function BacklogPointsDialog({ backlogId, treeId, open, onOpenChange }: BacklogPointsDialogProps) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const { contents } = useMemo(
    () => backlogPoints(backlogId, treeId, workItems, backlogs),
    [backlogId, treeId, workItems, backlogs],
  );
  const [value, setValue] = useState(backlog?.points != null ? String(backlog.points) : "");
  const trimmed = value.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const invalid = trimmed !== "" && parsed === undefined;

  const apply = (points: number | undefined) => {
    useAppStore.getState().setBacklogPoints(backlogId, points);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Points</DialogTitle>
        </DialogHeader>
        {backlog && <p className="text-sm text-muted-foreground break-words">{backlog.name}</p>}
        <div className="space-y-1">
          <Label htmlFor="backlog-points" className="text-xs">
            Estimate for the whole backlog
          </Label>
          <Input
            id="backlog-points"
            value={value}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 40"
            aria-invalid={invalid}
            aria-describedby="backlog-points-help"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && parsed !== undefined) apply(parsed);
            }}
            className="tabular-nums"
            autoFocus
          />
          <p id="backlog-points-help" className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
            {invalid
              ? "A whole number of zero or more."
              : `Its contents add up to ${contents} pt${contents === 1 ? "" : "s"}. The backlog counts as the larger of the two.`}
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={backlog?.points == null} onClick={() => apply(undefined)}>
            Remove estimate
          </Button>
          <Button disabled={parsed === undefined} onClick={() => apply(parsed)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
