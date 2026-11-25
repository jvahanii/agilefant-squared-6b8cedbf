/**
 * With a list selected and no item, typing part of a list's name selects that
 * list — as a row's number, typed, selects the row (useRowNumberKeys).
 *
 * A name starts with a letter. O and U are not one: with no item selected they
 * move the list (lib/shortcuts), and Shift+L opens the logged time. Once a name
 * has begun, every key that types something belongs to it — O and U, digits,
 * spaces — so a list called "Ops" is found by typing "ps", or by any later
 * part of its name.
 *
 * At each key the best match is selected: a name that starts with what was
 * typed, then one with a word that does, then one that has it anywhere; among
 * equals, the first in the tree. Lists in folded branches count too, and their
 * branch is opened. When nothing matches, the selection stays and a toast says
 * so. Backspace takes back a letter for as long as the name is being typed —
 * passed on, it would delete the list — and taking back the last one returns
 * to the list the typing started from. Any other key, a pause, or a click ends
 * the name.
 */
import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import { toast } from "@/hooks/use-toast";
import { overlayOpen } from "@/lib/overlayLock";
import { parseIcons } from "@/lib/iconMap";
import { revealBacklog } from "@/lib/shortcuts";

/** How long after a key the next one still belongs to the same name. */
export const LIST_NAME_PAUSE_MS = 1500;

/** When the last key of a name was typed; -Infinity when none is being typed. */
let nameTypedAt = -Infinity;

/** Is a list's name being typed? The row numbers leave their digits to it then. */
export function typingListName(now = Date.now()): boolean {
  return now - nameTypedAt < LIST_NAME_PAUSE_MS;
}

type AppState = ReturnType<typeof useAppStore.getState>;

/** Every list, in the order of the tree panel, folded branches included. */
function listsInTreeOrder(state: AppState): string[] {
  const ids: string[] = [];
  const visit = (id: string) => {
    if (!state.backlogs[id]) return;
    ids.push(id);
    state.backlogs[id].childrenIds.forEach(visit);
  };
  Object.values(state.backlogTrees)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .forEach((tree) => tree.rootBacklogIds.forEach(visit));
  return ids;
}

/** A name as it reads on screen: its :icon: codes are drawn, not written. */
const shownText = (name: string) =>
  parseIcons(name)
    .map((seg) => (seg.kind === "icon" ? " " : seg.value))
    .join("")
    .toLocaleLowerCase();

/** 0: the name starts with it; 1: a word in it does; 2: it is somewhere inside; null: not at all. */
function matchQuality(name: string, typed: string): 0 | 1 | 2 | null {
  const at = name.indexOf(typed);
  if (at === -1) return null;
  if (name.trimStart().startsWith(typed)) return 0;
  for (let i = at; i !== -1; i = name.indexOf(typed, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(name[i - 1])) return 1;
  }
  return 2;
}

/** The list a typed name means, or null. */
export function bestListMatch(state: AppState, typed: string): string | null {
  const wanted = typed.trimStart().toLocaleLowerCase();
  if (!wanted) return null;
  let best: string | null = null;
  let bestQuality = 3;
  for (const id of listsInTreeOrder(state)) {
    const q = matchQuality(shownText(state.backlogs[id].name ?? ""), wanted);
    if (q !== null && q < bestQuality) {
      best = id;
      bestQuality = q;
      if (q === 0) break;
    }
  }
  return best;
}

/** Select a list, opening the folded branches above it. */
function selectList(id: string) {
  const state = useAppStore.getState();
  const list = state.backlogs[id];
  if (!list) return;
  for (let p = list.parentId; p; p = state.backlogs[p]?.parentId ?? null) {
    if (!useAppStore.getState().expandedBacklogs.has(p)) state.toggleBacklogExpand(p);
  }
  if (state.selectedBacklogIds.length !== 1 || state.selectedBacklogIds[0] !== id) {
    state.selectBacklog(id, list.treeId);
  }
  revealBacklog(id);
}

/** Does this key press type a character (Shift and AltGr included)? */
function typesCharacter(e: KeyboardEvent): boolean {
  if (e.key.length !== 1 && [...e.key].length !== 1) return false;
  const altGr = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
  return altGr || !(e.ctrlKey || e.metaKey || e.altKey);
}

/** Can a name start with this key? A letter that is not a shortcut of its own here. */
function startsName(e: KeyboardEvent): boolean {
  if (!/^\p{L}$/u.test(e.key)) return false;
  const k = e.key.toLowerCase();
  if (k === "o" || k === "u") return false;
  if (k === "l" && e.shiftKey) return false;
  return true;
}

export function useListNameKeys() {
  useEffect(() => {
    let typed = "";
    /** The list selected when the name was begun. */
    let origin: string | null = null;
    /** Was "nothing matches" said already for this name? */
    let toldNoMatch = false;

    const endName = () => {
      typed = "";
      origin = null;
      toldNoMatch = false;
      nameTypedAt = -Infinity;
    };

    const handler = (e: KeyboardEvent) => {
      // Shift is how capitals are typed, so it does not end a name.
      if (["Shift", "CapsLock", "NumLock", "AltGraph"].includes(e.key)) return;

      const now = Date.now();
      const typing = typingListName(now);
      const target = e.target as HTMLElement;
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      const state = useAppStore.getState();
      const listOnly = state.selectedBacklogIds.length > 0 && state.selectedWorkItemIds.length === 0;
      const character = typesCharacter(e);
      const correcting = typing && e.key === "Backspace";

      if (!typing) endName();
      const takes =
        !inField &&
        !overlayOpen() &&
        listOnly &&
        (correcting || (character && (typing ? true : startsName(e))));
      if (!takes) {
        endName();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      nameTypedAt = now;
      // A key held down is one letter, not a row of them.
      if (character && e.repeat) return;

      if (!typing) origin = state.selectedBacklogIds[0] ?? null;
      typed = correcting ? typed.slice(0, -1) : typed + e.key;

      if (!typed.trim()) {
        toldNoMatch = false;
        if (origin) selectList(origin);
        return;
      }
      const id = bestListMatch(state, typed);
      if (id) {
        toldNoMatch = false;
        selectList(id);
      } else if (!toldNoMatch) {
        toldNoMatch = true;
        toast({ title: `No list matches "${typed.trim()}"` });
      }
    };

    // Ahead of the row numbers and of the global shortcuts, which delete on
    // Backspace and move the list on O and U.
    window.addEventListener("keydown", handler, true);
    window.addEventListener("pointerdown", endName, true);
    return () => {
      endName();
      window.removeEventListener("keydown", handler, true);
      window.removeEventListener("pointerdown", endName, true);
    };
  }, []);
}
