import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { getPlanByProductId, PLANS, type PlanKey } from "@/hooks/useSubscription";
import { getSignInLog, type SignInEntry } from "@/store/signInLogStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Building2,
  Users,
  Shield,
  CreditCard,
  ExternalLink,
  Trash2,
  Clock,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
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

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  memberCount?: number;
  actionCount?: number;
}

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  is_superuser: boolean;
  created_at: string;
}

interface TeamRow {
  id: string;
  name: string;
  organization_id: string;
  organization_name: string;
  created_at: string;
}

export default function ManagerScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { setActiveOrg, loadMemberships, memberships } = useOrgStore();

  const [isSuperuser, setIsSuperuser] = useState<boolean | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "org" | "user"; id: string; name: string } | null>(null);
  const [signIns, setSignIns] = useState<SignInEntry[]>([]);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [orgPlans, setOrgPlans] = useState<Record<string, PlanKey>>({});
  const [plansLoading, setPlansLoading] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(-1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  // Check superuser status
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("is_superuser")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        const su = data?.is_superuser ?? false;
        setIsSuperuser(su);
        if (!su) navigate("/");
      });
  }, [user?.id]);

  // Load all data once superuser confirmed
  useEffect(() => {
    if (!isSuperuser) return;
    loadData();
  }, [isSuperuser]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [orgsRes, usersRes, teamsRes, membershipsRes] = await Promise.all([
        supabase.from("organizations").select("id, name, slug, created_at").order("created_at"),
        supabase.from("profiles").select("id, email, full_name, is_superuser, created_at").order("created_at"),
        supabase.from("teams").select("id, name, organization_id, created_at").order("name"),
        supabase.from("memberships").select("organization_id"),
      ]);

      if (orgsRes.error) throw orgsRes.error;
      if (usersRes.error) throw usersRes.error;
      if (teamsRes.error) throw teamsRes.error;

      // Count members per org
      const memberCounts: Record<string, number> = {};
      for (const m of membershipsRes.data ?? []) {
        memberCounts[m.organization_id] = (memberCounts[m.organization_id] ?? 0) + 1;
      }

      const orgMap: Record<string, string> = {};
      for (const o of orgsRes.data ?? []) {
        orgMap[o.id] = o.name;
      }

      const orgList = orgsRes.data ?? [];
      const actionCounts: Record<string, number> = {};
      await Promise.all(
        orgList.map(async (o) => {
          const { count } = await (supabase as any)
            .from("change_log")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", o.id);
          actionCounts[o.id] = count ?? 0;
        }),
      );

      setOrgs(
        orgList.map((o) => ({
          ...o,
          memberCount: memberCounts[o.id] ?? 0,
          actionCount: actionCounts[o.id] ?? 0,
        })),
      );
      setUsers(usersRes.data ?? []);
      setTeams(
        (teamsRes.data ?? []).map((t) => ({
          ...t,
          organization_name: orgMap[t.organization_id] ?? t.organization_id,
        })),
      );
    } catch (err: any) {
      toast({ title: "Error loading data", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const loadOrgPlans = async (orgIds: string[]) => {
    if (orgIds.length === 0) return;
    // Skip if already loaded for these orgs
    if (orgIds.every((id) => id in orgPlans)) return;
    setPlansLoading(true);
    const results = await Promise.all(
      orgIds.map((id) =>
        supabase.functions
          .invoke("check-subscription", { body: { organization_id: id } })
          .then(({ data }) => ({ id, plan: getPlanByProductId(data?.product_id ?? null) }))
          .catch((err) => {
            console.error(`Failed to load plan for org ${id}:`, err);
            return { id, plan: "free" as PlanKey };
          }),
      ),
    );
    setOrgPlans((prev) => ({ ...prev, ...Object.fromEntries(results.map(({ id, plan }) => [id, plan])) }));
    setPlansLoading(false);
  };

  const handleDeleteOrg = async (orgId: string) => {
    if (!user?.id) return;
    setDeleteLoading(true);
    try {
      // 1. Collect member user IDs before memberships are removed (for orphan cleanup)
      const { data: orgMemberships } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("organization_id", orgId);
      const memberUserIds = (orgMemberships ?? []).map((m) => m.user_id);

      // 2. Delete shares for trees owned by this org (no FK cascade from trees to shares)
      const { data: ownedTrees } = await supabase
        .from("backlog_trees")
        .select("id")
        .eq("organization_id", orgId);
      const ownedTreeIds = (ownedTrees ?? []).map((t) => t.id);
      if (ownedTreeIds.length > 0) {
        await supabase
          .from("backlog_tree_shares" as any)
          .delete()
          .in("tree_id", ownedTreeIds);
      }

      // 3. Delete work item hyperlinks (organization_id FK without ON DELETE CASCADE)
      await supabase.from("work_item_hyperlinks").delete().eq("organization_id", orgId);

      // 4. Delete change_log entries (no FK constraint)
      await (supabase as any).from("change_log").delete().eq("organization_id", orgId);

      // 5. Delete the organization (cascades: work_items, backlogs, backlog_trees,
      //    memberships, teams, backlog_tree_shares[recipient])
      const { error } = await supabase.from("organizations").delete().eq("id", orgId);
      if (error) {
        toast({ title: "Error deleting organization", description: error.message, variant: "destructive" });
        setDeleteLoading(false);
        setDeleteTarget(null);
        return;
      }

      // 6. Cleanup orphaned users (non-superusers with no remaining memberships)
      const { data: superuserProfiles } = await supabase
        .from("profiles")
        .select("id")
        .in("id", memberUserIds)
        .eq("is_superuser", true);
      const superuserIds = new Set((superuserProfiles ?? []).map((p) => p.id));
      const nonSuperuserMemberIds = memberUserIds.filter((id) => !superuserIds.has(id));

      if (nonSuperuserMemberIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc("cleanup_orphaned_users", { p_user_ids: nonSuperuserMemberIds });
      }

      toast({ title: "Organization deleted", description: "The organization and all its data have been permanently deleted." });
      await loadData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeleteLoading(false);
    setDeleteTarget(null);
  };

  const handleDeleteUser = async (userId: string) => {
    setDeleteLoading(true);
    try {
      // Delete all memberships for this user so they become orphaned,
      // then call the existing cleanup_orphaned_users RPC which will
      // remove the profile and auth user for any non-superuser with no memberships.
      const { error: membershipsError } = await supabase
        .from("memberships")
        .delete()
        .eq("user_id", userId);
      if (membershipsError) {
        toast({ title: "Error deleting user", description: membershipsError.message, variant: "destructive" });
        setDeleteLoading(false);
        setDeleteTarget(null);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cleanupError } = await (supabase as any).rpc("cleanup_orphaned_users", {
        p_user_ids: [userId],
      });
      if (cleanupError) {
        toast({ title: "Error deleting user", description: cleanupError.message, variant: "destructive" });
        setDeleteLoading(false);
        setDeleteTarget(null);
        return;
      }

      toast({ title: "User deleted", description: "The user account has been permanently deleted." });
      await loadData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setDeleteLoading(false);
    setDeleteTarget(null);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "org") {
      handleDeleteOrg(deleteTarget.id);
    } else {
      handleDeleteUser(deleteTarget.id);
    }
  };

  const EXCLUDED_SIGN_IN_EMAIL = "jvahanii@gmail.com";
  const loadSignIns = () => {
    setSignIns(getSignInLog().filter((s) => (s.email ?? "").toLowerCase() !== EXCLUDED_SIGN_IN_EMAIL));
  };

  const handleNavigateToOrg = async (orgId: string) => {
    // Switch active org and navigate to main app
    const org = orgs.find((o) => o.id === orgId);
    const isMember = memberships.some((m) => m.organization_id === orgId);
    if (isMember) {
      setActiveOrg(orgId);
      navigate("/");
    } else {
      // Superuser may not be a member; reload memberships first
      if (user?.id) await loadMemberships(user.id);
      setActiveOrg(orgId, org?.name);
      navigate("/");
    }
  };

  // Still checking superuser status
  if (isSuperuser === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">Manager Screen</h1>
          </div>
          <Badge variant="secondary" className="ml-auto">
            Superuser
          </Badge>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Building2 className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{orgs.length}</p>
                <p className="text-sm text-muted-foreground">Organizations</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Users className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-sm text-muted-foreground">Users</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Shield className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{teams.length}</p>
                <p className="text-sm text-muted-foreground">Teams</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="organizations" onValueChange={(v) => { if (v === "billing") loadOrgPlans(orgs.map((o) => o.id)); if (v === "sign-ins") loadSignIns(); }}>
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="organizations">
              <Building2 className="w-4 h-4 mr-1.5" /> Organizations
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="w-4 h-4 mr-1.5" /> Users
            </TabsTrigger>
            <TabsTrigger value="teams">
              <Shield className="w-4 h-4 mr-1.5" /> Teams
            </TabsTrigger>
            <TabsTrigger value="billing">
              <CreditCard className="w-4 h-4 mr-1.5" /> Billing
            </TabsTrigger>
            <TabsTrigger value="sign-ins">
              <Clock className="w-4 h-4 mr-1.5" /> Sign-ins
            </TabsTrigger>
          </TabsList>

          {/* Organizations */}
          <TabsContent value="organizations">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Organizations</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : orgs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No organizations found.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Slug</TableHead>
                        <TableHead>Members</TableHead>
                        <TableHead>Actions</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgs.map((org) => (
                        <TableRow key={org.id}>
                          <TableCell className="font-medium">{org.name}</TableCell>
                          <TableCell className="text-muted-foreground">{org.slug}</TableCell>
                          <TableCell>{org.memberCount}</TableCell>
                          <TableCell>{org.actionCount?.toLocaleString() ?? 0}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(org.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleNavigateToOrg(org.id)}
                              >
                                <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget({ type: "org", id: org.id, name: org.name })}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Users</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No users found.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">
                            {u.full_name || <span className="text-muted-foreground italic">—</span>}
                          </TableCell>
                          <TableCell>{u.email || <span className="text-muted-foreground italic">—</span>}</TableCell>
                          <TableCell>
                            {u.is_superuser ? (
                              <Badge variant="default">Superuser</Badge>
                            ) : (
                              <Badge variant="outline">User</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(u.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {!u.is_superuser && u.id !== user?.id && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget({ type: "user", id: u.id, name: u.full_name || u.email || u.id })}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Teams */}
          <TabsContent value="teams">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Teams</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : teams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No teams found.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team Name</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teams.map((team) => (
                        <TableRow key={team.id}>
                          <TableCell className="font-medium">{team.name}</TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                              {team.organization_name}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(team.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing */}
          <TabsContent value="billing">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="w-4 h-4" /> Organization Plans
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Billing is managed per-organization from each org's settings page.
                  Navigate to an organization to manage its plan.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgs.map((org) => {
                      const plan = orgPlans[org.id];
                      return (
                        <TableRow key={org.id}>
                          <TableCell className="font-medium">{org.name}</TableCell>
                          <TableCell>{org.memberCount}</TableCell>
                          <TableCell>
                            {plansLoading && !plan ? (
                              <span className="text-xs text-muted-foreground">Loading…</span>
                            ) : plan ? (
                              <Badge variant={plan === "free" ? "secondary" : "default"}>
                                {PLANS[plan].name}
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleNavigateToOrg(org.id)}
                            >
                              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sign-ins */}
          <TabsContent value="sign-ins">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Recent sign-ins by other users than jvahanii@gmail.com
                </CardTitle>
              </CardHeader>
              <CardContent>
                {signIns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sign-in records yet. Sign-in data will appear here as users sign in across all organizations.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Sign-in Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {signIns.map((s, i) => (
                        <TableRow key={`${s.id}-${s.timestamp}-${i}`}>
                          <TableCell className="font-medium">
                            {s.fullName || <span className="text-muted-foreground italic">—</span>}
                          </TableCell>
                          <TableCell>{s.email || <span className="text-muted-foreground italic">—</span>}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(s.timestamp).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === "org" ? "Delete organization?" : "Delete user?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "org"
                ? `This will permanently delete the organization "${deleteTarget?.name}", all its data (backlog trees, backlogs, work items, teams), and remove all memberships. Non-superuser members who no longer belong to any other organization will also have their accounts deleted. This action cannot be undone.`
                : `This will permanently delete the user account "${deleteTarget?.name}" and remove them from all organizations. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
