import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { ALREADY_HERE, claimSync, copyPublishedList, fillCopies, takeListToCopy, useListCopyStore } from "@/lib/listCopy";
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
      useListCopyStore.setState({ copying: true });
      const opened = () => useListCopyStore.setState({ copying: false });
      copyPublishedList(token, orgId)
        .then(async (res) => {
          if (cancelled) return opened();
          let added = res.added;
          // The list opens with its first batch; the rest follow behind it,
          // so a new account lands in the list rather than in an empty one.
          // The copy switches ratings on, and deadlines when the list has them.
          await Promise.all([useAppStore.getState().loadFromSupabase(), useOrgSettingsStore.getState().loadSettings(orgId)]);
          openWhenLoaded(res.backlogId, res.treeId);
          opened();
          if (res.more) {
            toast({ title: "Copying the list…", description: `The first ${ads(added)} are here; the rest follow in a moment.` });
            const rest = await fillCopies(orgId);
            added += rest;
            if (rest > 0) await useAppStore.getState().loadFromSupabase();
          }
          toast({
            title: res.existing ? "You already have this list" : "The list is in your account",
            description: res.existing
              ? added > 0
                ? `${ads(added)} added since you copied it.`
                : "Its new ads are added as they are published."
              : `${ads(added)} copied. New ads are added as they are published, and nothing you work on is removed.`,
          });
        })
        .catch((e: Error) => {
          opened();
          toast(
            e.message === ALREADY_HERE
              ? { title: ALREADY_HERE, description: "Its ads are here already: there is nothing to copy." }
              : { title: "The list could not be copied", description: e.message, variant: "destructive" },
          );
        });
    } else if (claimSync(orgId)) {
      fillCopies(orgId)
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
