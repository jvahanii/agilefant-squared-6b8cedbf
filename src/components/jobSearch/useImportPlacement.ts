/**
 * Where a job search's picked postings go: the one list they are imported
 * into, and the list in another tree the rows switched on are mirrored to.
 * Both are saved on the search, by backlog id, as soon as they are chosen.
 */
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { findImportList, findMirrorTarget } from "@/lib/autoPlace";
import type { ImportMode, RunnableSearch } from "@/lib/gmailConnector";

export function useImportPlacement(search: RunnableSearch, mode: ImportMode) {
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  // The list the picker imports into and the one it mirrors to, by backlog id,
  // as saved on the search. Read here rather than taken from the caller, whose
  // copy of the search may predate a change made in an earlier run of this
  // picker.
  const [placeInto, setPlaceInto] = useState<{ list: string | null; mirror: string | null }>({
    list: null,
    mirror: null,
  });
  /**
   * Whether the saved choice has been read, so that `importList` is the list
   * the import will go to and not only the search's own list for now — what
   * the closed-ads check started with the search goes by.
   */
  const [placementKnown, setPlacementKnown] = useState(false);
  useEffect(() => {
    if (mode !== "jobs") return;
    let cancelled = false;
    void supabase
      .from("gmail_import_queries")
      .select("auto_place_backlog_id, auto_place_mirror_backlog_id")
      .eq("id", search.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setPlaceInto({
            list: data.auto_place_backlog_id ?? null,
            mirror: data.auto_place_mirror_backlog_id ?? null,
          });
        }
        setPlacementKnown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, search.id]);

  /**
   * The one list every chosen posting goes into: the list chosen in this
   * picker, and until one is — or once that one is gone — the list the search
   * was saved with. A job search imports into one list and nowhere else; null
   * only for a link import, which has its own button.
   */
  const importList = useMemo(
    () =>
      mode === "jobs"
        ? (findImportList(backlogs, { tree_id: search.tree_id, auto_place_backlog_id: placeInto.list }) ??
          search.backlog_id)
        : null,
    [backlogs, mode, search.tree_id, search.backlog_id, placeInto.list],
  );
  /** The lists a posting can be imported into: this search's tree, by name. */
  const treeBacklogs = useMemo(
    () =>
      Object.values(backlogs ?? {})
        .filter((b) => b.treeId === search.tree_id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [backlogs, search.tree_id],
  );
  /**
   * Where the rows switched on are mirrored: the list this search chose, or
   * the default until it chooses one. Null when there is nowhere to.
   */
  const mirrorTarget = useMemo(
    () => (mode === "jobs" ? findMirrorTarget(backlogs, search.tree_id, placeInto.mirror) : null),
    [backlogs, mode, search.tree_id, placeInto.mirror],
  );
  /**
   * The lists a posting can be mirrored into: any outside this search's tree,
   * since an item holds one list per tree. Named with their tree, which is what
   * tells two same-named lists apart.
   */
  const mirrorBacklogs = useMemo(
    () =>
      Object.values(backlogs ?? {})
        .filter((b) => b.treeId !== search.tree_id)
        .map((b) => ({ id: b.id, label: `${backlogTrees?.[b.treeId]?.name ?? "?"} › ${b.name}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [backlogs, backlogTrees, search.tree_id],
  );

  /** Choosing a list saves it on the search straight away; a failure puts it back. */
  const choosePlaceInto = async (which: "list" | "mirror", id: string | null) => {
    const before = placeInto;
    setPlaceInto({ ...before, [which]: id });
    // The list chosen here becomes the search's own list as well, so there is
    // one answer to "where does this search import to" — here, under the saved
    // search in Bells & Whistles, and for a scheduled run.
    const change =
      which === "mirror"
        ? { auto_place_mirror_backlog_id: id }
        : { auto_place_backlog_id: id, ...(id ? { backlog_id: id } : {}) };
    const { error } = await supabase.from("gmail_import_queries").update(change).eq("id", search.id);
    if (error) {
      setPlaceInto(before);
      toast({ title: "Could not save the list", description: error.message, variant: "destructive" });
    }
  };

  const backlogName = (id: string) => backlogs?.[id]?.name ?? "?";

  return { importList, placementKnown, treeBacklogs, mirrorTarget, mirrorBacklogs, choosePlaceInto, backlogName };
}
