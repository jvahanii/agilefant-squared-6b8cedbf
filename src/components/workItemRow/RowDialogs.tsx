/** The dialogs and prompts a row opens, each drawn only while open. */
import { useAppStore } from "@/store/appStore";
import { useLabelsStore } from "@/store/labelsStore";
import { isSavingsIncomeEnabled } from "@/store/orgSettingsStore";
import { useDeleteWithTimeGuard } from "@/hooks/useDeleteWithTimeGuard";
import { toast } from "@/hooks/use-toast";
import type { WorkItem } from "@/types/models";
import { ActionPrompt } from "../ActionPrompt";
import { MoveToParentDialog } from "../MoveToParentDialog";
import { MoveToBacklogDialog } from "../MoveToBacklogDialog";
import { RespawnSettingsDialog } from "../RespawnSettingsDialog";
import { HyperlinksDialog } from "../HyperlinksDialog";
import { WorkItemDescriptionDialog } from "../WorkItemDescriptionDialog";
import { TimeLogDialog } from "../TimeLogDialog";
import { MoveTimeDialog } from "../MoveTimeDialog";
import { FinancialsDialog } from "../FinancialsDialog";
import { SnoozeDialog } from "../SnoozeDialog";
import { DeadlineDialog } from "../DeadlineDialog";
import { CreatedDateDialog } from "../CreatedDateDialog";
import { StartEndDatesDialog } from "../StartEndDatesDialog";
import { MobileWorkItemAttributesSheet } from "../MobileAttributesSheet";
import { ScramblePinDialog } from "../ScramblePinDialog";
import { listAndSublists, selectionOrItem } from "./rowShared";
import { runReveal, runScramble, runUnscramble } from "./scrambleActions";
import type { RowActions } from "./RowMenu";
import type { RowDialogs as Dialogs } from "./useRowDialogs";

