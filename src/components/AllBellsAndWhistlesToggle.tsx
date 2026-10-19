import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { BELLS_AND_WHISTLES, useOrgSettingsStore, type BellOrWhistle } from "@/store/orgSettingsStore";

/**
 * One switch for every feature on the Bells & Whistles page.
 *
 * It reads "on" only when every one of them is on: a switch that claimed
 * "on" with half of them off would be saying something untrue. Either way it
 * asks first, naming exactly what will change, because one press here
 * changes how the whole organization's app looks.
 *
 * Only owners and admins may press it, as several of the switches it moves
 * are theirs alone.
 */
export function AllBellsAndWhistlesToggle({ orgId, canManage }: { orgId: string | null; canManage: boolean }) {
  const settings = useOrgSettingsStore((s) => (orgId ? s.settings[orgId] : undefined));
  const setAll = useOrgSettingsStore((s) => s.setAllBellsAndWhistles);
  const [asking, setAsking] = useState<null | boolean>(null);
  const [saving, setSaving] = useState(false);

  const isOn = (feature: BellOrWhistle) => settings?.[feature.key] === true;
  const on = BELLS_AND_WHISTLES.filter(isOn);
  const allOn = on.length === BELLS_AND_WHISTLES.length;
  // What pressing it would change: the ones not yet in the state it leads to.
  const changing = asking === null ? [] : BELLS_AND_WHISTLES.filter((feature) => isOn(feature) !== asking);

  const confirm = async () => {
    if (!orgId || asking === null) return;
    const enabled = asking;
    setSaving(true);
    const error = await setAll(orgId, enabled);
    setSaving(false);
    setAsking(null);
    toast(
      error
        ? { title: "Could not change the settings", description: error, variant: "destructive" }
        : { title: enabled ? "All bells & whistles switched on" : "All bells & whistles switched off" },
    );
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> All bells &amp; whistles
            </p>
            <p className="text-xs text-muted-foreground">
              Switch every feature below on or off at once.{" "}
              {settings ? `${on.length} of ${BELLS_AND_WHISTLES.length} are on now.` : ""}
              {!canManage && " Only an owner or admin can use this."}
            </p>
          </div>
          <Switch
            aria-label="All bells & whistles"
            checked={allOn}
            disabled={!canManage || !orgId || !settings || saving}
            onCheckedChange={(checked) => setAsking(checked)}
          />
        </div>
      </CardContent>

      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && !saving && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {asking ? "Switch on all bells & whistles?" : "Switch off all bells & whistles?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {asking
                    ? "This switches on, for everyone in the organization:"
                    : "This switches off, for everyone in the organization:"}
                </p>
                <ul className="list-disc pl-5">
                  {changing.map((feature) => (
                    <li key={feature.key}>{feature.label}</li>
                  ))}
                </ul>
                {!asking && (
                  <p>
                    Nothing is deleted: points, ratings, dates, labels and logged time are kept, and come back when a
                    feature is switched on again.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                // Stay open until the change is saved; confirm() closes it.
                event.preventDefault();
                void confirm();
              }}
            >
              {asking ? "Switch all on" : "Switch all off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
