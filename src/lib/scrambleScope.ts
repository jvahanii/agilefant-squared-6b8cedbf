import type { WorkItem } from "@/types/models";

/**
 * Which items a scramble or an unscramble takes in.
 *
 * Hiding a name hides the work under it too: an item called "•••• ••••••"
 * with "Call the lawyer about the Nordea offer" sitting beneath it has hidden
 * nothing. So scrambling an item scrambles everything under it, and putting
 * its name back puts those back as well.
 *
 * "Under it" is taken widely. An item can sit under one parent in one tree and
 * another elsewhere, and something that is a child of the item anywhere is as
 * telling there as here — so a child by the item's ordinary parent or by any
 * tree's own counts.
 */

type Items = Record<string, Pick<WorkItem, "id" | "parentId" | "parentIds">>;

/**
 * The given items and everything beneath them, each once: the items first, in
 * the order given, then their children level by level.
 */
export function withDescendants(ids: readonly string[], workItems: Items): string[] {
  const childrenOf = new Map<string, string[]>();
  const addChild = (parent: string | null | undefined, child: string) => {
    if (!parent) return;
    const list = childrenOf.get(parent);
    if (!list) childrenOf.set(parent, [child]);
    else if (!list.includes(child)) list.push(child);
  };
  for (const item of Object.values(workItems)) {
    addChild(item.parentId, item.id);
    for (const parent of Object.values(item.parentIds ?? {})) addChild(parent, item.id);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  let level = [...ids];
  while (level.length > 0) {
    const next: string[] = [];
    for (const id of level) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      next.push(...(childrenOf.get(id) ?? []));
    }
    level = next;
  }
  return out;
}

/**
 * What scrambling these items scrambles: they and everything under them, less
 * what is already scrambled — by this person or anyone else — and anything
 * that is no longer there.
 */
export function idsToScramble(
  targets: readonly string[],
  workItems: Items,
  scrambled: ReadonlyMap<string, string | null>,
): string[] {
  return withDescendants(targets, workItems).filter((id) => workItems[id] && !scrambled.has(id));
}

/**
 * What unscrambling these items puts back: they and everything under them,
 * but only what this person scrambled. The database refuses the rest, and
 * there is no point asking it.
 */
export function idsToUnscramble(
  targets: readonly string[],
  workItems: Items,
  scrambled: ReadonlyMap<string, string | null>,
  me: string | null,
): string[] {
  return withDescendants(targets, workItems).filter((id) => scrambled.has(id) && scrambled.get(id) === me);
}
