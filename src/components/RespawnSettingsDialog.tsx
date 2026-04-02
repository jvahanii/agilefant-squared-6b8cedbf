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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface RespawnSettingsDialogProps {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function pad(n: number) {
  return String(n).padStart(2, "0");
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
  const [hour, setHour] = useState<string>("9");

  // Sync local state when dialog opens
  useEffect(() => {
    if (open && item) {
      setEnabled(item.respawnEnabled ?? false);
      setIntervalDays(String(item.respawnIntervalDays ?? 7));
      setHour(String(item.respawnHour ?? 9));
    }
  }, [open, item]);

  if (!item) return null;

  const handleSave = () => {
    const days = parseInt(intervalDays, 10);
    const h = parseInt(hour, 10);
    if (enabled && (isNaN(days) || days < 1)) return;
    const validHour = !isNaN(h) && h >= 0 && h <= 23 ? h : 9;
    setWorkItemRespawn(workItemId, enabled, enabled ? days : undefined, enabled ? validHour : undefined);
    onOpenChange(false);
  };

  const intervalError = enabled && (isNaN(parseInt(intervalDays, 10)) || parseInt(intervalDays, 10) < 1);

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
            Enable respawn
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
              <Label className="text-sm font-medium">Time of day</Label>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select hour" />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {pad(h)}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 mt-6">
          <Button variant="outline" size="sm" onClick={() => { respawnItem(workItemId); onOpenChange(false); }}>
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
