import { useState, useEffect, useRef } from "react";
import { useTeamStore } from "@/store/teamStore";
import { useOrgStore } from "@/store/orgStore";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Users, Plus, Trash2, Pencil, UserPlus, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MemberProfile {
  id: string;
  email: string;
  full_name: string;
}

export function TeamManagement() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrg = useOrgStore((s) => s.getActiveOrg());
  const canManage = activeOrg?.role === "owner" || activeOrg?.role === "admin";
  const isMember = !!activeOrg;
  const teams = useTeamStore((s) => s.teams);
  const teamMembers = useTeamStore((s) => s.teamMembers);
  const loadTeams = useTeamStore((s) => s.loadTeams);
  const createTeam = useTeamStore((s) => s.createTeam);
  const renameTeam = useTeamStore((s) => s.renameTeam);
  const deleteTeam = useTeamStore((s) => s.deleteTeam);
  const addTeamMember = useTeamStore((s) => s.addTeamMember);
  const removeTeamMember = useTeamStore((s) => s.removeTeamMember);

  const [newTeamName, setNewTeamName] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [orgMembers, setOrgMembers] = useState<MemberProfile[]>([]);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeOrgId) loadTeams(activeOrgId);
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) return;
    (async () => {
      const { data: memberships } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("organization_id", activeOrgId);
      if (!memberships) return;
      const userIds = memberships.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      setOrgMembers(
        (profiles ?? []).map((p) => ({
          id: p.id,
          email: p.email ?? "",
          full_name: p.full_name ?? "",
        }))
      );
    })();
  }, [activeOrgId]);

  useEffect(() => {
    if (editingTeamId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTeamId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !newTeamName.trim()) return;
    await createTeam(newTeamName.trim(), activeOrgId);
    setNewTeamName("");
    toast({ title: "Team created" });
  };

  const handleRename = async (teamId: string) => {
    if (editName.trim()) {
      await renameTeam(teamId, editName.trim());
    }
    setEditingTeamId(null);
  };

  const membersOfTeam = (teamId: string) =>
    teamMembers.filter((m) => m.team_id === teamId);

  const nonMembers = (teamId: string) => {
    const memberUserIds = new Set(membersOfTeam(teamId).map((m) => m.user_id));
    return orgMembers.filter((m) => !memberUserIds.has(m.id));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4" /> Teams
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <form onSubmit={handleCreate} className="flex gap-2">
            <Input
              placeholder="New team name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={!newTeamName.trim()}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </form>
        )}

        {teams.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        )}

        <div className="space-y-2">
          {teams.map((team) => {
            const members = membersOfTeam(team.id);
            const isExpanded = expandedTeamId === team.id;
            return (
              <div key={team.id} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  {editingTeamId === team.id ? (
                    <input
                      ref={editInputRef}
                      className="text-sm font-medium bg-transparent border-b border-primary/40 outline-none flex-1 mr-2"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(team.id);
                        if (e.key === "Escape") setEditingTeamId(null);
                      }}
                      onBlur={() => handleRename(team.id)}
                    />
                  ) : (
                    <button
                      className="text-sm font-medium text-left flex-1 flex items-center gap-2"
                      onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                    >
                      {team.name}
                      <Badge variant="outline" className="text-[10px]">
                        {members.length} member{members.length !== 1 ? "s" : ""}
                      </Badge>
                    </button>
                  )}
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => {
                          setEditName(team.name);
                          setEditingTeamId(team.id);
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => deleteTeam(team.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="space-y-2 pt-2 border-t">
                    {members.map((m) => {
                      const profile = orgMembers.find((p) => p.id === m.user_id);
                      return (
                        <div key={m.id} className="flex items-center justify-between text-sm">
                          <span>{profile?.full_name || profile?.email || m.user_id}</span>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-destructive"
                              onClick={() => removeTeamMember(team.id, m.user_id)}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {canManage && nonMembers(team.id).length > 0 && (
                      <Select
                        onValueChange={(userId) => addTeamMember(team.id, userId)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <div className="flex items-center gap-1">
                            <UserPlus className="w-3 h-3" />
                            <SelectValue placeholder="Add member..." />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {nonMembers(team.id).map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.full_name || m.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
