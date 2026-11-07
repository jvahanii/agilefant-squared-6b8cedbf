/**
 * A row's teams: the names after its title, which open a picker, and the same
 * picker as a submenu of the row's right-click menu. Both act on the selection
 * when the row is part of one.
 */
import { useRef, useState } from "react";
import { Search, Users, X } from "lucide-react";
import { useTeamStore, type Team } from "@/store/teamStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { EMPTY_ARRAY, selectionOrItem, type ActOn } from "./rowShared";

/** How many of `ids` have the team: all, some or none of them. */
function teamAssignment(ids: string[], teamId: string) {
  const all = useTeamStore.getState().workItemTeams;
  const assignedCount = ids.filter((id) => (all[id] ?? EMPTY_ARRAY).includes(teamId)).length;
  const fullyAssigned = assignedCount === ids.length;
  return { assignedCount, fullyAssigned, partiallyAssigned: assignedCount > 0 && !fullyAssigned };
}

/** Take the team off all of `ids` when all have it, otherwise give it to those without. */
function toggleTeam(ids: string[], team: Team, fallbackOrgId: string | null) {
  const store = useTeamStore.getState();
  if (teamAssignment(ids, team.id).fullyAssigned) {
    ids.forEach((id) => store.unassignTeamFromWorkItem(id, team.id));
    return;
  }
  ids.forEach((id) => {
    const has = useTeamStore.getState().workItemTeams[id] ?? EMPTY_ARRAY;
    if (!has.includes(team.id)) store.assignTeamToWorkItem(id, team.id, team.organization_id || fallbackOrgId!);
  });
}

/** A team as a choice: filled when all have it, half when some do. */
function TeamChoice({ team, ids }: { team: Team; ids: string[] }) {
  const { assignedCount, fullyAssigned, partiallyAssigned } = teamAssignment(ids, team.id);
  return (
    <>
      <span
        className="w-2.5 h-2.5 rounded-full mr-1 shrink-0 inline-block"
        style={{
          backgroundColor: fullyAssigned ? "hsl(var(--primary))" : partiallyAssigned ? "hsl(var(--primary) / 0.4)" : "transparent",
          border: fullyAssigned ? "none" : "1px solid hsl(var(--muted-foreground)/0.4)",
        }}
      />
      {team.name}
      {partiallyAssigned && <span className="ml-1 text-[10px] text-muted-foreground">({assignedCount}/{ids.length})</span>}
    </>
  );
}

/** The search box at the top of a menu of choices. */
export function MenuSearchField({
  placeholder,
  value,
  onChange,
  stopClicks = false,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Keep clicks in the box from reaching the menu around it. */
  stopClicks?: boolean;
}) {
  return (
    <div className="px-2 pt-1 pb-0.5" onClick={stopClicks ? (e) => e.stopPropagation() : undefined}>
      <div className="flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5">
        <Search className="w-3 h-3 text-muted-foreground shrink-0" />
        <input
          className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {value && (
          <button className="text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); onChange(""); }}>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

const matching = (teams: Team[], query: string) =>
  teams.filter((t) => !query.trim() || t.name.toLowerCase().includes(query.toLowerCase()));

/** The team names after a row's title — or a people icon — opening the picker. */
export function RowTeamsDropdown({
  workItemId,
  teams,
  activeOrgId,
  open,
  onOpenChange,
}: {
  workItemId: string;
  teams: Team[];
  activeOrgId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workItemTeams = useTeamStore((s) => s.workItemTeams[workItemId] ?? EMPTY_ARRAY);
  const [query, setQuery] = useState("");
  // Choosing a team keeps the picker open, for the next one.
  const keepOpenRef = useRef(false);
  return (
    <span className="ml-1 text-muted-foreground inline-flex items-center gap-0.5">
      <DropdownMenu
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen && keepOpenRef.current) {
            keepOpenRef.current = false;
            return;
          }
          onOpenChange(isOpen);
        }}
      >
        <DropdownMenuTrigger asChild>
          <span className="inline-flex items-center gap-0.5 cursor-pointer hover:bg-muted rounded px-0.5 -ml-0.5 transition-colors">
            {workItemTeams.length > 0 ? (
              workItemTeams.map((teamId, i) => (
                <span key={teamId}>
                  {i > 0 && <span>, </span>}
                  {teams.find((t) => t.id === teamId)?.name ?? teamId}
                </span>
              ))
            ) : (
              <Users className="w-3 h-3 text-muted-foreground/50" />
            )}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[120px]" onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}>
          <MenuSearchField placeholder="Search teams…" value={query} onChange={setQuery} stopClicks />
          {matching(teams, query).map((team) => {
            const ids = selectionOrItem(workItemId);
            return (
              <DropdownMenuItem
                key={team.id}
                className="text-xs"
                onSelect={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  keepOpenRef.current = true;
                  toggleTeam(ids, team, activeOrgId);
                }}
              >
                <TeamChoice team={team} ids={ids} />
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** "Assign teams" in the row's right-click menu. */
export function TeamsSubmenu({ actOn, teams, activeOrgId }: { actOn: ActOn; teams: Team[]; activeOrgId: string | null }) {
  const [query, setQuery] = useState("");
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="text-xs">Assign teams</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <MenuSearchField placeholder="Search teams…" value={query} onChange={setQuery} />
        {matching(teams, query).map((team) => {
          const ids = actOn();
          return (
            <ContextMenuItem
              key={team.id}
              className="text-xs"
              onSelect={(e) => e.preventDefault()}
              onClick={() => toggleTeam(ids, team, activeOrgId)}
            >
              <TeamChoice team={team} ids={ids} />
            </ContextMenuItem>
          );
        })}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
