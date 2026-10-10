import { CalendarPlus, CalendarRange, Eye, Globe, Hash, Lock, LockOpen, Settings2, SlidersHorizontal, Star, Tag, Trash2, TrendingUp } from "lucide-react";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore, usePublicLinksEnabled, useScramblingEnabled } from "@/store/orgSettingsStore";
import { useBurnupDialogStore } from "@/store/burnupDialogStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { useCreatedDatesEnabled } from "@/lib/workItemCreated";
import { useStartEndDatesEnabled } from "@/lib/workItemStartEnd";
import { usePointsVisibleForTree } from "@/lib/pointsVisibility";
import { scrambleName } from "@/lib/scramble";
import { planListScramble } from "@/lib/listScramble";
import { peekCurrentUser } from "@/lib/currentUser";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { useScrambledListsStore } from "@/store/scrambledListsStore";
import { useListScrambleStore } from "@/store/listScrambleStore";
import { ICON_MAP, ICON_SHORTCODES } from "@/lib/iconMap";

interface BacklogContextMenuItemsProps {
  backlogId: string;
  treeId: string;
  isScrambled?: boolean;
  /** Put an icon shortcode into the name — where there is a name being edited,
   *  at the cursor. */
  onInsertIcon: (shortcode: string) => void;
  onAttributes: () => void;
  onStatuses: () => void;
  onPoints: () => void;
  onPublish: () => void;
  onDelete: () => void;
}

/**
 * A backlog's right-click menu, the same wherever the backlog is right-clicked:
 * in the tree on the left, or in the header over its list on the right.
 *
 * It used to be written out in both places, and they drifted — the header had
 * three of its nine items, and offered Statuses… even where custom statuses
 * were off. Which items appear is decided here; the dialogs they open belong to
 * whichever place hosts the menu.
 */
