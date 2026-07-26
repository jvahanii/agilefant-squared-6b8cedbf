import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/appStore";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface RespawnSettingsDialogProps {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function computeNextRespawn(
  enabled: boolean,
  intervalDays: number,
  hour: number,
  minute: number,
  lastTriggeredAt: string | undefined,
): Date | null {
  if (!enabled || isNaN(intervalDays) || intervalDays < 1 || isNaN(hour) || hour < 0 || hour > 23) return null;
  const safeMinute = isNaN(minute) || minute < 0 || minute > 59 ? 0 : minute;

  const now = new Date();

  if (lastTriggeredAt) {
    const baseNextDue = new Date(
      new Date(lastTriggeredAt).getTime() + intervalDays * 24 * 60 * 60 * 1000,
    );
    const nextDue = new Date(baseNextDue);
    nextDue.setHours(hour, safeMinute, 0, 0);
    if (nextDue < baseNextDue) {
      nextDue.setDate(nextDue.getDate() + 1);
    }
    return nextDue;
  } else {
    // First trigger: today at respawn time if we haven't passed it yet, otherwise tomorrow.
    const candidate = new Date(now);
    candidate.setHours(hour, safeMinute, 0, 0);
    if (candidate <= now) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }
}

function formatNextRespawn(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RespawnSettingsDialog({
  workItemId,
  open,
  onOpenChange,
}: RespawnSettingsDialogProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const setWorkItemRespawn = useAppStore((s) => s.setWorkItemRespawn);
  const respawnItem = useAppStore((s) => s.respawnItem);

  const [enabled, setEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState<string>("7");
  const [timeValue, setTimeValue] = useState<string>("09:00");

  // Sync local state when dialog opens
  useEffect(() => {
    if (open && item) {
      setEnabled(item.respawnEnabled ?? false);
      setIntervalDays(String(item.respawnIntervalDays ?? 7));
      const h = item.respawnHour ?? 9;
      const m = item.respawnMinute ?? 0;
      setTimeValue(`${pad(h)}:${pad(m)}`);
    }
  }, [open, item]);

  if (!item) return null;

  const parsedIntervalDays = parseInt(intervalDays, 10);
  const [parsedHour, parsedMinute] = timeValue.split(":").map(Number);
  const intervalError = enabled && (isNaN(parsedIntervalDays) || parsedIntervalDays < 1);

  const handleSave = () => {
    if (enabled && (isNaN(parsedIntervalDays) || parsedIntervalDays < 1)) return;
    const validHour = !isNaN(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 9;
    const validMinute = !isNaN(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59 ? parsedMinute : 0;
    setWorkItemRespawn(workItemId, enabled, enabled ? parsedIntervalDays : undefined, enabled ? validHour : undefined, enabled ? validMinute : undefined);
    onOpenChange(false);
  };

  const nextRespawn = computeNextRespawn(
    enabled,
    parsedIntervalDays,
    parsedHour,
    parsedMinute,
    item.respawnLastTriggeredAt,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Respawn settings</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-4 truncate" title={item.title}>
          {item.title}
        </div>

        <div className="flex items-center justify-between mb-6">
          <Label htmlFor="respawn-enabled" className="text-sm font-medium">
            Activate respawn
          </Label>
          <Switch
            id="respawn-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {enabled && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="respawn-interval" className="text-sm font-medium">
                Repeat every (days)
              </Label>
              <Input
                id="respawn-interval"
                type="number"
                min={1}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                className={`h-8${intervalError ? " border-destructive" : ""}`}
              />
              {intervalError && (
                <p className="text-xs text-destructive">Must be at least 1 day.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="respawn-time" className="text-sm font-medium">Time of day</Label>
              <Input
                id="respawn-time"
                type="time"
                value={timeValue}
                onChange={(e) => setTimeValue(e.target.value)}
                className="h-8"
              />
            </div>

            {nextRespawn && (
              <p className="text-sm text-muted-foreground">
                Next respawn: <span className="font-medium text-foreground">{formatNextRespawn(nextRespawn)}</span>
              </p>
            )}
          </div>
        )}

        <div className="flex justify-between gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={!item.respawnEnabled}
            title={!item.respawnEnabled ? "Enable and save respawn first" : undefined}
            onClick={() => { respawnItem(workItemId); onOpenChange(false); }}
          >
            Respawn now
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!!intervalError}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

