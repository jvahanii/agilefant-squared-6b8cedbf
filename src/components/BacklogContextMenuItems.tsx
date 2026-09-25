import { Globe, Hash, Settings2, SlidersHorizontal, Star, Trash2, TrendingUp } from "lucide-react";
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
import { useOrgSettingsStore, usePublicLinksEnabled } from "@/store/orgSettingsStore";
import { useBurnupDialogStore } from "@/store/burnupDialogStore";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { usePointsVisibleForTree } from "@/lib/pointsVisibility";
import { scrambleName } from "@/lib/scramble";
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
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const customStatusesEnabled = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""]?.customStatusesEnabled ?? true,
  );
  const burnupsEnabled = useOrgSettingsStore(
    (s) => (s.settings[activeOrgId ?? ""] as { burnupsEnabled?: boolean })?.burnupsEnabled ?? false,
  );
  const pointsVisible = usePointsVisibleForTree(treeId);
  const ratingsEnabled = useRatingsEnabled();
  const publicLinksEnabled = usePublicLinksEnabled();

  if (!backlog) return null;
  const name = isScrambled ? scrambleName(backlog.name) : backlog.name;

  return (
    <>
      <ContextMenuLabel className="text-xs truncate">{name}</ContextMenuLabel>
      <ContextMenuSeparator />
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
      {publicLinksEnabled && (
        <ContextMenuItem className="text-xs" onSelect={onPublish}>
          <Globe className="w-3 h-3 mr-2" />
          Public link…
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem className="text-xs text-destructive focus:text-destructive" onSelect={onDelete}>
        <Trash2 className="w-3 h-3 mr-2" />
        Delete backlog
      </ContextMenuItem>
    </>
  );
}