export function BacklogContextMenuItems({
  backlogId,
  treeId,
  isScrambled,
  onInsertIcon,
  onAttributes,
  onStatuses,
  onPoints,
  onPublish,
  onDelete,
}: BacklogContextMenuItemsProps) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const setBacklogRatingsEnabled = useAppStore((s) => s.setBacklogRatingsEnabled);
  const setBacklogCreatedDatesEnabled = useAppStore((s) => s.setBacklogCreatedDatesEnabled);
  const setBacklogStartEndDatesEnabled = useAppStore((s) => s.setBacklogStartEndDatesEnabled);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const customStatusesEnabled = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""]?.customStatusesEnabled ?? true,
  );
  const burnupsEnabled = useOrgSettingsStore(
    (s) => (s.settings[activeOrgId ?? ""] as { burnupsEnabled?: boolean })?.burnupsEnabled ?? false,
  );
  const pointsVisible = usePointsVisibleForTree(treeId);
  const ratingsEnabled = useRatingsEnabled();
  const createdDatesEnabled = useCreatedDatesEnabled();
  const startEndDatesEnabled = useStartEndDatesEnabled();
  const publicLinksEnabled = usePublicLinksEnabled();
  // Labels on the list itself. They could already be given from the small tag
  // button a list's row shows on hover; here they are where everything else
  // about a list is, and where a touch screen can reach them.
  const labelsEnabled = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const allLabels = useLabelsStore((s) => s.labels);
  const assignedLabelIds = useLabelsStore((s) => s.byEntity[`backlog:${backlogId}`]);
  const assignLabel = useLabelsStore((s) => s.assignLabel);
  const unassignLabel = useLabelsStore((s) => s.unassignLabel);
  const orgLabels = Object.values(allLabels)
    .filter((label) => label.organizationId === activeOrgId)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Scrambling the list: its name, the lists under it and every item in them,
  // for everyone, until the person who did it puts them back. (Not the
  // `isScrambled` above, which only changes what this screen shows.)
  // Offered where the organization has scrambling on; a list that is scrambled
  // already keeps its entries either way, so it can always be put back.
  const scramblingEnabled = useScramblingEnabled();
  const scrambledLists = useScrambledListsStore((s) => s.byList);
  const scrambledItems = useScrambledItemsStore((s) => s.byItem);
  const backlogs = useAppStore((s) => s.backlogs);
  const workItems = useAppStore((s) => s.workItems);

  if (!backlog) return null;
  const name = isScrambled ? scrambleName(backlog.name) : backlog.name;
  const nameScrambled = scrambledLists.has(backlogId);
  const me = peekCurrentUser()?.id ?? null;
  const scrambledByMe = me !== null && scrambledLists.get(backlogId) === me;
  // What is in a scrambled list and still readable. The database scrambles
  // what is put into one as it arrives, so this is the exception: a whole
  // list moved under it, or something that was there before that was so.
  const addedSince = scrambledByMe
    ? (() => {
        const plan = planListScramble(backlogId, backlogs, workItems, scrambledLists, scrambledItems);
        return plan.lists.length + plan.items.length;
      })()
    : 0;

  return (
    <>
      <ContextMenuLabel className="text-xs truncate">{name}</ContextMenuLabel>
      <ContextMenuSeparator />
      {/* An icon is typed into the name, and a scrambled name cannot be edited. */}
      {!nameScrambled && (
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs">Insert icon</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-60 overflow-y-auto w-56 max-w-[calc(100vw-1.5rem)]" collisionPadding={8}>
          <div className="grid grid-cols-6 gap-0.5 p-1">
            {ICON_SHORTCODES.map((sc) => (
              <button
                key={sc}
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent text-lg"
                title={`:${sc}:`}
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertIcon(`:${sc}:`);
                }}
              >
                {ICON_MAP[sc]}
              </button>
            ))}
          </div>
        </ContextMenuSubContent>
      </ContextMenuSub>
      )}
      <ContextMenuItem className="text-xs" onSelect={onAttributes}>
        <SlidersHorizontal className="w-3 h-3 mr-2" />
        Attributes
      </ContextMenuItem>
      {customStatusesEnabled && (
        <ContextMenuItem className="text-xs" onSelect={onStatuses}>
          <Settings2 className="w-3 h-3 mr-2" />
          Statuses…
        </ContextMenuItem>
      )}
      {burnupsEnabled && (
        <ContextMenuItem
          className="text-xs"
          onSelect={() => useBurnupDialogStore.getState().openBurnup({ kind: "backlog", id: backlogId, name: backlog.name })}
        >
          <TrendingUp className="w-3 h-3 mr-2" />
          View burnup…
        </ContextMenuItem>
      )}
      {/* An estimate for the whole backlog, before its work is broken down. */}
      {pointsVisible && (
        <ContextMenuItem className="text-xs" onSelect={onPoints}>
          <Hash className="w-3 h-3 mr-2" />
          {backlog.points != null ? "Change points…" : "Set points…"}
        </ContextMenuItem>
      )}
      {/* Each backlog decides for itself, starting off: stars earn their place
          on a shortlist and are noise on a sprint backlog. */}
      {ratingsEnabled && (
        <ContextMenuCheckboxItem
          className="text-xs"
          checked={backlog.ratingsEnabled ?? false}
          onCheckedChange={(checked) => setBacklogRatingsEnabled(backlogId, checked === true)}
        >
          <Star className="w-3 h-3 mr-2" />
          Star ratings
        </ContextMenuCheckboxItem>
      )}
      {/* The same choice for created dates: worth a column on a list where
          arrival order matters, clutter on one where it does not. Offered only
          where the organization has created dates on at all. */}
      {createdDatesEnabled && (
        <ContextMenuCheckboxItem
          className="text-xs"
          checked={backlog.createdDatesEnabled ?? false}
          onCheckedChange={(checked) => setBacklogCreatedDatesEnabled(backlogId, checked === true)}
        >
          <CalendarPlus className="w-3 h-3 mr-2" />
          Created dates
        </ContextMenuCheckboxItem>
      )}
      {/* And for start and end dates. The dates themselves are set from an
          item's menu wherever the organization has them on; this is only
          whether this list's rows show them. */}
      {startEndDatesEnabled && (
        <ContextMenuCheckboxItem
          className="text-xs"
          checked={backlog.startEndDatesEnabled ?? false}
          onCheckedChange={(checked) => setBacklogStartEndDatesEnabled(backlogId, checked === true)}
        >
          <CalendarRange className="w-3 h-3 mr-2" />
          Start and end dates
        </ContextMenuCheckboxItem>
      )}
      {labelsEnabled && (
        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-xs">
            <Tag className="w-3 h-3 mr-2" />
            Labels
            {(assignedLabelIds?.length ?? 0) > 0 && (
              <span className="ml-1 tabular-nums text-muted-foreground">({assignedLabelIds!.length})</span>
            )}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 w-56 max-w-[calc(100vw-1.5rem)] overflow-y-auto" collisionPadding={8}>
            {orgLabels.length === 0 ? (
              <ContextMenuItem disabled className="text-xs">
                No labels yet. Create them under Bells &amp; Whistles → Labels.
              </ContextMenuItem>
            ) : (
              orgLabels.map((label) => (
                <ContextMenuCheckboxItem
                  key={label.id}
                  className="text-xs"
                  checked={assignedLabelIds?.includes(label.id) ?? false}
                  // Stays open: a list often takes more than one label.
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) => {
                    if (checked) void assignLabel(label.id, "backlog", backlogId, label.organizationId);
                    else void unassignLabel(label.id, "backlog", backlogId);
                  }}
                >
                  <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </ContextMenuCheckboxItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {!nameScrambled ? (
        scramblingEnabled && (
          <ContextMenuItem className="text-xs" onSelect={() => void useListScrambleStore.getState().scramble(backlogId)}>
            <Lock className="w-3 h-3 mr-2" />
            Scramble list…
          </ContextMenuItem>
        )
      ) : scrambledByMe ? (
        <>
          {/* Reading it back does not unscramble it: the list stays hidden
              from everyone else until it is explicitly unscrambled. */}
          <ContextMenuItem className="text-xs" onSelect={() => useListScrambleStore.getState().askReveal(backlogId)}>
            <Eye className="w-3 h-3 mr-2" />
            Show real name…
          </ContextMenuItem>
          {addedSince > 0 && (
            <ContextMenuItem className="text-xs" onSelect={() => void useListScrambleStore.getState().scramble(backlogId)}>
              <Lock className="w-3 h-3 mr-2" />
              Scramble what was added ({addedSince})
            </ContextMenuItem>
          )}
          <ContextMenuItem className="text-xs" onSelect={() => useListScrambleStore.getState().askUnscramble(backlogId)}>
            <LockOpen className="w-3 h-3 mr-2" />
            Unscramble list…
          </ContextMenuItem>
        </>
      ) : (
        <ContextMenuItem className="text-xs" disabled>
          <Lock className="w-3 h-3 mr-2" />
          Scrambled by someone else
        </ContextMenuItem>
      )}
      {publicLinksEnabled && (
        <ContextMenuItem className="text-xs" onSelect={onPublish}>
          <Globe className="w-3 h-3 mr-2" />
          Public link…
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem className="text-xs text-destructive focus:text-destructive" onSelect={onDelete}>
        <Trash2 className="w-3 h-3 mr-2" />
        Delete list
      </ContextMenuItem>
    </>
  );
}
