import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clerkSignOut, openClerkUserProfile } from "@/lib/clerkBridge";
import { paginateSelect } from "@/integrations/supabase/pagination";
import { useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  UserPlus,
  Trash2,
  KeyRound,
  Pencil,
  AlertTriangle,
  SearchCheck,
  Hash,
  CreditCard,
  FileText,
  Clock,
  Settings2,
  FlaskConical,
  Wrench,
  LayoutGrid,
  Shield,
  Globe,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { checkDataIntegrity, cleanseData, formatIssueReport } from "@/store/dataIntegrity";
import { TeamManagement } from "@/components/TeamManagement";
import { BellsAndWhistlesSection } from "@/components/BellsAndWhistlesSection";
import { PricingCards } from "@/components/PricingCards";
import { Switch } from "@/components/ui/switch";
import {
  isAutoCheckEnabled as isAutoCheckEnabledSetting,
  setAutoCheckEnabled as setAutoCheckEnabledSetting,
  isAutoTestEnabled as isAutoTestEnabledSetting,
  setAutoTestEnabled as setAutoTestEnabledSetting,
} from "@/hooks/useAutoIntegrityCheck";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { usePublishedLinksStore } from "@/store/publishedLinksStore";
import { useNavigate } from "react-router-dom";
import { TermsOfServiceDialog } from "@/components/TermsOfServiceDialog";
import { TimesheetBrowserDialog } from "@/components/TimesheetBrowserDialog";
import { BackupsCard } from "@/components/BackupsCard";
import { GithubIntegrationsCard } from "@/components/GithubIntegrationsCard";
import { WhatsappIntegrationsCard } from "@/components/WhatsappIntegrationsCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Member {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: "owner" | "admin" | "member";
}

const DEFAULT_TEAM_SETTINGS_ORG_SETTINGS = {
  timeLoggingEnabled: false,
  pointsEnabled: false,
  labelsEnabled: false,
};

