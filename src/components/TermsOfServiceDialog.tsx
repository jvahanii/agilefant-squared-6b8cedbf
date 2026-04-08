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
        <ScrollArea className="h-72 rounded-md border p-4 text-sm text-muted-foreground space-y-3">
          <div className="space-y-3">
            <p>
              Welcome to <strong>Agilefant²</strong>. By creating an account you agree to these terms of service.
            </p>
            <p>
              We will do our best to provide a reliable and useful service, but we cannot accept responsibility for any
              loss of data, interruption of service, or other damages that may arise from your use of Agilefant².
            </p>
            <p>
              <strong>Your data belongs to you.</strong> You can export all your data at any time using the{" "}
              <em>Export Data</em> button available in the application settings.
            </p>
            <p>
              Agilefant² is free and open-source software licensed under the{" "}
              <strong>GNU General Public License v3 (GPLv3)</strong>. The source code is publicly available on GitHub:{" "}
              <a
                href="https://github.com/agilefant/agilefant-squared"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                github.com/agilefant/agilefant-squared
              </a>
              . You are free to inspect, modify, and self-host your own instance at any time.
            </p>
            <p>
              We reserve the right to update these terms. Continued use of the service constitutes acceptance of any
              changes.
            </p>
          </div>
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
