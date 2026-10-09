import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import { patchCachedWorkItems } from "@/store/appDataCache";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { useScrambledListsStore } from "@/store/scrambledListsStore";
import { peekCurrentUser } from "@/lib/currentUser";
import { inChunks, namesSummary, planListScramble, planListUnscramble } from "@/lib/listScramble";
import type { ScramblePinResult } from "@/components/ScramblePinDialog";
import type { WorkItem } from "@/types/models";

/**
 * Scrambling a list from its right-click menu: the list's name, the lists
 * under it, and every item in them.
 *
 * The menu is the same wherever a list is right-clicked, so what it does
 * lives here rather than in either place that hosts it, and the one PIN
 * dialog it may need is mounted once (ListScrambleDialogHost).
 */

export interface ListScramblePrompt {
  backlogId: string;
  kind: "scramble" | "reveal" | "unscramble";
  /** "set" when a PIN has to be chosen first, "enter" when there is one. */
  mode: "set" | "enter";
}

interface ListScrambleState {
  /** The PIN dialog to show, if any. */
  prompt: ListScramblePrompt | null;
  /** Scramble the list and everything in it. Asks for a PIN only when one
   *  has to be chosen; scrambling again takes in what was added since. */
  scramble: (backlogId: string) => Promise<void>;
  askReveal: (backlogId: string) => void;
  askUnscramble: (backlogId: string) => void;
  close: () => void;
  /** What the PIN dialog's button does, for whichever prompt is open. */
  confirm: (pin: string) => Promise<ScramblePinResult>;
}

/** Show names in this tab now, rather than waiting to be told of our own change. */
function showNames(lists: readonly { id: string; name: string }[], items: readonly { id: string; title: string }[]) {
  if (lists.length === 0 && items.length === 0) return;
  const changed: Record<string, WorkItem> = {};
  useAppStore.setState((s) => {
    const backlogs = { ...s.backlogs };
    for (const list of lists) {
      if (backlogs[list.id]) backlogs[list.id] = { ...backlogs[list.id], name: list.name };
    }
    const workItems = { ...s.workItems };
    for (const item of items) {
      if (!workItems[item.id]) continue;
      workItems[item.id] = { ...workItems[item.id], title: item.title };
      changed[item.id] = workItems[item.id];
    }
    return { backlogs, workItems };
  });
  const orgId = useAppStore.getState().organizationId;
  if (orgId && Object.keys(changed).length > 0) patchCachedWorkItems(orgId, changed);
}

/** Mark, or with `by` undefined unmark, many at once: one update, not one each. */
function mark(listIds: readonly string[], itemIds: readonly string[], by: string | null | undefined) {
  const apply = (from: Map<string, string | null>, ids: readonly string[]) => {
    const next = new Map(from);
    for (const id of ids) {
      if (by === undefined) next.delete(id);
      else next.set(id, by);
    }
    return next;
  };
  if (listIds.length > 0) useScrambledListsStore.setState((s) => ({ byList: apply(s.byList, listIds) }));
  if (itemIds.length > 0) useScrambledItemsStore.setState((s) => ({ byItem: apply(s.byItem, itemIds) }));
}

interface ScrambleOutcome {
  error?: string;
  /** The database wants a PIN chosen before it will scramble (more of) this. */
  needsPin?: boolean;
}

async function runScramble(backlogId: string, pin: string | null): Promise<ScrambleOutcome> {
  const app = useAppStore.getState();
  const plan = planListScramble(
    backlogId,
    app.backlogs,
    app.workItems,
    useScrambledListsStore.getState().byList,
    useScrambledItemsStore.getState().byItem,
  );
  if (plan.lists.length === 0 && plan.items.length === 0) {
    toast({ title: "Nothing new to scramble" });
    return {};
  }

  const me = peekCurrentUser()?.id ?? null;
  let lists = 0;
  let items = 0;
  const chunks = inChunks(plan.items);
  for (let i = 0; i < chunks.length; i += 1) {
    // The lists go with the first run of items, so the list's own name and
    // its first screenful of items change together.
    const sentLists = i === 0 ? plan.lists : [];
    const { data, error } = await supabase.rpc("scramble_names", {
      _lists: sentLists,
      _items: chunks[i],
      _pin: pin,
    });
    if (error) {
      // A PIN is asked for only where there is none yet, and the database is
      // what knows: an item shared in from another organization has its PIN
      // there. Sent without one, its complaint about the PIN is the cue.
      const needsPin = pin === null && /\bPIN\b/.test(error.message);
      if (!needsPin && lists + items > 0) {
        toast({ title: `${namesSummary(lists, items)} scrambled, then it stopped`, description: error.message, variant: "destructive" });
      }
      return { error: error.message, needsPin };
    }
    const done = (data ?? {}) as { lists?: string[]; items?: string[] };
    const doneLists = new Set(done.lists ?? []);
    const doneItems = new Set(done.items ?? []);
    showNames(
      sentLists.filter((list) => doneLists.has(list.id)),
      chunks[i].filter((item) => doneItems.has(item.id)),
    );
    mark([...doneLists], [...doneItems], me);
    lists += doneLists.size;
    items += doneItems.size;
  }

  if (lists + items === 0) toast({ title: "Nothing new to scramble" });
  else {
    toast({
      title: lists > 0 ? "List scrambled" : "Scrambled",
      description: `${namesSummary(lists, items)}. Only you can read ${lists + items === 1 ? "it" : "them"}, with your PIN.`,
    });
  }
  return {};
}

