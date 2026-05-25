import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Hash, Clock, Settings2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { TeamManagement } from "@/components/TeamManagement";
import { BackupsCard } from "@/components/BackupsCard";
import { GithubIntegrationsCard } from "@/components/GithubIntegrationsCard";
import { WhatsappIntegrationsCard } from "@/components/WhatsappIntegrationsCard";
import { TimesheetBrowserDialog } from "@/components/TimesheetBrowserDialog";

export function BellsAndWhistlesSection({ showHeader = true }: { showHeader?: boolean }) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const memberships = useOrgStore((s) => s.memberships);
  const roleOverride = useOrgStore((s) => s.roleOverride);
  const activeOrg = (() => {
    const m = memberships.find((x) => x.organization_id === activeOrgId) ?? null;
    return m && roleOverride ? { ...m, role: roleOverride } : m;
  })();
  const role = activeOrg?.role;
  const canManage = role === "owner" || role === "admin";

  const orgSettings = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""] ?? { timeLoggingEnabled: false, pointsEnabled: false, labelsEnabled: false },
  );
  const customStatusesEnabled = (orgSettings as { customStatusesEnabled?: boolean }).customStatusesEnabled ?? false;
  const loadSettings = useOrgSettingsStore((s) => s.loadSettings);
  const setPointsEnabledSetting = useOrgSettingsStore((s) => s.setPointsEnabled);
  const setTimeLoggingEnabledSetting = useOrgSettingsStore((s) => s.setTimeLoggingEnabled);
  const setCustomStatusesEnabledSetting = useOrgSettingsStore((s) => s.setCustomStatusesEnabled);

  const [timesheetBrowserOpen, setTimesheetBrowserOpen] = useState(false);

  useEffect(() => {
    if (activeOrgId) loadSettings(activeOrgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  return (
    <div className="space-y-6">
      {showHeader && (
        <div>
          <h2 className="text-lg font-semibold mb-1">Bells &amp; Whistles</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You really don't need any of these, but many other tools have them. Agilefant strives to offer them with elegance others will want to copy.
          </p>
        </div>
      )}

      <TeamManagement />

      <BackupsCard />

      <GithubIntegrationsCard />

      <WhatsappIntegrationsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Hash className="w-4 h-4" /> Points
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable story points</p>
              <p className="text-xs text-muted-foreground">Show story points on work items and backlogs.</p>
            </div>
            <Switch
              checked={orgSettings.pointsEnabled}
              onCheckedChange={(checked) => {
                if (activeOrgId) {
                  setPointsEnabledSetting(activeOrgId, checked);
                  toast({ title: checked ? "Points enabled" : "Points disabled" });
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Time Logging
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable time logging</p>
              <p className="text-xs text-muted-foreground">Allow members to log time spent on work items.</p>
            </div>
            <Switch
              checked={orgSettings.timeLoggingEnabled}
              onCheckedChange={(checked) => {
                if (activeOrgId) {
                  setTimeLoggingEnabledSetting(activeOrgId, checked);
                  toast({ title: checked ? "Time logging enabled" : "Time logging disabled" });
                }
              }}
            />
          </div>
          {orgSettings.timeLoggingEnabled && (
            <div className="mt-4 pt-4 border-t space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Browse time logs</p>
                  <p className="text-xs text-muted-foreground">
                    View and filter all logged time for users and backlogs, including shared.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setTimesheetBrowserOpen(true)}>
                  <Clock className="w-3.5 h-3.5 mr-1" />
                  Browse
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Custom Statuses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable per-tree statuses</p>
                <p className="text-xs text-muted-foreground">
                  Show a gear icon on each backlog tree so users can configure its statuses and colors.
                </p>
              </div>
              <Switch
                checked={customStatusesEnabled}
                onCheckedChange={(checked) => {
                  if (activeOrgId) {
                    setCustomStatusesEnabledSetting(activeOrgId, checked);
                    toast({ title: checked ? "Custom statuses enabled" : "Custom statuses disabled" });
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <TimesheetBrowserDialog
        open={timesheetBrowserOpen}
        onOpenChange={setTimesheetBrowserOpen}
        orgName={activeOrg?.organization_name ?? ""}
      />
    </div>
  );
}
