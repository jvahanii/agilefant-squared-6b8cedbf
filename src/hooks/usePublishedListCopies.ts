import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { claimSync, copyPublishedList, syncPublishedListCopies, takeListToCopy } from "@/lib/listCopy";
import { useAppStore } from "@/store/appStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

/** Opens a list once the reload has brought it in. */
function openWhenLoaded(backlogId: string, treeId: string) {
  const open = () => {
    const state = useAppStore.getState();
    if (!state.backlogs[backlogId]) return false;
    state.selectBacklog(backlogId, treeId);
    return true;
  };
  if (open()) return;
  const stop = useAppStore.subscribe(() => {
    if (open()) stop();
  });
  setTimeout(stop, 60_000);
}

const ads = (n: number) => `${n} ${n === 1 ? "ad" : "ads"}`;

/**
 * Copies of public lists, in the signed-in app (see lib/listCopy.ts): makes
 * the copy a visitor asked for on a public page, and once an hour brings the
 * organisation's copies their lists' new items.
 */
export function usePublishedListCopies(orgId: string | null, loaded: boolean): void {
  useEffect(() => {
    if (!orgId || !loaded) return;
    let cancelled = false;

    const token = takeListToCopy();
    if (token) {
      copyPublishedList(token, orgId)
        .then(async (res) => {
          if (cancelled) return;
          // The copy switches ratings on, and deadlines when the list has them.
          await Promise.all([useAppStore.getState().loadFromSupabase(), useOrgSettingsStore.getState().loadSettings(orgId)]);
          openWhenLoaded(res.backlogId, res.treeId);
          toast({
            title: res.existing ? "You already have this list" : "The list is in your account",
            description: res.existing
              ? res.added > 0
                ? `${ads(res.added)} added since you copied it.`
                : "Its new ads are added as they are published."
              : `${ads(res.added)} copied. New ads are added as they are published, and nothing you work on is removed.`,
          });
        })
        .catch((e: Error) => {
          toast({ title: "The list could not be copied", description: e.message, variant: "destructive" });
        });
    } else if (claimSync(orgId)) {
      syncPublishedListCopies(orgId)
        .then(async (added) => {
          if (cancelled || added === 0) return;
          await useAppStore.getState().loadFromSupabase();
          toast({ title: `${ads(added)} added to your copied lists` });
        })
        .catch(() => {
          // Asked again within the hour by the next load; nothing to tell.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [orgId, loaded]);
}