async function runReveal(backlogId: string, pin: string): Promise<ScramblePinResult> {
  const { data, error } = await supabase.rpc("reveal_scrambled_backlog_name", { _backlog_id: backlogId, _pin: pin });
  if (error) return { error: error.message };
  return { revealed: data ?? "" };
}

async function runUnscramble(backlogId: string, pin: string): Promise<ScramblePinResult> {
  const app = useAppStore.getState();
  const plan = planListUnscramble(
    backlogId,
    app.backlogs,
    app.workItems,
    useScrambledListsStore.getState().byList,
    useScrambledItemsStore.getState().byItem,
    peekCurrentUser()?.id ?? null,
  );
  if (plan.listIds.length === 0 && plan.itemIds.length === 0) return { error: "Nothing here that you scrambled" };

  let lists = 0;
  let items = 0;
  const chunks = inChunks(plan.itemIds);
  for (let i = 0; i < chunks.length; i += 1) {
    const listIds = i === 0 ? plan.listIds : [];
    if (listIds.length === 0 && chunks[i].length === 0) continue;
    const { data, error } = await supabase.rpc("unscramble_names", {
      _list_ids: listIds,
      _item_ids: chunks[i],
      _pin: pin,
    });
    if (error) {
      if (lists + items > 0) {
        toast({ title: `${namesSummary(lists, items)} restored, then it stopped`, description: error.message, variant: "destructive" });
      }
      return { error: error.message };
    }
    // The real names come back with the answer; show them now.
    const back = (data ?? {}) as { lists?: { id: string; name: string }[]; items?: { id: string; title: string }[] };
    const backLists = back.lists ?? [];
    const backItems = back.items ?? [];
    showNames(backLists, backItems);
    mark(backLists.map((list) => list.id), backItems.map((item) => item.id), undefined);
    lists += backLists.length;
    items += backItems.length;
  }
  toast({ title: lists > 0 ? "List restored" : "Names restored", description: `${namesSummary(lists, items)}.` });
  return {};
}

/** One scramble at a time: a second click while the first is on its way would
 *  ask for the same names again. */
let scrambling = false;

export const useListScrambleStore = create<ListScrambleState>((set, get) => ({
  prompt: null,

  scramble: async (backlogId) => {
    if (scrambling) return;
    scrambling = true;
    try {
      const outcome = await runScramble(backlogId, null);
      if (outcome.needsPin) set({ prompt: { backlogId, kind: "scramble", mode: "set" } });
      else if (outcome.error) toast({ title: "Could not scramble", description: outcome.error, variant: "destructive" });
    } finally {
      scrambling = false;
    }
  },

  askReveal: (backlogId) => set({ prompt: { backlogId, kind: "reveal", mode: "enter" } }),
  askUnscramble: (backlogId) => set({ prompt: { backlogId, kind: "unscramble", mode: "enter" } }),
  close: () => set({ prompt: null }),

  confirm: async (pin) => {
    const prompt = get().prompt;
    if (!prompt) return {};
    if (prompt.kind === "reveal") return runReveal(prompt.backlogId, pin);
    if (prompt.kind === "unscramble") return runUnscramble(prompt.backlogId, pin);
    const outcome = await runScramble(prompt.backlogId, pin);
    return outcome.error ? { error: outcome.error } : {};
  },
}));

/**
 * Whether this list's name is scrambled and so cannot be edited — said to the
 * person when it is, rather than letting them type into a field whose result
 * the database quietly drops.
 */
export function refuseRenameOfScrambledList(backlogId: string): boolean {
  const { byList } = useScrambledListsStore.getState();
  if (!byList.has(backlogId)) return false;
  const me = peekCurrentUser()?.id ?? null;
  const mine = me !== null && byList.get(backlogId) === me;
  toast({
    title: "This list's name is scrambled",
    description: mine ? "Unscramble the list before renaming it." : "Only the person who scrambled it can change it.",
  });
  return true;
}
