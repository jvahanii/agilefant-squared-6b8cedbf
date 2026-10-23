import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/store/appStore";
import { useJiraCreateSpaceStore } from "@/store/jiraCreateSpaceStore";
import { JiraCreateSpaceForm } from "@/components/JiraCreateSpaceForm";

/** The "Sync with Jira…" dialog of a list's right-click menu, mounted once. */
export function JiraCreateSpaceDialogHost() {
  const backlogId = useJiraCreateSpaceStore((s) => s.backlogId);
  const close = useJiraCreateSpaceStore((s) => s.close);
  const name = useAppStore((s) => (backlogId ? s.backlogs[backlogId]?.name : undefined));
  return (
    <Dialog open={!!backlogId} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sync “{name}” with Jira</DialogTitle>
          <DialogDescription>A new Jira space is made for the list, and the two are kept in step both ways.</DialogDescription>
        </DialogHeader>
        {backlogId && <JiraCreateSpaceForm key={backlogId} backlogId={backlogId} onDone={close} />}
      </DialogContent>
    </Dialog>
  );
}
