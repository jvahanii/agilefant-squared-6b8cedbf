/**
 * A work item's right-click menu — the same wherever the item is shown: its
 * row in the list, its card on the board, its line in the search results.
 *
 * It was written out three times, and the copies drifted: the board's had no
 * dates or scrambling, the search results' lacked ten entries. Now each place
 * hands this menu its actions, and an entry is offered wherever its action
 * exists — renaming in place, say, only where the name can be edited.
 *
 * Drawn only while open, so what it keeps — the label and team searches, a
 * label being made — starts afresh each time. Entries act on `actOn()`: the
 * selection when the item is part of one, where items can be selected.
 */
import { useMemo, useRef, useState } from "react";
import { ArrowDownAZ, Bell, BellOff, CalendarClock, CalendarPlus, CalendarRange, FolderInput, LayoutGrid, List as ListIcon, Plus, Trash2, X } from "lucide-react";
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useTeamStore } from "@/store/teamStore";
import { useBurnupDialogStore } from "@/store/burnupDialogStore";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import {
  useSnoozeStore,
  snoozeOptionLaterToday,
  snoozeOptionTomorrowMorning,
  snoozeOptionNextWeek,
  snoozeOptionThisWeekend,
} from "@/store/snoozeStore";
import { useLabelsStore, type Label } from "@/store/labelsStore";
import type { WorkItem, WorkItemStatus } from "@/types/models";
import { scrambleName } from "@/lib/scramble";
import { peekCurrentUser } from "@/lib/currentUser";
import { ICON_MAP, ICON_SHORTCODES } from "@/lib/iconMap";
import { JiraItemMenuItems } from "../JiraItemMenuItems";
import { WorkItemDescriptionMenuItem } from "../WorkItemDescriptionDialog";
import { changeEach, type ActOn } from "./rowShared";
import { MenuSearchField, TeamsSubmenu } from "./RowTeams";
import type { ItemFeatures } from "./itemActions";
import type { RowDialogs } from "./useRowDialogs";

export interface ItemStatus {
  key: string;
  label: string;
  color: string;
  displayLabel: string;
}

/** What the item does, for its menu to call. The optional ones only some places can do. */
export interface ItemActions {
  duplicate: () => void;
  remove: () => void;
  openMoveToList: () => void;
  openReparent: () => void;
  scramble: () => void;
  snoozeUntil: (until: Date) => void;
  rankToTop: () => void;
  /** Where the name can be edited in place, or gone to and edited. */
  startRename?: () => void;
  /** Put an icon's shortcode into the name: at the cursor while it is being edited. */
  insertIcon?: (shortcode: string) => void;
  /** Edit the points in place; without it the menu opens the attributes sheet. */
  editPoints?: () => void;
  addChild?: () => void;
  /** The same item in the other view: "View in board" from the list, "View in list" from the board. */
  viewElsewhere?: { label: string; view: "board" | "list"; run: () => void };
}

