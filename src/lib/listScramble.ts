import type { Backlog, WorkItem } from "@/types/models";
import { scrambleName } from "@/lib/scramble";
import { withDescendants } from "@/lib/scrambleScope";

/**
 * What scrambling a list takes in.
 *
 * A list's name says what its items are about, and its items say what the
 * list is: hiding either alone hides nothing. So a list is scrambled with
 * everything in it — the lists under it, every item in any of them, and
 * everything beneath those items, as scrambling an item takes its children.
 *
 * Putting it back takes in the same, less what somebody else scrambled — and
 * more: what was scrambled with the list and has since been moved out of it.
 * An item carried off to another list, still scrambled, reads as a stranger
 * there; to the person who scrambled the list it has simply gone, unless
 * unscrambling the list brings it back.
 */

type Lists = Record<string, Pick<Backlog, "id" | "name" | "childrenIds">>;
type Items = Record<string, Pick<WorkItem, "id" | "title" | "parentId" | "parentIds" | "backlogAssignments">>;
type Scrambled = ReadonlyMap<string, string | null>;

/** The list and every list under it, each once, the list itself first. */
export function listsUnder(backlogId: string, backlogs: Lists): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let level = [backlogId];
  while (level.length > 0) {
    const next: string[] = [];
    for (const id of level) {
      if (seen.has(id) || !backlogs[id]) continue;
      seen.add(id);
      out.push(id);
      next.push(...backlogs[id].childrenIds);
    }
    level = next;
  }
  return out;
}

/**
 * Every item in these lists — in whichever tree — and everything beneath
 * those items, each once.
 */
export function itemsInLists(listIds: readonly string[], workItems: Items): string[] {
  const lists = new Set(listIds);
  const inThem = Object.values(workItems)
    .filter((item) => Object.values(item.backlogAssignments ?? {}).some((id) => lists.has(id)))
    .map((item) => item.id);
  return withDescendants(inThem, workItems);
}

export interface ListScramblePlan {
  /** Lists to scramble, each with the name it will carry. */
  lists: { id: string; name: string }[];
  /** Items to scramble, each with the title it will carry. */
  items: { id: string; title: string }[];
}

/**
 * What scrambling this list scrambles: the list, the lists under it and their
 * items, less what is already scrambled — by this person or anyone else. On a
 * list that is scrambled already, that leaves what got into it unscrambled:
 * the database scrambles what is put into a scrambled list as it arrives, so
 * that is the odd case — a whole list moved under it, for one.
 */
export function planListScramble(
  backlogId: string,
  backlogs: Lists,
  workItems: Items,
  scrambledLists: Scrambled,
  scrambledItems: Scrambled,
): ListScramblePlan {
  const listIds = listsUnder(backlogId, backlogs);
  return {
    lists: listIds
      .filter((id) => !scrambledLists.has(id))
      .map((id) => ({ id, name: scrambleName(backlogs[id].name) })),
    items: itemsInLists(listIds, workItems)
      .filter((id) => workItems[id] && !scrambledItems.has(id))
      .map((id) => ({ id, title: scrambleName(workItems[id].title) })),
  };
}

export interface ListUnscramblePlan {
  listIds: string[];
  itemIds: string[];
}

/**
 * What unscrambling this list puts back: the list, the lists under it and
 * their items, as scrambling takes them in — and whatever was scrambled with
 * any of those lists (`listsWith`, `itemsWith`: id → the list it was
 * scrambled with), wherever it is now. Of all that, the ones this person
 * scrambled: the database passes over the rest, and there is no point asking
 * it. A scramble whose owner is gone belongs to nobody — not to someone who
 * happens not to be signed in either.
 */
export function planListUnscramble(
  backlogId: string,
  backlogs: Lists,
  workItems: Items,
  scrambledLists: Scrambled,
  scrambledItems: Scrambled,
  me: string | null,
  listsWith: ReadonlyMap<string, string> = new Map(),
  itemsWith: ReadonlyMap<string, string> = new Map(),
): ListUnscramblePlan {
  if (me === null) return { listIds: [], itemIds: [] };

  const listIds = listsUnder(backlogId, backlogs);
  const lists = new Set(listIds);
  // A list scrambled with one of these and since moved out from under it.
  for (const [id, withId] of listsWith) {
    if (lists.has(withId) && !lists.has(id)) listIds.push(id);
  }
  for (const id of listIds) lists.add(id);

  const itemIds = itemsInLists(listIds, workItems);
  const items = new Set(itemIds);
  // An item scrambled with one of them and since moved to another list.
  for (const [id, withId] of itemsWith) {
    if (lists.has(withId) && !items.has(id)) itemIds.push(id);
  }

  return {
    listIds: listIds.filter((id) => scrambledLists.get(id) === me),
    itemIds: itemIds.filter((id) => scrambledItems.get(id) === me),
  };
}

/** "1 list name and 12 item names" — what a scramble or its undoing covered. */
export function namesSummary(lists: number, items: number): string {
  const parts: string[] = [];
  if (lists > 0) parts.push(`${lists} list ${lists === 1 ? "name" : "names"}`);
  if (items > 0) parts.push(`${items} item ${items === 1 ? "name" : "names"}`);
  return parts.length > 0 ? parts.join(" and ") : "No names";
}

/** The items go to the database this many at a time: a list of thousands in
 *  one statement would run into the time a single request is allowed. */
export const SCRAMBLE_CHUNK = 400;

/** Split into runs of at most `size`; always at least one run, so a list with
 *  no items still makes its one call. */
export function inChunks<T>(all: readonly T[], size = SCRAMBLE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out.length > 0 ? out : [[]];
}
