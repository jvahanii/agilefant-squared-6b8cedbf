import { useMemo, useState } from "react";
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
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Users, Check } from "lucide-react";

interface TeamAssignmentCellProps {
  workItemId: string;
}

const EMPTY_ARRAY: string[] = [];

export function TeamAssignmentCell({ workItemId }: TeamAssignmentCellProps) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const teams = useTeamStore((s) => s.teams);
  const workItemTeams = useTeamStore((s) => s.workItemTeams[workItemId] ?? EMPTY_ARRAY);
  const assignTeam = useTeamStore((s) => s.assignTeamToWorkItem);
  const unassignTeam = useTeamStore((s) => s.unassignTeamFromWorkItem);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const assignedTeams = useMemo(
    () => teams.filter((t) => workItemTeams.includes(t.id)),
    [teams, workItemTeams]
  );

  if (teams.length === 0) return null;

  const trigger = (
    <button
      className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        if (isMobile) setDrawerOpen(true);
      }}
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
        <Users className={`w-3 h-3 transition-opacity ${isMobile ? "opacity-30" : "opacity-0 group-hover:opacity-40"}`} />
      )}
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent onClick={(e) => e.stopPropagation()}>
            <DrawerHeader className="pb-2">
              <DrawerTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                Assign Teams
              </DrawerTitle>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-1">
              {teams.map((team) => {
                const isAssigned = workItemTeams.includes(team.id);
                return (
                  <button
                    key={team.id}
                    className="w-full flex items-center justify-between px-3 py-3 rounded-lg text-sm hover:bg-accent active:bg-accent/80 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isAssigned) {
                        unassignTeam(workItemId, team.id);
                      } else {
                        assignTeam(workItemId, team.id, activeOrgId!);
                      }
                    }}
                  >
                    <span>{team.name}</span>
                    {isAssigned && <Check className="w-4 h-4 text-primary" />}
                  </button>
                );
              })}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
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
                  assignTeam(workItemId, team.id, activeOrgId!);
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
