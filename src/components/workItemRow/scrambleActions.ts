/**
 * Scrambling a row's name, reading it back and putting it back, as the row's
 * menu and the mobile attributes sheet offer them.
 *
 * Scrambling replaces the stored title with its Moomin scramble for everyone;
 * only whoever scrambled it can read it back, with their PIN.
 */
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/store/appStore";
import { patchCachedWorkItems } from "@/store/appDataCache";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { idsToScramble, idsToUnscramble } from "@/lib/scrambleScope";
import { scrambleName } from "@/lib/scramble";
import { peekCurrentUser } from "@/lib/currentUser";
import { toast } from "@/hooks/use-toast";
import type { ScramblePinResult } from "@/components/ScramblePinDialog";

/**
 * The organizations that own the rows about to be scrambled and have no PIN
 * yet. The PIN lives per organization, and an item shared in from another one
 * belongs to that organization, not the active one, so the PIN is asked for
 * and sent only where it is actually needed. Set when a scramble starts, read
 * when the PIN comes back.
 */
let orgsNeedingPin = new Set<string>();

/**
 * The rows a scramble takes in: the ones it starts from (`targets`: the
 * selection when the item is part of one, otherwise the item alone — as the
 * menu's other entries work) and everything under them. A hidden name with
 * its work readable beneath it has hidden nothing.
 */
function rowsToScramble(targets: string[]): string[] {
  return idsToScramble(targets, useAppStore.getState().workItems, useScrambledItemsStore.getState().byItem);
}

export async function runScramble(targets: string[], activeOrgId: string | null, pin: string): Promise<ScramblePinResult> {
  const items = useAppStore.getState().workItems;
  const ids = rowsToScramble(targets);
  const me = peekCurrentUser()?.id ?? null;
  const needPin = orgsNeedingPin;
  let done = 0;
  // One at a time: the first call may be the one that sets the PIN, and two
  // at once would collide on it.
  for (const id of ids) {
    // The PIN belongs to the organization that owns the item, so it is sent
    // only for the organizations that have none yet; sending it where one is
    // already set would be checked against it and rejected.
    const itemOrg = items[id].organizationId ?? activeOrgId;
    const sendPin = !itemOrg || needPin.has(itemOrg);
    // The scrambled title is built here so the words match the app's own
    // scramble; the database keeps the original where nobody can read it.
    const { error } = await supabase.rpc("scramble_work_item", {
      _work_item_id: id,
      _scrambled_title: scrambleName(items[id].title),
      _pin: sendPin ? (pin || null) : null,
    });
    if (error) {
      if (done > 0) toast({ title: `${done} scrambled, then it stopped`, description: error.message, variant: "destructive" });
      return { error: error.message };
    }
    useScrambledItemsStore.getState().setScrambled(id, me);
    done += 1;
  }
  if (done > 0) {
    toast({
      title: done === 1 ? "Name scrambled" : `${done} names scrambled`,
      description: done === 1 ? "Only you can read it, with your PIN." : "Only you can read them, with your PIN.",
    });
  }
  return {};
}

/**
 * Start scrambling: straight away where every owning organization has its PIN
 * already, otherwise by asking for the PIN to set (`askForPin`).
 */
export async function startScramble(targets: string[], activeOrgId: string | null, askForPin: () => void): Promise<void> {
  // Which organizations own the rows about to be scrambled — an item shared
  // in from a partner belongs to that partner, not the active organization,
  // and its PIN is checked there.
  const items = useAppStore.getState().workItems;
  const orgIds = [
    ...new Set(
      rowsToScramble(targets)
        .map((id) => items[id].organizationId ?? activeOrgId)
        .filter((org): org is string => !!org),
    ),
  ];
  if (orgIds.length === 0) return;

  const needPin = new Set<string>();
  for (const orgId of orgIds) {
    const { data, error } = await supabase.rpc("has_scramble_pin", { _organization_id: orgId });
    if (error) {
      toast({ title: "Could not scramble", description: error.message, variant: "destructive" });
      return;
    }
    if (!data) needPin.add(orgId);
  }
  orgsNeedingPin = needPin;

  // The first scramble in an organization sets the PIN there. Later ones do
  // not ask: hiding a name needs no permission, reading one does.
  if (needPin.size > 0) {
    askForPin();
    return;
  }
  const result = await runScramble(targets, activeOrgId, "");
  if (result.error) toast({ title: "Could not scramble", description: result.error, variant: "destructive" });
}

export async function runReveal(workItemId: string, pin: string): Promise<ScramblePinResult> {
  const { data, error } = await supabase.rpc("reveal_scrambled_title", { _work_item_id: workItemId, _pin: pin });
  if (error) return { error: error.message };
  return { revealed: data ?? "" };
}

export async function runUnscramble(targets: string[], activeOrgId: string | null, pin: string): Promise<ScramblePinResult> {
  const scrambled = useScrambledItemsStore.getState().byItem;
  const me = peekCurrentUser()?.id ?? null;
  // The rows and everything under them, as a scramble takes them in — but
  // only the ones this person scrambled: the database refuses the rest, and
  // there is no point asking it.
  const ids = idsToUnscramble(targets, useAppStore.getState().workItems, scrambled, me);
  if (ids.length === 0) return { error: "Nothing here that you scrambled" };
  let done = 0;
  for (const id of ids) {
    const { data, error } = await supabase.rpc("unscramble_work_item", { _work_item_id: id, _pin: pin });
    if (error) {
      if (done > 0) toast({ title: `${done} restored, then it stopped`, description: error.message, variant: "destructive" });
      return { error: error.message };
    }
    // The database already holds the real name; show it now rather than
    // waiting for a live update that may never come for our own change.
    if (typeof data === "string") {
      const item = useAppStore.getState().workItems[id];
      if (item) {
        const restored = { ...item, title: data };
        useAppStore.setState((s) => ({ workItems: { ...s.workItems, [id]: restored } }));
        const orgId = item.organizationId ?? activeOrgId;
        if (orgId) patchCachedWorkItems(orgId, { [id]: restored });
      }
    }
    useScrambledItemsStore.getState().setScrambled(id, undefined);
    done += 1;
  }
  if (done > 0) toast({ title: done === 1 ? "Name restored" : `${done} names restored` });
  return {};
}