export function ItemMenu({
  item,
  treeId,
  backlogId,
  moveTargets,
  statuses,
  features,
  isScrambled,
  actOn,
  dialogs,
  actions,
}: {
  item: WorkItem;
  treeId: string;
  backlogId: string;
  /** The lists "Move to list" offers. */
  moveTargets: string[];
  statuses: ItemStatus[];
  features: ItemFeatures;
  /** List names are shown scrambled. */
  isScrambled: boolean;
  actOn: ActOn;
  dialogs: RowDialogs;
  actions: ItemActions;
}) {
  const workItemId = item.id;
  const several = actOn().length > 1;
  const backlogs = useAppStore((s) => s.backlogs);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const teams = useTeamStore((s) => s.teams);
  const labelsMap = useLabelsStore((s) => s.labels);
  const orgLabels = useMemo(
    () => Object.values(labelsMap).filter((l) => l.organizationId === activeOrgId).sort((a, b) => a.name.localeCompare(b.name)),
    [labelsMap, activeOrgId],
  );
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(workItemId));
  const scrambledBy = useScrambledItemsStore((s) => s.byItem.get(workItemId));
  const isNameScrambled = useScrambledItemsStore((s) => s.byItem.has(workItemId));
  const scrambledByMe = isNameScrambled && scrambledBy === (peekCurrentUser()?.id ?? null);
  const currentList = item.backlogAssignments[treeId] ?? backlogId;
  const { show } = dialogs;

  // An entry that opens a field in place — the name, the points, a new child —
  // runs once the menu has closed. Run at once, its field took the focus while
  // the closing menu still held it, and the menu took it straight back, then
  // handed it to the item: what was typed went nowhere, and Escape did not
  // cancel. So it waits for the menu to let go, and the menu does not hand
  // the focus to the item instead.
  const afterClose = useRef<(() => void) | null>(null);
  const inPlace = (act: (() => void) | undefined) =>
    act &&
    (() => {
      afterClose.current = act;
    });
  const startRename = inPlace(actions.startRename);
  const editPoints = inPlace(actions.editPoints);
  const addChild = inPlace(actions.addChild);
  // The icons sit in a submenu that stays open for the next one: at once.
  const insertIcon = actions.insertIcon;

  return (
    <ContextMenuContent
      className="w-52"
      onCloseAutoFocus={(e) => {
        const run = afterClose.current;
        if (!run) return;
        afterClose.current = null;
        e.preventDefault();
        run();
      }}
    >
      <ContextMenuLabel className="text-xs truncate">{item.title}</ContextMenuLabel>
      <ContextMenuSeparator />
      <JiraItemMenuItems workItemId={item.id} />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs">
          <span
            className="w-2 h-2 rounded-full mr-2 shrink-0 inline-block"
            style={{ backgroundColor: statuses.find((s) => s.key === item.status)?.color ?? "#94a3b8" }}
          />
          Status
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup
            value={item.status}
            onValueChange={(val) => {
              const { setWorkItemStatus } = useAppStore.getState();
              changeEach(actOn(), (id) => setWorkItemStatus(id, val as WorkItemStatus));
            }}
          >
            {statuses.map((s) => (
              <ContextMenuRadioItem key={s.key} value={s.key} className="text-xs">
                <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: s.color }} />
                {s.displayLabel}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {features.deadlines && (
        <ContextMenuItem className="text-xs" onSelect={() => show("deadline")}>
          <CalendarClock className="w-3 h-3 mr-2" />
          {item.deadline ? "Change deadline…" : "Set deadline…"}
        </ContextMenuItem>
      )}
      {features.createdDates && (
        <ContextMenuItem className="text-xs" onSelect={() => show("createdDate")}>
          <CalendarPlus className="w-3 h-3 mr-2" />
          {item.createdOn ? "Change created date…" : "Set created date…"}
        </ContextMenuItem>
      )}
      {features.startEndDates && (
        <ContextMenuItem className="text-xs" onSelect={() => show("startEnd")}>
          <CalendarRange className="w-3 h-3 mr-2" />
          {item.startedOn || item.endedOn ? "Change start and end dates…" : "Set start and end dates…"}
        </ContextMenuItem>
      )}
      {actions.viewElsewhere && (
        <ContextMenuItem className="text-xs" onSelect={actions.viewElsewhere.run}>
          {actions.viewElsewhere.view === "board" ? <LayoutGrid className="w-3 h-3 mr-2" /> : <ListIcon className="w-3 h-3 mr-2" />}
          {actions.viewElsewhere.label}
        </ContextMenuItem>
      )}
      {features.burnups && (
        <ContextMenuItem
          className="text-xs"
          onSelect={() =>
            useBurnupDialogStore.getState().openBurnup({ kind: "work_item", id: workItemId, name: item.title, treeId })
          }
        >
          View burnup…
        </ContextMenuItem>
      )}
      <ContextMenuItem className="text-xs" onSelect={actions.rankToTop}>
        Rank to top
      </ContextMenuItem>
      {insertIcon && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-xs">Insert icon</ContextMenuSubTrigger>
          <ContextMenuSubContent
            className="max-h-60 overflow-y-auto w-56 max-w-[calc(100vw-1.5rem)]"
            collisionPadding={8}
          >
            <div className="grid grid-cols-6 gap-0.5 p-1">
              {ICON_SHORTCODES.map((sc) => (
                <button
                  key={sc}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent text-lg"
                  title={`:${sc}:`}
                  onClick={(e) => {
                    e.stopPropagation();
                    insertIcon(`:${sc}:`);
                  }}
                >
                  {ICON_MAP[sc]}
                </button>
              ))}
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <WorkItemDescriptionMenuItem onOpen={() => show("description")} />
      {/* A scrambled name cannot be edited — the database refuses it, since
          a rename would be lost when the original is put back, and would
          let anyone replace a name they cannot read. */}
      {!isNameScrambled && startRename && (
        <ContextMenuItem className="text-xs" onSelect={startRename}>
          Rename
        </ContextMenuItem>
      )}
      {!isNameScrambled ? (
        features.scrambling && (
          <ContextMenuItem className="text-xs" onSelect={actions.scramble}>
            Scramble {several ? "names" : "name"}…
          </ContextMenuItem>
        )
      ) : scrambledByMe ? (
        <>
          {/* Revealing is always about this one item; a dialog cannot show
              several names at once, and each is worth asking for. */}
          <ContextMenuItem className="text-xs" onSelect={() => show("scramble", { kind: "reveal", mode: "enter" })}>
            Show real name…
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={() => show("scramble", { kind: "unscramble", mode: "enter" })}>
            Unscramble {several ? "names" : "name"}…
          </ContextMenuItem>
        </>
      ) : (
        <ContextMenuItem className="text-xs" disabled>
          Scrambled by someone else
        </ContextMenuItem>
      )}
      <ContextMenuItem className="text-xs" onSelect={actions.duplicate}>
        Duplicate
        <span className="ml-auto text-[10px] text-muted-foreground">⌘D</span>
      </ContextMenuItem>
      {features.points && (
        // Where the points cannot be edited in place (on a phone, in the
        // search results) the attributes sheet has them.
        <ContextMenuItem className="text-xs" onSelect={() => (editPoints ? editPoints() : show("attributes"))}>
          Edit story points
        </ContextMenuItem>
      )}

      {addChild && (
        <ContextMenuItem className="text-xs" onSelect={addChild}>
          Add child item
        </ContextMenuItem>
      )}
      {item.childrenIds.length > 1 && (
        <ContextMenuItem className="text-xs" onSelect={() => show("sortChildren")}>
          <ArrowDownAZ className="w-3 h-3 mr-1.5 shrink-0" />
          Sort children A→Z
        </ContextMenuItem>
      )}
      <ContextMenuItem className="text-xs" onSelect={actions.openMoveToList}>
        <FolderInput className="w-3 h-3 mr-1.5 shrink-0" />
        Move…
        <span className="ml-auto text-[10px] text-muted-foreground">M</span>
      </ContextMenuItem>
      {moveTargets.length > 1 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-xs">
            Move to list
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {moveTargets
              .filter((blId) => blId !== currentList)
              .map((blId) => (
                <ContextMenuItem
                  key={blId}
                  className="text-xs"
                  onSelect={() => useAppStore.getState().moveWorkItemsToBacklog(actOn(), blId, treeId)}
                >
                  {isScrambled ? scrambleName(backlogs[blId]?.name ?? blId) : (backlogs[blId]?.name ?? blId)}
                </ContextMenuItem>
              ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuItem className="text-xs" onSelect={actions.openReparent}>
        Reparent…
      </ContextMenuItem>
      <ContextMenuSeparator />
      {features.labels && orgLabels.length > 0 && (
        <LabelsSubmenu actOn={actOn} orgLabels={orgLabels} activeOrgId={activeOrgId} onDelete={(id) => show("deleteLabel", id)} />
      )}
      {teams.length > 0 && <TeamsSubmenu actOn={actOn} teams={teams} activeOrgId={activeOrgId} />}
      {features.timeLogging && (
        <>
          <ContextMenuItem className="text-xs" onSelect={() => show("timeLog")}>
            Log time
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={() => {
            const ids = Object.values(useTimeEntryStore.getState().timeEntries)
              .filter((e) => e.workItemId === workItemId)
              .map((e) => e.id);
            show("moveTime", ids);
          }}>
            Transfer time entries
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs">
          <BellOff className="w-3 h-3 mr-2" />
          Snooze
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem className="text-xs" onSelect={() => actions.snoozeUntil(snoozeOptionLaterToday())}>
            <span className="flex-1">Later Today</span>
            <span className="ml-4 text-muted-foreground text-[10px]">3h from now</span>
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={() => actions.snoozeUntil(snoozeOptionTomorrowMorning())}>
            <span className="flex-1">Tomorrow Morning</span>
            <span className="ml-4 text-muted-foreground text-[10px]">7:00 AM</span>
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={() => actions.snoozeUntil(snoozeOptionThisWeekend())}>
            <span className="flex-1">This Weekend</span>
            <span className="ml-4 text-muted-foreground text-[10px]">Sat 7:00 AM</span>
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={() => actions.snoozeUntil(snoozeOptionNextWeek())}>
            <span className="flex-1">Next Week</span>
            <span className="ml-4 text-muted-foreground text-[10px]">Mon 7:00 AM</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-xs" onSelect={() => show("snooze")}>
            Pick Date / Time…
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {isSnoozed && (
        <ContextMenuItem className="text-xs" onSelect={() => useSnoozeStore.getState().unsnoozeWorkItem(workItemId)}>
          <Bell className="w-3 h-3 mr-2" />
          Unsnooze
        </ContextMenuItem>
      )}
      <ContextMenuItem className="text-xs" onSelect={() => show("respawn")}>
        Respawn settings
      </ContextMenuItem>
      <ContextMenuItem className="text-xs" onSelect={() => show("hyperlinks")}>
        Hyperlinks
      </ContextMenuItem>
      {features.savingsIncome && (
        <ContextMenuItem className="text-xs" onSelect={() => show("financials")}>
          Savings &amp; Income
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        className="text-xs text-destructive focus:text-destructive"
        onSelect={actions.remove}
      >
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** "Labels": tick the ones the item (or selection) has, make a new one, or delete one. */
function LabelsSubmenu({
  actOn,
  orgLabels,
  activeOrgId,
  onDelete,
}: {
  actOn: ActOn;
  orgLabels: Label[];
  activeOrgId: string | null;
  onDelete: (labelId: string) => void;
}) {
  const byEntity = useLabelsStore((s) => s.byEntity);
  const [query, setQuery] = useState("");
  const [newLabelForm, setNewLabelForm] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6366f1");
  const newLabelNameRef = useRef<HTMLInputElement>(null);

  const closeForm = () => {
    setNewLabelForm(false);
    setNewLabelName("");
  };
  const createAndAssign = async () => {
    if (!activeOrgId || !newLabelName.trim()) return;
    const { createLabel, assignLabel } = useLabelsStore.getState();
    const label = await createLabel(activeOrgId, newLabelName.trim(), newLabelColor);
    if (label) actOn().forEach((id) => assignLabel(label.id, "work_item", id, activeOrgId));
    closeForm();
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="text-xs">Labels</ContextMenuSubTrigger>
      <ContextMenuSubContent
        className="max-h-60 overflow-y-auto w-56 max-w-[calc(100vw-1.5rem)]"
        collisionPadding={8}
      >
        <MenuSearchField placeholder="Search labels…" value={query} onChange={setQuery} />
        {orgLabels
          .filter((l) => !query.trim() || l.name.toLowerCase().includes(query.toLowerCase()))
          .map((label) => {
            const contextIds = actOn();
            const assignedCount = contextIds.filter((id) => (byEntity[`work_item:${id}`] ?? []).includes(label.id)).length;
            const fullyAssigned = assignedCount === contextIds.length;
            const partiallyAssigned = assignedCount > 0 && !fullyAssigned;
            return (
              <ContextMenuCheckboxItem
                key={label.id}
                className="text-xs pr-1"
                checked={fullyAssigned}
                data-partially={partiallyAssigned || undefined}
                onCheckedChange={(checked) => {
                  const { assignLabel, unassignLabel } = useLabelsStore.getState();
                  if (checked) {
                    contextIds.forEach((id) => assignLabel(label.id, "work_item", id, label.organizationId));
                  } else {
                    contextIds.forEach((id) => unassignLabel(label.id, "work_item", id));
                  }
                }}
              >
                <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: label.color }} />
                <span className="flex-1 min-w-0 truncate">{label.name}</span>
                {partiallyAssigned && <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">({assignedCount}/{contextIds.length})</span>}
                <button
                  className="ml-1 shrink-0 p-1 -my-1 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(label.id); }}
                  title={`Delete label "${label.name}"`}
                  aria-label={`Delete label ${label.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </ContextMenuCheckboxItem>
            );
          })}
        <ContextMenuSeparator />
        {newLabelForm ? (
          <div className="px-2 py-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0" />
              <input
                ref={newLabelNameRef}
                className="flex-1 text-xs bg-transparent border-b border-primary/40 outline-none px-1 py-0.5"
                placeholder="Label name…"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createAndAssign();
                  if (e.key === "Escape") closeForm();
                  e.stopPropagation();
                }}
              />
              <button className="text-muted-foreground hover:text-foreground" onClick={closeForm}><X className="w-3.5 h-3.5" /></button>
            </div>
            <button className="w-full text-xs text-center py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={!newLabelName.trim()} onClick={() => void createAndAssign()}>Create</button>
          </div>
        ) : (
          <ContextMenuItem className="text-xs" onSelect={(e) => { e.preventDefault(); setNewLabelForm(true); setQuery(""); }}>
            <Plus className="w-3 h-3 mr-2" /> New label
          </ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
