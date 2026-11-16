import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { acceptPendingInvite } from "@/lib/invites";
import { useOrgStore } from "@/store/orgStore";

/**
 * An invite opened before signing in, accepted once an existing account is
 * in the app (a new account accepts it in Onboarding). The person is then
 * moved to the organisation they were invited to.
 */
export function usePendingInvite(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    acceptPendingInvite()
      .then(async (accepted) => {
        if (!accepted || cancelled) return;
        const org = useOrgStore.getState();
        await org.loadMemberships(userId);
        org.setActiveOrg(accepted.organizationId, accepted.organizationName);
        toast({
          title: accepted.joined ? `You've joined ${accepted.organizationName}` : `You're already in ${accepted.organizationName}`,
        });
      })
      .catch((e: Error) => {
        toast({ title: "The invite could not be accepted", description: e.message, variant: "destructive" });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
}
