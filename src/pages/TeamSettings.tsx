import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, UserPlus, Trash2, KeyRound, Pencil, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

export default function TeamSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrg = useOrgStore((s) => s.getActiveOrg());
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

  // Delete state
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const currentRole = activeOrg?.role;
  const canManage = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    if (!activeOrgId) return;
    loadMembers();
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
          const { data: items } = await supabase
            .from("work_items")
            .select("id, backlog_assignments")
            .eq("organization_id", activeOrgId);

          const itemsInTree = (items ?? []).filter((item: any) => {
            const assignments = item.backlog_assignments as Record<string, string>;
            return assignments[treeId] !== undefined;
          });

          if (itemsInTree.length > 0) {
            const itemIds = itemsInTree.map((i: any) => i.id);
            await supabase.from("work_items").update({ organization_id: newOwnerId }).in("id", itemIds);
          }

          // Remove the share entry for the new owner (they now own it)
          await supabase
            .from("backlog_tree_shares" as any)
            .delete()
            .eq("tree_id", treeId)
            .eq("organization_id", newOwnerId);
        }
      }

      // 2. Now delete the organization (non-shared trees/backlogs/items will cascade or be cleaned up)
      // Delete remaining work items owned by this org
      await supabase.from("work_items").delete().eq("organization_id", activeOrgId);
      // Delete remaining backlogs owned by this org
      await supabase.from("backlogs").delete().eq("organization_id", activeOrgId);
      // Delete remaining backlog trees owned by this org
      await supabase.from("backlog_trees").delete().eq("organization_id", activeOrgId);
      // Delete memberships
      await supabase.from("memberships").delete().eq("organization_id", activeOrgId);
      // Delete the org itself
      const { error } = await supabase.from("organizations").delete().eq("id", activeOrgId);

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setDeleteLoading(false);
        return;
      }

      toast({
        title: "Organization deleted",
        description: "Shared backlog trees were transferred to their shared organizations.",
      });
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

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">Organization Settings — {activeOrg?.organization_name}</h1>
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
                    <Input value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} required />
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
                    {canManage && currentRole === "owner" && member.user_id !== user?.id ? (
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

        {/* Danger Zone — Superuser only */}
        {isSuperuser && (
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
                      <AlertDialogTitle>Delete "{activeOrg?.organization_name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. All backlogs, work items, and memberships will be permanently
                        deleted.
                        <br />
                        <br />
                        Type <strong>{activeOrg?.organization_slug}</strong> to confirm:
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={activeOrg?.organization_slug}
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={deleteConfirmText !== activeOrg?.organization_slug || deleteLoading}
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "New passwords do not match.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleChangePassword} className="space-y-3">
      <div className="space-y-1">
        <Label>New Password</Label>
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      <div className="space-y-1">
        <Label>Confirm New Password</Label>
        <Input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      <Button type="submit" disabled={loading} size="sm">
        {loading ? "Updating..." : "Change Password"}
      </Button>
    </form>
  );
}
