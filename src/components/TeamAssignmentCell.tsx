import { useMemo } from "react";
import { useTeamStore } from "@/store/teamStore";
import { useOrgStore } from "@/store/orgStore";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Users } from "lucide-react";

interface TeamAssignmentCellProps {
  workItemId: string;
}

const EMPTY_ARRAY: string[] = [];

export function TeamAssignmentCell({ workItemId }: TeamAssignmentCellProps) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId); // fallback only
  const teams = useTeamStore((s) => s.teams);
  const workItemTeams = useTeamStore((s) => s.workItemTeams[workItemId] ?? EMPTY_ARRAY);
  const assignTeam = useTeamStore((s) => s.assignTeamToWorkItem);
  const unassignTeam = useTeamStore((s) => s.unassignTeamFromWorkItem);
  const isMobile = useIsMobile();

  const assignedTeams = useMemo(
    () => teams.filter((t) => workItemTeams.includes(t.id)),
    [teams, workItemTeams]
  );

  if (teams.length === 0) return null;

  if (isMobile) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {assignedTeams.length > 0 ? (
            assignedTeams.map((t) => (
              <Badge
                key={t.id}
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 leading-tight"
              >
                {t.name}
              </Badge>
            ))
          ) : (
            <Users className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]" onClick={(e) => e.stopPropagation()}>
        {teams.map((team) => {
          const isAssigned = workItemTeams.includes(team.id);
          return (
            <DropdownMenuCheckboxItem
              key={team.id}
              checked={isAssigned}
              onCheckedChange={(checked) => {
                if (checked) {
                  assignTeam(workItemId, team.id, team.organization_id || activeOrgId!);
                } else {
                  unassignTeam(workItemId, team.id);
                }
              }}
              className="text-xs"
            >
              {team.name}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