export function RowDialogs({
  item,
  treeId,
  backlogId,
  activeOrgId,
  timeLoggingVisible,
  dialogs,
  actions,
}: {
  item: WorkItem;
  treeId: string;
  backlogId: string;
  activeOrgId: string | null;
  timeLoggingVisible: boolean;
  dialogs: Dialogs;
  actions: RowActions;
}) {
  const { open, show, hide, onOpenChange } = dialogs;
  const workItemId = item.id;
  const guardedDeleteBulk = useDeleteWithTimeGuard();
  const labelsMap = useLabelsStore((s) => s.labels);

  const deleteItemIds = open.deleteChoice;
  const handleDeleteChoice = (value: string) => {
    if (!deleteItemIds) return;
    hide("deleteChoice");
    const { removeWorkItemsFromTreeBulk, deleteWorkItemsBulk, workItems } = useAppStore.getState();
    if (value === "remove-from-backlog") removeWorkItemsFromTreeBulk(deleteItemIds.map((id) => ({ workItemId: id, treeId })));
    else if (value === "delete-everywhere") {
      const targets = deleteItemIds.map((id) => ({ kind: "work_item" as const, id }));
      const label = deleteItemIds.length === 1 ? (workItems[deleteItemIds[0]]?.title ?? "this item") : `${deleteItemIds.length} items`;
      guardedDeleteBulk(targets, label, () => deleteWorkItemsBulk(deleteItemIds));
    }
  };
  const deleteLabelId = open.deleteLabel;
  const scramblePrompt = open.scramble;

  return (
    <>
      {deleteItemIds && (
        <ActionPrompt
          title={deleteItemIds.length > 1 ? `Delete ${deleteItemIds.length} selected items?` : `"${item.title}" is in ${Object.keys(item.backlogAssignments).length} lists`}
          options={[
            {
              label: "Remove from this list",
              description: deleteItemIds.length > 1
                ? `Remove all selected items from this list only. Keeps them in other lists.`
                : `Remove from "${useAppStore.getState().backlogs[item.backlogAssignments[treeId]]?.name}" only. Keeps it in other lists.`,
              value: "remove-from-backlog",
              isDefault: true,
            },
            {
              label: "Delete everywhere",
              description: deleteItemIds.length > 1
                ? "Permanently delete all selected items from all lists."
                : "Permanently delete this item from all lists.",
              value: "delete-everywhere",
              variant: "destructive",
            },
          ]}
          onSelect={handleDeleteChoice}
          onCancel={() => hide("deleteChoice")}
        />
      )}
      {open.sortChildren && (
        <ActionPrompt
          title="Sort children A→Z?"
          options={[
            {
              label: "Sort A→Z",
              description: "Sorts children alphabetically. You can undo with Ctrl+Z.",
              value: "confirm",
              isDefault: true,
            },
          ]}
          onSelect={() => {
            useAppStore.getState().sortChildrenAlphabetically(workItemId, treeId, listAndSublists(backlogId));
            toast({ title: "Children sorted A→Z", description: "Press Ctrl+Z to undo" });
            hide("sortChildren");
          }}
          onCancel={() => hide("sortChildren")}
        />
      )}
      {deleteLabelId && (
        <ActionPrompt
          title={`Delete label "${labelsMap[deleteLabelId]?.name ?? deleteLabelId}"?`}
          options={[
            {
              label: "Delete",
              description: "Permanently delete this label from all items. This cannot be undone.",
              value: "confirm",
              variant: "destructive",
              isDefault: true,
            },
          ]}
          onSelect={() => { useLabelsStore.getState().deleteLabel(deleteLabelId); hide("deleteLabel"); }}
          onCancel={() => hide("deleteLabel")}
        />
      )}
      {open.respawn && (
        <RespawnSettingsDialog workItemId={workItemId} open onOpenChange={onOpenChange("respawn")} />
      )}
      {scramblePrompt && (
        <ScramblePinDialog
          open
          onOpenChange={onOpenChange("scramble")}
          mode={scramblePrompt.mode}
          action={
            scramblePrompt.kind === "scramble"
              ? "Scramble"
              : scramblePrompt.kind === "reveal"
                ? "Show name"
                : "Unscramble"
          }
          itemTitle={item.title}
          onConfirm={
            scramblePrompt.kind === "scramble"
              ? (pin) => runScramble(workItemId, activeOrgId, pin)
              : scramblePrompt.kind === "reveal"
                ? (pin) => runReveal(workItemId, pin)
                : (pin) => runUnscramble(workItemId, activeOrgId, pin)
          }
        />
      )}
      {open.description && (
        <WorkItemDescriptionDialog workItemId={workItemId} open onOpenChange={onOpenChange("description")} />
      )}
      {open.hyperlinks && (
        <HyperlinksDialog workItemId={workItemId} open onOpenChange={onOpenChange("hyperlinks")} />
      )}
      {open.financials && isSavingsIncomeEnabled(activeOrgId) && (
        <FinancialsDialog workItemId={workItemId} open onOpenChange={onOpenChange("financials")} />
      )}
      {open.timeLog && timeLoggingVisible && (
        <TimeLogDialog workItemId={workItemId} open onOpenChange={onOpenChange("timeLog")} />
      )}
      {open.moveTime && timeLoggingVisible && (
        <MoveTimeDialog
          entryIds={open.moveTime}
          title={`Transfer time entries from "${item.title}"`}
          open
          onOpenChange={onOpenChange("moveTime")}
          excludeTarget={{ kind: "work_item", id: workItemId }}
        />
      )}
      {open.snooze && (
        <SnoozeDialog workItemIds={selectionOrItem(workItemId)} open onOpenChange={onOpenChange("snooze")} />
      )}
      {open.deadline && (
        <DeadlineDialog workItemIds={selectionOrItem(workItemId)} open onOpenChange={onOpenChange("deadline")} />
      )}
      {open.createdDate && (
        <CreatedDateDialog workItemIds={selectionOrItem(workItemId)} open onOpenChange={onOpenChange("createdDate")} />
      )}
      {open.startEnd && (
        <StartEndDatesDialog workItemIds={selectionOrItem(workItemId)} open onOpenChange={onOpenChange("startEnd")} />
      )}
      {open.attributes && (
        <MobileWorkItemAttributesSheet
          workItemId={workItemId}
          open
          onOpenChange={onOpenChange("attributes")}
          onOpenTimeLog={() => show("timeLog")}
          onOpenRespawn={() => show("respawn")}
          onOpenHyperlinks={() => show("hyperlinks")}
          onOpenSnooze={() => show("snooze")}
          onScrambleName={actions.scramble}
          onRevealName={() => show("scramble", { kind: "reveal", mode: "enter" })}
          onUnscrambleName={() => show("scramble", { kind: "unscramble", mode: "enter" })}
          onOpenMove={actions.openMoveToList}
          onOpenReparent={actions.openReparent}
          onDuplicate={actions.duplicate}
        />
      )}
      {open.moveToParent && (
        <MoveToParentDialog workItemIds={open.moveToParent} treeId={treeId} open onOpenChange={onOpenChange("moveToParent")} />
      )}
      {open.moveToBacklog && (
        <MoveToBacklogDialog
          workItemIds={open.moveToBacklog}
          treeId={treeId}
          currentBacklogId={backlogId}
          open
          onOpenChange={onOpenChange("moveToBacklog")}
        />
      )}
    </>
  );
}