export default function TeamSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const memberships = useOrgStore((s) => s.memberships);
  const roleOverride = useOrgStore((s) => s.roleOverride);
  const activeOrg = memberships.find((m) => m.organization_id === activeOrgId) ?? null;
  const loadMemberships = useOrgStore((s) => s.loadMemberships);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [loading, setLoading] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  // Org rename state
  const [isRenamingOrg, setIsRenamingOrg] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  // Auto-check state
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => isAutoCheckEnabledSetting(activeOrgId));
  const [autoTestEnabled, setAutoTestEnabled] = useState(() => isAutoTestEnabledSetting(activeOrgId));

  // Org settings from backend
  const orgSettings = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""] ?? DEFAULT_TEAM_SETTINGS_ORG_SETTINGS,
  );
  const loadSettings = useOrgSettingsStore((s) => s.loadSettings);
  const setOrganizationId = useAppStore((s) => s.setOrganizationId);
  const loadData = useAppStore((s) => s.loadFromSupabase);

  // Delete state
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Timesheet export/browse state
  const [timesheetBrowserOpen, setTimesheetBrowserOpen] = useState(false);

  // Terms of Service state
  const [tosOpen, setTosOpen] = useState(false);

  const currentRole = roleOverride ?? activeOrg?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";

  // Load data that may not be populated when landing directly on this page
  // (e.g. after a browser refresh instead of navigating from the main view).
  useEffect(() => {
    if (!activeOrgId) return;
    loadMembers();
    loadSettings(activeOrgId);
    setOrganizationId(activeOrgId);
    loadData();
    // loadMembers is defined in this component; Zustand actions are stable refs.
    // Only activeOrgId needs to be in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("is_superuser")
      .eq("id", user.id)
      .single()
      .then(({ data }) => setIsSuperuser(data?.is_superuser ?? false));
  }, [user?.id]);

  useEffect(() => {
    if (activeOrg) {
      setOrgName(activeOrg.organization_name);
      setOrgSlug(activeOrg.organization_slug);
    }
  }, [activeOrg?.organization_name, activeOrg?.organization_slug]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  // For non-member superusers the org is not in the memberships list so activeOrg
  // is null. Fetch the org name/slug directly so the Danger Zone can display the
  // correct confirmation prompt and the delete flow can proceed.
  useEffect(() => {
    if (activeOrg || !activeOrgId || !isSuperuser) return;
    supabase
      .from("organizations")
      .select("name, slug")
      .eq("id", activeOrgId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to fetch org details for non-member superuser:", error);
          return;
        }
        if (data) {
          setOrgName(data.name);
          setOrgSlug(data.slug);
        }
      });
  }, [activeOrg, activeOrgId, isSuperuser]);

  const loadMembers = async () => {
    if (!activeOrgId) return;
    const { data, error } = await supabase
      .from("memberships")
      .select("id, user_id, role")
      .eq("organization_id", activeOrgId);
    if (error) {
      console.error(error);
      return;
    }

    const userIds = data.map((m) => m.user_id);
    const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", userIds);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    setMembers(
      data.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        email: profileMap.get(m.user_id)?.email ?? "",
        full_name: profileMap.get(m.user_id)?.full_name ?? "",
        role: m.role as Member["role"],
      })),
    );
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !inviteEmail) return;
    setLoading(true);

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", inviteEmail)
      .maybeSingle();

    if (profileErr || !profile) {
      toast({
        title: "User not found",
        description: "The user must sign up first before being invited.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const { error } = await supabase
      .from("memberships")
      .insert({ user_id: profile.id, organization_id: activeOrgId, role: inviteRole });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Member added!" });
      setInviteEmail("");
      await loadMembers();
    }
    setLoading(false);
  };

  const handleRemove = async (membershipId: string, memberUserId: string) => {
    if (memberUserId === user?.id) {
      if (!confirm("Are you sure you want to leave this organization?")) return;
    }
    const { error } = await supabase.from("memberships").delete().eq("id", membershipId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Member removed" });
      if (memberUserId === user?.id) {
        await loadMemberships(user.id);
        navigate("/");
      } else {
        await loadMembers();
      }
    }
  };

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    const { error } = await supabase
      .from("memberships")
      .update({ role: newRole as any })
      .eq("id", membershipId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await loadMembers();
    }
  };

  const handleRenameOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !orgName.trim() || !orgSlug.trim()) return;
    setRenameLoading(true);

    const { error } = await supabase
      .from("organizations")
      .update({ name: orgName.trim(), slug: orgSlug.trim().toLowerCase() })
      .eq("id", activeOrgId);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Organization updated" });
      setIsRenamingOrg(false);
      if (user?.id) await loadMemberships(user.id);
    }
    setRenameLoading(false);
  };

  const handleDeleteOrg = async () => {
    if (!activeOrgId || !user?.id) return;
    setDeleteLoading(true);

    try {
      // 1. Find backlog trees owned by this org that are shared with other orgs
      const { data: ownedTrees } = await supabase.from("backlog_trees").select("id").eq("organization_id", activeOrgId);

      const ownedTreeIds = (ownedTrees ?? []).map((t) => t.id);

      if (ownedTreeIds.length > 0) {
        // Find shares for these trees
        const { data: shares } = await supabase
          .from("backlog_tree_shares" as any)
          .select("tree_id, organization_id")
          .in("tree_id", ownedTreeIds);

        // Group shares by tree
        const sharesByTree = new Map<string, string[]>();
        for (const s of (shares ?? []) as any[]) {
          const list = sharesByTree.get(s.tree_id) ?? [];
          list.push(s.organization_id);
          sharesByTree.set(s.tree_id, list);
        }

        // Transfer shared trees to the first shared org
        for (const [treeId, orgIds] of sharesByTree) {
          const newOwnerId = orgIds[0];

          // Transfer tree ownership
          await supabase.from("backlog_trees").update({ organization_id: newOwnerId }).eq("id", treeId);

          // Transfer backlogs ownership
          await supabase.from("backlogs").update({ organization_id: newOwnerId }).eq("tree_id", treeId);

          // Transfer work items that reference this tree
          // (items owned by the deleted org that have assignments to this tree)
          const { data: items } = await paginateSelect<any>((from, to) =>
            supabase
              .from("work_items")
              .select("id, backlog_assignments")
              .eq("organization_id", activeOrgId)
              .order("id", { ascending: true })
              .range(from, to),
          );

          const itemsInTree = (items ?? []).filter((item: any) => {
            const assignments = item.backlog_assignments as Record<string, string>;
            return assignments[treeId] !== undefined;
          });

          if (itemsInTree.length > 0) {
            const itemIds = itemsInTree.map((i: any) => i.id);
            // Rename item IDs to use the new owner's org prefix and update organization_id.
            // A plain `update { organization_id }` would leave the old org UUID embedded in
            // each item's ID, causing ownerOrgOf() to re-derive the (now-deleted) org on the
            // next upsert and fail the FK constraint.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).rpc("rename_work_items_org_prefix", {
              _item_ids: itemIds,
              _new_org_id: newOwnerId,
            });
          }

          // Remove the share entry for the new owner (they now own it)
          await supabase
            .from("backlog_tree_shares" as any)
            .delete()
            .eq("tree_id", treeId)
            .eq("organization_id", newOwnerId);
        }
      }

      // 2. Handle trees SHARED WITH this org (owned by other orgs).
      // When this org is deleted its backlogs and work items in those trees must be
      // transferred to the tree-owning org so the other org retains all data.
      const { data: incomingShares } = await supabase
        .from("backlog_tree_shares" as any)
        .select("tree_id")
        .eq("organization_id", activeOrgId);

      const incomingTreeIds = (incomingShares ?? []).map((s: any) => s.tree_id as string);

      if (incomingTreeIds.length > 0) {
        const { data: incomingTrees } = await supabase
          .from("backlog_trees")
          .select("id, organization_id")
          .in("id", incomingTreeIds);

        // Fetch all items owned by this org once; filter per tree and remove transferred items
        // to avoid re-transferring items that have assignments to multiple shared trees.
        const { data: remainingSharedItems } = await paginateSelect<any>((from, to) =>
          supabase
            .from("work_items")
            .select("id, backlog_assignments")
            .eq("organization_id", activeOrgId)
            .order("id", { ascending: true })
            .range(from, to),
        );

        let pendingItems: any[] = remainingSharedItems ?? [];

        for (const tree of (incomingTrees ?? []) as any[]) {
          const treeOwnerOrgId = tree.organization_id as string;

          // Transfer backlogs in this tree that are owned by the deleting org
          await supabase
            .from("backlogs")
            .update({ organization_id: treeOwnerOrgId })
            .eq("tree_id", tree.id)
            .eq("organization_id", activeOrgId);

          // Transfer work items with assignments to this tree owned by the deleting org
          const sharedItemsInTree = pendingItems.filter((item: any) => {
            const assignments = item.backlog_assignments as Record<string, string>;
            return assignments[tree.id] !== undefined;
          });

          if (sharedItemsInTree.length > 0) {
            const sharedItemIds = sharedItemsInTree.map((i: any) => i.id as string);
            // Rename item IDs to use the tree-owner's org prefix and update organization_id.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).rpc("rename_work_items_org_prefix", {
              _item_ids: sharedItemIds,
              _new_org_id: treeOwnerOrgId,
            });
            // Remove transferred items so they are not processed again for other shared trees
            const transferred = new Set(sharedItemIds);
            pendingItems = pendingItems.filter((i: any) => !transferred.has(i.id));
          }
        }
      }

      // 3. Now delete the organization (non-shared trees/backlogs/items will cascade or be cleaned up)
      // Capture member user IDs before memberships are deleted so we can clean up
      // accounts that no longer belong to any organization after this org is gone.
      const memberUserIds = members.map((m) => m.user_id);

      // Delete remaining work item hyperlinks owned by this org.
      // work_item_hyperlinks.organization_id references organizations(id) without ON DELETE CASCADE,
      // so the hyperlinks must be explicitly removed before the organization row is deleted.
      await supabase.from("work_item_hyperlinks").delete().eq("organization_id", activeOrgId);
      // Delete remaining work items owned by this org
      await supabase.from("work_items").delete().eq("organization_id", activeOrgId);
      // Delete remaining backlogs owned by this org
      await supabase.from("backlogs").delete().eq("organization_id", activeOrgId);
      // Delete remaining backlog trees owned by this org
      await supabase.from("backlog_trees").delete().eq("organization_id", activeOrgId);
      // Delete memberships
      await supabase.from("memberships").delete().eq("organization_id", activeOrgId);
      // Delete change log entries for this org
      await (supabase as any).from("change_log").delete().eq("organization_id", activeOrgId);
      // Delete the org itself
      const { error } = await supabase.from("organizations").delete().eq("id", activeOrgId);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setDeleteLoading(false);
        return;
      }

      // Delete users who no longer belong to any organization.
      // Superusers must never be deleted, so fetch their is_superuser flag and
      // exclude them from the list before sending it to the cleanup function.
      const { data: superuserProfiles, error: superuserCheckError } = await supabase
        .from("profiles")
        .select("id")
        .in("id", memberUserIds)
        .eq("is_superuser", true);
      if (superuserCheckError) {
        // Abort: we cannot safely determine which members are superusers.
        toast({
          title: "Error",
          description: "Could not verify member roles before cleanup. Aborting.",
          variant: "destructive",
        });
        setDeleteLoading(false);
        return;
      }
      const superuserIds = new Set((superuserProfiles ?? []).map((p) => p.id));
      const nonSuperuserMemberIds = memberUserIds.filter((id) => !superuserIds.has(id));

      if (nonSuperuserMemberIds.length > 0) {
        // Determine before cleanup whether the current user has any remaining memberships.
        // We do this now (after this org's memberships are gone) to avoid querying the DB
        // after the current user's auth session may have been invalidated by cleanup.
        // Superusers are excluded from cleanup, so they are never "orphaned".
        const { data: currentUserRemaining } = await supabase
          .from("memberships")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);
        const currentUserWillBeOrphaned = !isSuperuser && (!currentUserRemaining || currentUserRemaining.length === 0);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: cleanupError } = await (supabase as any).rpc("cleanup_orphaned_users", {
          p_user_ids: nonSuperuserMemberIds,
        });
        if (cleanupError) {
          console.error("cleanup_orphaned_users:", cleanupError);
          toast({
            title: "Organization deleted",
            description: "Organization data was deleted, but user account cleanup encountered an error.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Organization deleted",
            description:
              "All organization data has been permanently deleted. Members with no remaining organizations were also removed.",
          });
        }

        if (currentUserWillBeOrphaned) {
          await clerkSignOut();
          // The landing page, like every other sign-out: this user has just
          // deleted their last organization and has no account to sign back
          // into, so a sign-in form is the one thing that cannot help them.
          navigate("/");
          return;
        }
      } else {
        toast({
          title: "Organization deleted",
          description: "All organization data has been permanently deleted.",
        });
      }

      await loadMemberships(user.id);
      navigate("/");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeleteLoading(false);
  };

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case "owner":
        return "default";
      case "admin":
        return "secondary";
      default:
        return "outline";
    }
  };

  const handleCheckData = () => {
    const state = useAppStore.getState();
    const issues = checkDataIntegrity({
      workItems: state.workItems,
      backlogs: state.backlogs,
      backlogTrees: state.backlogTrees,
    });
    if (issues.length === 0) {
      toast({ title: "✅ No broken items found", description: "All 8 integrity checks passed." });
    } else {
      const report = formatIssueReport(issues);
      navigator.clipboard.writeText(report);
      const categories = [...new Set(issues.map((i) => i.category))];
      toast({
        title: `⚠️ Found ${issues.length} issue${issues.length > 1 ? "s" : ""}`,
        description: `Categories: ${categories.join(", ")}. See console for full report.`,
        variant: "destructive",
      });
    }
  };

  const handleCleanseData = () => {
    const state = useAppStore.getState();
    const result = cleanseData({
      workItems: state.workItems,
      backlogs: state.backlogs,
      backlogTrees: state.backlogTrees,
    });
    const allIssues = [...result.removed, ...result.fixed];
    if (allIssues.length === 0) {
      toast({ title: "✅ No invalid data found" });
      return;
    }
    const report = formatIssueReport(allIssues);
    navigator.clipboard.writeText(report);
    console.log("Cleanse report:\n" + report);
    useAppStore.setState(result.data);
    toast({
      title: `🧹 Cleansed ${allIssues.length} issue${allIssues.length > 1 ? "s" : ""} (${result.removed.length} removed, ${result.fixed.length} fixed)`,
      description: "Full report copied to clipboard.",
    });
  };

  const handleRunTests = () => {
    const state = useAppStore.getState();
    const issues = checkDataIntegrity({
      workItems: state.workItems,
      backlogs: state.backlogs,
      backlogTrees: state.backlogTrees,
    });
    const results: string[] = [];
    const pass = (name: string) => results.push(`✅ PASS: ${name}`);
    const fail = (name: string, detail: string) => results.push(`❌ FAIL: ${name} — ${detail}`);
    const categories = [
      "Ghost Parent",
      "Orphaned Children",
      "Circular Reference",
      "Backlog Displacement",
      "Tree-Backlog Desync",
      "Duplicate Rank",
      "Cross-Org Pollution",
      "Malformed ID",
      "Zombie Assignment",
    ];
    categories.forEach((cat) => {
      const catIssues = issues.filter((i) => i.category === cat);
      catIssues.length === 0 ? pass(`No ${cat.toLowerCase()}`) : fail(`${cat} found`, `${catIssues.length} items`);
    });
    const passed = results.filter((r) => r.startsWith("✅")).length;
    const failed = results.filter((r) => r.startsWith("❌")).length;
    const report = `DATA INTEGRITY TEST RESULTS\n${"=".repeat(40)}\n${results.join("\n")}\n${"=".repeat(40)}\n${passed} passed, ${failed} failed of ${results.length} tests`;
    const fullReport = issues.length > 0 ? report + "\n\nDETAILED ISSUES:\n" + formatIssueReport(issues) : report;
    navigator.clipboard.writeText(fullReport);
    toast({
      title: failed === 0 ? `✅ All ${passed} tests passed` : `⚠️ ${failed} test${failed > 1 ? "s" : ""} failed`,
      description: `${passed} passed, ${failed} failed. Report copied to clipboard.`,
      variant: failed > 0 ? "destructive" : undefined,
    });
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">Organization Settings — {activeOrg?.organization_name ?? orgName}</h1>
        </div>

        {/* Organization Settings */}
        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Pencil className="w-4 h-4" /> Organization
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isRenamingOrg ? (
                <form onSubmit={handleRenameOrg} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Name</Label>
                    <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Slug</Label>
                    <Input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value.toLowerCase())} required />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={renameLoading}>
                      {renameLoading ? "Saving..." : "Save"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsRenamingOrg(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{activeOrg?.organization_name}</p>
                    <p className="text-xs text-muted-foreground">Slug: {activeOrg?.organization_slug}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setIsRenamingOrg(true)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Rename
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Invite Member
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "member" | "admin")}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? "Adding..." : "Add"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members ({members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {member.full_name || member.email}
                      {member.user_id === user?.id && <span className="text-muted-foreground ml-1">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {((canManage && currentRole === "owner") || isSuperuser) && member.user_id !== user?.id ? (
                      <Select value={member.role} onValueChange={(v) => handleRoleChange(member.id, v)}>
                        <SelectTrigger className="w-24 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="owner">Owner</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={roleBadgeColor(member.role) as any}>{member.role}</Badge>
                    )}
                    {(canManage || member.user_id === user?.id) && member.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(member.id, member.user_id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> Change Password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <div id="bells-whistles">
          <BellsAndWhistlesSection />
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-1">Labs</h2>
          <p className="text-sm text-muted-foreground mb-4">
            These features are in progress. They sort of work but aren't yet great.
          </p>
        </div>

        {/* Boards / Kanban (Labs) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LayoutGrid className="w-4 h-4" /> Boards (Kanban)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable board view</p>
                <p className="text-xs text-muted-foreground">
                  Adds a List/Board toggle to each backlog. The board shows leaf items grouped by the tree's statuses; drag between columns to change status.
                </p>
              </div>
              <Switch
                checked={(orgSettings as { boardsEnabled?: boolean }).boardsEnabled ?? false}
                onCheckedChange={(checked) => {
                  if (activeOrgId) {
                    useOrgSettingsStore.getState().setBoardsEnabled(activeOrgId, checked);
                    toast({ title: checked ? "Boards enabled" : "Boards disabled" });
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Public link sharing. Visible to every member, so anyone can see
            whether this organization's backlogs can be made public, but only
            an owner or admin can change it — the database refuses anyone else
            regardless, and this just says so up front instead of failing. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-4 h-4" /> Public links
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Allow sharing by public link</p>
                <p className="text-xs text-muted-foreground">
                  Lets members publish a backlog or a whole tree at an address anyone can open without signing in.
                  Turning this off stops every existing link working straight away; it deletes nothing, so turning
                  it back on restores them at the same addresses.
                  {!canManage && !isSuperuser && " Only an owner or admin can change this."}
                </p>
              </div>
              <Switch
                checked={(orgSettings as { publicLinksEnabled?: boolean }).publicLinksEnabled ?? false}
                disabled={!canManage && !isSuperuser}
                onCheckedChange={async (checked) => {
                  if (!activeOrgId) return;
                  const saved = await useOrgSettingsStore.getState().setPublicLinksEnabled(activeOrgId, checked);
                  if (!saved) {
                    toast({
                      title: "Could not change public links",
                      description: "The setting was not saved, so it has been put back.",
                      variant: "destructive",
                    });
                    return;
                  }
                  // Publishing markers and controls depend on this, so reload them
                  // rather than leave the sidebar describing the old setting.
                  usePublishedLinksStore.getState().scheduleLoad();
                  toast({
                    title: checked ? "Public links turned on" : "Public links turned off",
                    description: checked ? undefined : "Existing links now show as unavailable to visitors.",
                  });
                }}
              />
            </div>
          </CardContent>
        </Card>

        <WhatsappIntegrationsCard />


        {isSuperuser && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <SearchCheck className="w-4 h-4" /> Data Integrity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-check on changes</p>
                  <p className="text-xs text-muted-foreground">
                    Automatically run data integrity checks whenever item or backlog relationships change.
                  </p>
                </div>
                <Switch
                  checked={autoCheckEnabled}
                  onCheckedChange={(checked) => {
                    if (activeOrgId) {
                      setAutoCheckEnabledSetting(activeOrgId, checked);
                      setAutoCheckEnabled(checked);
                      toast({ title: checked ? "Auto-check enabled" : "Auto-check disabled" });
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div>
                  <p className="text-sm font-medium">Auto-run tests on changes</p>
                  <p className="text-xs text-muted-foreground">
                    Automatically run all integrity tests whenever item or backlog relationships change and copy results
                    to clipboard.
                  </p>
                </div>
                <Switch
                  checked={autoTestEnabled}
                  onCheckedChange={(checked) => {
                    if (activeOrgId) {
                      setAutoTestEnabledSetting(activeOrgId, checked);
                      setAutoTestEnabled(checked);
                      toast({ title: checked ? "Auto-test enabled" : "Auto-test disabled" });
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
          orgName={activeOrg?.organization_name ?? orgName}
        />

        {/* Billing / Subscription */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4" /> Billing & Plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PricingCards />
          </CardContent>
        </Card>

        {/* Terms of Service */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" /> Terms of Service
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">View the terms you agreed to when creating your account.</p>
              <Button variant="outline" size="sm" onClick={() => setTosOpen(true)}>
                View
              </Button>
            </div>
          </CardContent>
        </Card>
        <TermsOfServiceDialog open={tosOpen} onCancel={() => setTosOpen(false)} />

        {/* Superuser Tools */}
        {isSuperuser && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="w-4 h-4" /> Superuser Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Check Data</p>
                  <p className="text-xs text-muted-foreground">
                    Run data integrity checks and copy any issues to clipboard.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleCheckData}>
                  <SearchCheck className="w-3.5 h-3.5 mr-1" /> Check Data
                </Button>
              </div>
              <div className="flex items-center justify-between pt-3 border-t">
                <div>
                  <p className="text-sm font-medium">Cleanse Data</p>
                  <p className="text-xs text-muted-foreground">
                    Remove or fix invalid data entries and copy a report to clipboard.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleCleanseData}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Cleanse Data
                </Button>
              </div>
              <div className="flex items-center justify-between pt-3 border-t">
                <div>
                  <p className="text-sm font-medium">Run Tests</p>
                  <p className="text-xs text-muted-foreground">
                    Run all integrity tests and copy results to clipboard.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={handleRunTests}>
                  <FlaskConical className="w-3.5 h-3.5 mr-1" /> Run Tests
                </Button>
              </div>
              <div className="flex items-center justify-between pt-3 border-t">
                <div>
                  <p className="text-sm font-medium">Manager Screen</p>
                  <p className="text-xs text-muted-foreground">Browse all organizations, users, teams, and recent sign-ins.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => navigate("/manager")}>
                  <Shield className="w-3.5 h-3.5 mr-1" /> Open
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Danger Zone — Superuser only */}
        {isSuperuser && orgSlug && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-4 h-4" /> Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Delete this organization</p>
                  <p className="text-xs text-muted-foreground">
                    This will permanently delete the organization, all its data, and remove all members.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{activeOrg?.organization_name ?? orgName}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. All backlog trees, backlogs, work items, hyperlinks, and
                        memberships will be permanently deleted. Members who do not belong to any other organization
                        will also have their accounts deleted.
                        <br />
                        <br />
                        Type <strong>{activeOrg?.organization_slug ?? orgSlug}</strong> to confirm:
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={activeOrg?.organization_slug ?? orgSlug}
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={
                          deleteConfirmText.toLowerCase() !== (activeOrg?.organization_slug ?? orgSlug).toLowerCase() ||
                          deleteLoading
                        }
                        onClick={handleDeleteOrg}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleteLoading ? "Deleting..." : "Delete Organization"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ChangePasswordForm() {
  // Clerk owns the password, and will not change one without reverifying the
  // user first — which its own account screen knows how to do and a form here
  // does not. It also covers what a password form never could: an account with
  // no password at all, because it signed up through Google.
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Your password is managed by Clerk, which will ask you to confirm your identity before
        changing it.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => openClerkUserProfile()}>
        Manage password
      </Button>
    </div>
  );
}
