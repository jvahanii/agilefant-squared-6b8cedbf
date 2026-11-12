import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TermsContent } from "@/components/TermsContent";

interface TermsOfServiceDialogProps {
  open: boolean;
  onAccept?: () => void;
  onCancel: () => void;
}

export function TermsOfServiceDialog({ open, onAccept, onCancel }: TermsOfServiceDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Terms of Service</DialogTitle>
          <DialogDescription>
            {onAccept ? "Please read and accept our terms before continuing." : "Our terms of service."}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 rounded-md border p-4 text-sm text-muted-foreground">
          <TermsContent />
        </ScrollArea>
        <DialogFooter className="flex gap-2 sm:justify-end">
          {onAccept ? (
            <>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={onAccept}>Accept</Button>
            </>
          ) : (
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
