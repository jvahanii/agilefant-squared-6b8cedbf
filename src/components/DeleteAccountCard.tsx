import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { deleteClerkAccount } from "@/lib/clerkBridge";
import { useAuth } from "@/hooks/useAuth";
import { clearAllCachedAppData } from "@/store/appDataCache";
import { toast } from "@/hooks/use-toast";
import { PRIVACY_CONTACT } from "@/components/TermsContent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** What the person types to confirm. */
export const CONFIRM_WORD = "delete";

/**
 * Deleting your own account (the right to erasure). The database does the
 * deciding and the deleting in one go, delete_my_account(): it refuses, with a
 * reason to show, when an organisation would be left without an owner. Then
 * the sign-in goes at Clerk, and this browser forgets what it had cached.
 */
export function DeleteAccountCard() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const deleteAccount = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      toast({ title: "Your account was not deleted", description: error.message, variant: "destructive" });
      setBusy(false);
      return;
    }

    let clerkProblem: string | null = null;
    try {
      await deleteClerkAccount();
    } catch (err) {
      clerkProblem = err instanceof Error ? err.message : String(err);
    }
    try {
      await clearAllCachedAppData();
      localStorage.clear();
    } catch {
      // Nothing else to do: the data is gone from the server either way.
    }
    try {
      await signOut();
    } catch {
      // The Clerk account, and the session with it, may already be gone.
    }

    toast(
      clerkProblem
        ? {
            title: "Your data is deleted, but not your sign-in",
            description: `Clerk did not remove your sign-in (${clerkProblem}). Write to ${PRIVACY_CONTACT} and we will remove it.`,
            variant: "destructive",
          }
        : { title: "Your account is deleted", description: "Thank you for using Agilefant²." },
    );
    setOpen(false);
    setBusy(false);
    navigate("/", { replace: true });
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 text-destructive">
          <UserX className="w-4 h-4" /> Delete account
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Deletes your name, email address and sign-in, and any organisation no one else belongs to, with all its
            data. In organisations that carry on, the items you made and the time you logged stay theirs, no longer
            tied to your name.
          </p>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setConfirmText("");
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="shrink-0">
                Delete account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. Organisations no one else belongs to are deleted with everything in them;
                  export anything you want to keep first.
                  <br />
                  <br />
                  Type <strong>{CONFIRM_WORD}</strong> to confirm:
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                aria-label="Confirm account deletion"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_WORD}
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmText.trim().toLowerCase() !== CONFIRM_WORD || busy}
                  onClick={(e) => {
                    e.preventDefault();
                    void deleteAccount();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {busy ? "Deleting..." : "Delete my account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
