import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Hash, Clock, Settings2, Tag, TrendingUp, FlaskConical, Star } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useLabelsStore } from "@/store/labelsStore";
import { TeamManagement } from "@/components/TeamManagement";
import { BackupsCard } from "@/components/BackupsCard";
import { GithubIntegrationsCard } from "@/components/GithubIntegrationsCard";
import { GmailIntegrationsCard, JobAdImportCard } from "@/components/GmailIntegrationsCard";
import { TimesheetBrowserDialog } from "@/components/TimesheetBrowserDialog";
import { LabelsManager } from "@/components/LabelsManager";

const DEFAULT_ORG_SETTINGS = { timeLoggingEnabled: false, pointsEnabled: false, labelsEnabled: false, customStatusesEnabled: false, savingsIncomeEnabled: false };

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

  const orgSettingsRaw = useOrgSettingsStore((s) => (activeOrgId ? s.settings[activeOrgId] : undefined));
  const orgSettings = orgSettingsRaw ?? DEFAULT_ORG_SETTINGS;
  const customStatusesEnabled = (orgSettings as { customStatusesEnabled?: boolean }).customStatusesEnabled ?? false;
  const loadSettings = useOrgSettingsStore((s) => s.loadSettings);
  const setPointsEnabledSetting = useOrgSettingsStore((s) => s.setPointsEnabled);
  const setRatingsEnabledSetting = useOrgSettingsStore((s) => s.setRatingsEnabled);
  const ratingsEnabled = (orgSettings as { ratingsEnabled?: boolean }).ratingsEnabled ?? false;
  const setTimeLoggingEnabledSetting = useOrgSettingsStore((s) => s.setTimeLoggingEnabled);
  const setCustomStatusesEnabledSetting = useOrgSettingsStore((s) => s.setCustomStatusesEnabled);
  const setLabelsEnabledSetting = useOrgSettingsStore((s) => s.setLabelsEnabled);
  const setSavingsIncomeEnabledSetting = useOrgSettingsStore((s) => s.setSavingsIncomeEnabled);
  const setBurnupsEnabledSetting = useOrgSettingsStore((s) => s.setBurnupsEnabled);
  const setPersistNotificationsEnabledSetting = useOrgSettingsStore((s) => s.setPersistNotificationsEnabled);
  const persistNotificationsEnabled =
    (orgSettings as { persistNotificationsEnabled?: boolean }).persistNotificationsEnabled ?? false;
  const burnupsEnabled = (orgSettings as { burnupsEnabled?: boolean }).burnupsEnabled ?? false;
  const labelsEnabled = orgSettings.labelsEnabled ?? false;
  const loadLabels = useLabelsStore((s) => s.loadLabels);

  const [timesheetBrowserOpen, setTimesheetBrowserOpen] = useState(false);

  useEffect(() => {
    if (activeOrgId) {
      loadSettings(activeOrgId);
      loadLabels([activeOrgId]);
    }
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

      {/* Job ad import is open to every organization. The general link import
          beside it is not: that one still only shows in Agilefant's own. */}
      {activeOrg?.organization_slug === "agilefant" && <GmailIntegrationsCard />}
      <JobAdImportCard />

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
            <Star className="w-4 h-4" /> Ratings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable star ratings</p>
              <p className="text-xs text-muted-foreground">
                Rate work items one to five stars on their row, and sort a backlog by rating. Each backlog then turns
                its own stars on from its right-click menu in the tree, starting off. Turning this off hides the stars
                everywhere; ratings already given are kept.
              </p>
            </div>
            <Switch
              checked={ratingsEnabled}
              onCheckedChange={(checked) => {
                if (activeOrgId) {
                  setRatingsEnabledSetting(activeOrgId, checked);
                  toast({ title: checked ? "Ratings enabled" : "Ratings disabled" });
                }
              }}
              disabled={!canManage}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="w-4 h-4" /> Labels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable labels</p>
              <p className="text-xs text-muted-foreground">
                Attach color-coded labels to work items and backlogs.
              </p>
            </div>
            <Switch
              checked={labelsEnabled}
              onCheckedChange={(checked) => {
                if (activeOrgId) {
                  setLabelsEnabledSetting(activeOrgId, checked);
                  toast({ title: checked ? "Labels enabled" : "Labels disabled" });
                }
              }}
            />
          </div>
          {labelsEnabled && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-3">Manage labels</p>
              <LabelsManager />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Savings &amp; Income
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable savings &amp; income</p>
              <p className="text-xs text-muted-foreground">
                Attach a monthly savings and monthly income amount to work items, then see cumulative flow diagrams
                per backlog tree sliced by different perspectives.
              </p>
            </div>
            <Switch
              checked={orgSettings.savingsIncomeEnabled ?? false}
              onCheckedChange={(checked) => {
                if (activeOrgId) {
                  setSavingsIncomeEnabledSetting(activeOrgId, checked);
                  toast({ title: checked ? "Savings & Income enabled" : "Savings & Income disabled" });
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4" /> Labs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Burnups</p>
              <p className="text-xs text-muted-foreground">
                Show cumulative flow diagrams for work item branches, backlogs and backlog trees,
                by item count or points.
              </p>
            </div>
            <Switch
              checked={burnupsEnabled}
              onCheckedChange={(checked) => {
                if (activeOrgId) {
                  setBurnupsEnabledSetting(activeOrgId, checked);
                  toast({ title: checked ? "Burnups enabled" : "Burnups disabled" });
                }
              }}
            />
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <div>
              <p className="text-sm font-medium">Persist notifications</p>
              <p className="text-xs text-muted-foreground">
                Show a small confirmation in the corner whenever a change is saved to the database.
              </p>
            </div>
            <Switch
              checked={persistNotificationsEnabled}
              onCheckedChange={(checked) => {
                if (activeOrgId) {
                  setPersistNotificationsEnabledSetting(activeOrgId, checked);
                  toast({ title: checked ? "Persist notifications enabled" : "Persist notifications disabled" });
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <TimesheetBrowserDialog
        open={timesheetBrowserOpen}
        onOpenChange={setTimesheetBrowserOpen}
        orgName={activeOrg?.organization_name ?? ""}
      />
    </div>
  );
}
