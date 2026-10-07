import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, CalendarRange, ChevronDown, ChevronRight, Clock, ExternalLink, FileText, RefreshCw, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconizedTitle } from "@/components/IconizedTitle";
import { PublicAnnouncement } from "@/components/PublicAnnouncement";
import { StarRating } from "@/components/StarRating";
import { formatDeadline, isDeadlinePassed } from "@/lib/deadlineFormat";
import { formatDuration } from "@/lib/formatDuration";
import {
  backlogScope,
  buildBacklogTree,
  buildItemTree,
  buildSearchIndex,
  countItemNodes,
  dateFilterActive,
  filterItemNodes,
  filterSummary,
  filterTerms,
  highlightSegments,
  linkifySegments,
  nextPublicSort,
  safeLinkHref,
  scopeMinutes,
  sortItemNodes,
  statusFor,
  totalPoints,
  treeMinutes,
  type BacklogNode,
  type DateFilter,
  type FilterMatch,
  type ItemNode,
  type PublicSort,
  type PublishedLink,
  type PublishedPayload,
} from "@/lib/publicBacklog";

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: PublishedPayload };

type LabelInfo = { id: string; name: string; color: string };

/** Lookups every row needs, built once per payload. */
/**
 * The strings the visitor's filter is looking for, for the rows to mark where
 * they found them. Empty outside the list and while nothing is typed, so the
 * same pieces drawn elsewhere on the page — the list's own labels — stay plain.
 */
const HighlightContext = createContext<string[]>([]);

/**
 * Text with the filter's matches marked. A row is in the list because it
 * contains one of the strings; this shows which one, and where.
 */
function Marked({ text }: { text: string }) {
  const terms = useContext(HighlightContext);
  if (terms.length === 0) return <>{text}</>;
  return (
    <>
      {highlightSegments(text, terms).map((segment, i) =>
        segment.hit ? (
          <mark key={i} className="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-500/40">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

const markText = (text: string) => <Marked text={text} />;

interface Lookups {
  teams: Map<string, string>;
  labels: Map<string, LabelInfo>;
  payload: PublishedPayload;
}

/**
 * The page behind a public link. It renders outside every auth branch — a
 * visitor needs no account, and a signed-in one sees the same thing — and it
 * only ever reads get_published_backlog(), which decides what is shown.
 *
 * It is a snapshot at load time rather than live: anonymous visitors cannot
 * subscribe to realtime changes on tables RLS keeps private, so a Refresh
 * button fetches the current state instead.
 */
export default function PublicBacklog() {
  const { token = "" } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_published_backlog", { _token: token });
    if (error) {
      setState({ status: "error", message: error.message });
    } else if (!data) {
      setState({ status: "missing" });
    } else {
      setState({ status: "ready", payload: data as unknown as PublishedPayload });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const payload = state.status === "ready" ? state.payload : null;
  const backlogTree = useMemo(() => (payload ? buildBacklogTree(payload) : []), [payload]);

  // Default to the published backlog, or the tree's first backlog.
  const effectiveSelected = selectedId ?? payload?.rootBacklogId ?? backlogTree[0]?.backlog.id ?? null;
  const selected = payload?.backlogs.find((b) => b.id === effectiveSelected) ?? null;

  const scope = useMemo(
    () => (payload && effectiveSelected ? backlogScope(effectiveSelected, payload.backlogs) : new Set<string>()),
    [payload, effectiveSelected],
  );
  // A visitor's own ordering of the list, by one of the dates it shows. It
  // lasts as long as the page is open and is never saved.
  const [sort, setSort] = useState<PublicSort>(null);
  const deadlinesShown = !!payload?.deadlinesVisible;
  const createdShown = !!payload?.createdDatesVisible;
  // A sort by a date the page does not show orders the list by something the
  // visitor cannot see; it is ignored rather than applied.
  const activeSort: PublicSort =
    sort && (sort.by === "deadline" ? deadlinesShown : createdShown) ? sort : null;
  const allItems = useMemo(
    () => (payload ? sortItemNodes(buildItemTree(payload.items, scope), activeSort) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload, scope, activeSort?.by, activeSort?.direction],
  );

  // A visitor's own filter: only rows containing at least one of the strings
  // typed stay. Like the sort, it is theirs for as long as the page is open.
  const [filter, setFilter] = useState("");
  // Any one of the strings typed, or every one of them. Any to begin with.
  const [filterMatch, setFilterMatch] = useState<FilterMatch>("any");
  const terms = useMemo(() => filterTerms(filter), [filter]);
  const searchIndex = useMemo(() => (payload ? buildSearchIndex(payload) : new Map<string, string>()), [payload]);
  // Spans of days to keep, for the dates the page shows. A span for a date the
  // link does not publish is ignored: it would hide rows for a reason the
  // visitor cannot see.
  const [dateRanges, setDateRanges] = useState<DateFilter>({});
  const [datesOpen, setDatesOpen] = useState(false);
  const dates = useMemo<DateFilter>(
    () => ({
      ...(deadlinesShown && dateRanges.deadline ? { deadline: dateRanges.deadline } : {}),
      ...(createdShown && dateRanges.created ? { created: dateRanges.created } : {}),
    }),
    [dateRanges, deadlinesShown, createdShown],
  );
  const filteringByDate = dateFilterActive(dates);
  // Leave out the rows with no deadline. Off to begin with; and, like a span,
  // ignored on a page that does not show deadlines at all.
  const [deadlineOnlyChosen, setDeadlineOnly] = useState(false);
  const deadlineOnly = deadlinesShown && deadlineOnlyChosen;
  const setRange = (which: "deadline" | "created", end: "from" | "to", value: string) =>
    setDateRanges((current) => ({ ...current, [which]: { ...current[which], [end]: value || undefined } }));
  const { nodes: items, matched: matchedRows } = useMemo(
    () => filterItemNodes(allItems, terms, searchIndex, filterMatch, dates, deadlineOnly),
    [allItems, terms, searchIndex, filterMatch, dates, deadlineOnly],
  );
  const totalRows = useMemo(() => countItemNodes(allItems), [allItems]);
  const filtering = terms.length > 0 || filteringByDate || deadlineOnly;

  // Which rows are open, held here rather than in each row, so the numbering
  // below can count exactly what is on screen.
  const [openedItems, setExpandedItems] = useState<Set<string>>(new Set());
  // While filtering, every branch left holds a match somewhere below, so each
  // is shown open: a match folded away inside its parent would look like no
  // match at all. The visitor's own open and closed rows return with the list.
  const expandedItems = useMemo(() => {
    if (!filtering) return openedItems;
    const open = new Set<string>();
    const walk = (nodes: ItemNode[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) open.add(node.item.id);
        walk(node.children);
      }
    };
    walk(items);
    return open;
  }, [filtering, openedItems, items]);
  const toggleItem = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // 1-based running numbers down the visible rows, as the app numbers its list:
  // contiguous, so a collapsed branch leaves no gap. The same walk yields the
  // order the arrow keys move through.
  const { itemNumbers, visibleOrder } = useMemo(() => {
    const numbers = new Map<string, number>();
    const order: string[] = [];
    let next = 1;
    const walk = (nodes: ItemNode[]) => {
      for (const node of nodes) {
        numbers.set(node.item.id, next++);
        order.push(node.item.id);
        if (expandedItems.has(node.item.id)) walk(node.children);
      }
    };
    walk(items);
    return { itemNumbers: numbers, visibleOrder: order };
  }, [items, expandedItems]);

  // The selection is a set: a visitor can pick several rows and open every
  // link they hold at once. `cursor` is the row arrows move from and the
  // anchor a shift-click ranges to.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const itemsById = useMemo(
    () => new Map((payload?.items ?? []).map((i) => [i.id, i])),
    [payload],
  );

  const selectItem = useCallback(
    (id: string, modifiers: { multi: boolean; range: boolean }) => {
      setSelectedItemIds((current) => {
        if (modifiers.range && cursor) {
          const from = visibleOrder.indexOf(cursor);
          const to = visibleOrder.indexOf(id);
          if (from !== -1 && to !== -1) {
            return new Set(visibleOrder.slice(Math.min(from, to), Math.max(from, to) + 1));
          }
        }
        if (modifiers.multi) {
          const next = new Set(current);
          if (!next.delete(id)) next.add(id);
          return next;
        }
        return new Set([id]);
      });
      // A range keeps its anchor, so dragging the shift-click further grows
      // from the same place.
      if (!modifiers.range) setCursor(id);
    },
    [cursor, visibleOrder],
  );

  // Keep the selection on rows that are still on screen.
  useEffect(() => {
    setSelectedItemIds((current) => {
      const onScreen = new Set(visibleOrder);
      if ([...current].every((id) => onScreen.has(id))) return current;
      return new Set([...current].filter((id) => onScreen.has(id)));
    });
    setCursor((current) => (current && visibleOrder.includes(current) ? current : null));
  }, [visibleOrder]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Let a focused link or button handle its own Enter, and never steal keys
      // from a field.
      if (target && (target.tagName === "A" || target.tagName === "BUTTON" ||
                     target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "Escape") {
        setSelectedItemIds(new Set());
        setCursor(null);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (visibleOrder.length === 0) return;
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const at = cursor ? visibleOrder.indexOf(cursor) : -1;
        const next =
          at === -1
            ? visibleOrder[step === 1 ? 0 : visibleOrder.length - 1]
            : visibleOrder[Math.min(visibleOrder.length - 1, Math.max(0, at + step))];
        if (!next) return;
        // Shift extends the selection; on its own an arrow moves to one row.
        setSelectedItemIds((current) => (event.shiftKey ? new Set([...current, next]) : new Set([next])));
        setCursor(next);
        return;
      }
      if (event.key === "Enter" && selectedItemIds.size > 0) {
        // Every address the selected rows hold, in the order they are shown,
        // and only those safe to open at all.
        const hrefs = visibleOrder
          .filter((id) => selectedItemIds.has(id))
          .flatMap((id) => itemsById.get(id)?.links ?? [])
          .map((link) => safeLinkHref(link.url))
          .filter((href): href is string => !!href);
        if (hrefs.length === 0) return;
        event.preventDefault();
        for (const href of hrefs) window.open(href, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleOrder, selectedItemIds, cursor, itemsById]);

  // Follow the cursor when the arrow keys walk it off screen.
  useEffect(() => {
    if (!cursor) return;
    const row = document.querySelector(`[data-item-id="${CSS.escape(cursor)}"]`);
    // Optional call: jsdom has no scrollIntoView, and this is a nicety.
    (row as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [cursor]);

  const lookups = useMemo<Lookups | null>(() => {
    if (!payload) return null;
    return {
      teams: new Map(payload.teams.map((t) => [t.id, t.name])),
      labels: new Map(payload.labels.map((l) => [l.id, l])),
      payload,
    };
  }, [payload]);

  const heading = payload?.kind === "backlog" ? rootName(payload) : payload?.tree.name ?? "";

  useEffect(() => {
    if (heading) document.title = `${heading} – Agilefant²`;
  }, [heading]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (state.status === "loading") {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      </Shell>
    );
  }

  if (state.status === "missing" || state.status === "error") {
    return (
      <Shell>
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold">This link isn&apos;t available</h1>
          <p className="text-sm text-muted-foreground">
            {state.status === "missing"
              ? "It may have been unpublished, or the address is incomplete."
              : "Something went wrong loading it. Try again in a moment."}
          </p>
        </div>
      </Shell>
    );
  }

  const p = state.payload;
  const lk = lookups!;
  const showNav = p.kind === "tree" || backlogTree[0]?.children.length > 0;

  // Only a whole-tree link has a tree total to show.
  const treeTotal = p.kind === "tree" ? treeMinutes(p) : null;
  const selectedMinutes = scopeMinutes(p, scope);

  return (
    <Shell
      actions={
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      }
    >
      <header className="mb-6 space-y-1">
        {/* Which tree a published backlog belongs to — unless that is the
            backlog's own name, as it is for a tree's root backlog, where it
            would just repeat the heading below it. */}
        {p.kind === "backlog" && !sameName(p.tree.name, heading) && (
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            <IconizedTitle title={p.tree.name} />
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">
            <IconizedTitle title={heading} />
          </h1>
          {p.timeVisible && treeTotal !== null && treeTotal > 0 && (
            <TimeBadge minutes={treeTotal} label="logged in this tree" />
          )}
        </div>
      </header>

      {p.backlogs.length === 0 ? (
        <p className="text-sm text-muted-foreground">There are no lists here yet.</p>
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          {showNav && (
            <nav aria-label="Lists" className="md:w-64 md:shrink-0">
              <ul className="space-y-0.5">
                {backlogTree.map((node) => (
                  <BacklogNavItem
                    key={node.backlog.id}
                    node={node}
                    depth={0}
                    selectedId={effectiveSelected}
                    onSelect={setSelectedId}
                  />
                ))}
              </ul>
            </nav>
          )}

          <section className="min-w-0 flex-1" aria-labelledby="backlog-heading">
            {selected && (
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  {/* The backlog in view is usually the one already named in the
                      page heading — a link to a single backlog always is. Name
                      it again only when it is a different one, reached through
                      the nav, but keep the heading for screen readers either
                      way so the section stays labelled. */}
                  <h2
                    id="backlog-heading"
                    className={sameName(selected.name, heading) ? "sr-only" : "font-medium"}
                  >
                    <IconizedTitle title={selected.name} />
                  </h2>
                  {p.labelsVisible && <LabelList ids={selected.labelIds} labels={lk.labels} />}
                </div>
                <div className="flex shrink-0 items-baseline gap-3 text-xs tabular-nums text-muted-foreground">
                  {p.timeVisible && selectedMinutes > 0 && <TimeBadge minutes={selectedMinutes} label="logged" />}
                  {p.pointsVisible && <span>{totalPoints(allItems)} pts</span>}
                </div>
              </div>
            )}
            {allItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in this list yet.</p>
            ) : (
              <>
                {/* Stuck to the top of the window while the list scrolls under
                    it, so the filter is in reach from row 400 as from row 1. */}
                <div className="sticky top-0 z-10 -mx-1 mb-2 bg-background/95 px-1 py-2 backdrop-blur">
                  <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      type="text"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setFilter("");
                      }}
                      aria-label="Filter rows"
                      placeholder="Filter rows — type one or more words"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-9 w-full rounded-md border bg-background pl-8 pr-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary"
                    />
                    {filter && (
                      <button
                        type="button"
                        onClick={() => setFilter("")}
                        aria-label="Clear filter"
                        className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                    {/* With several words typed: a row containing any one of
                        them, or only rows containing every one. */}
                    <div
                      role="radiogroup"
                      aria-label="Rows must contain"
                      className="flex h-9 shrink-0 items-center rounded-md border p-0.5 text-xs"
                    >
                      {(
                        [
                          ["any", "Any", "Rows containing any one of the words"],
                          ["all", "All", "Only rows containing every one of the words"],
                        ] as const
                      ).map(([value, label, hint]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={filterMatch === value}
                          title={hint}
                          onClick={() => setFilterMatch(value)}
                          className={`h-full rounded px-2 font-medium transition-colors ${
                            filterMatch === value
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Rows with no deadline, in or out. A switch of its own
                        rather than part of the spans below: it asks whether a
                        row has a deadline, not when. */}
                    {deadlinesShown && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={deadlineOnly}
                        aria-label="Show only jobs with deadline"
                        title={deadlineOnly ? "Showing only rows with a deadline. Click to show all rows." : "Hide rows without a deadline"}
                        onClick={() => setDeadlineOnly((on) => !on)}
                        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${
                          deadlineOnly ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Show only jobs with deadline</span>
                        {/* Drawn as the on/off switch it is — a track and a knob
                            that slides — so its state reads at a glance rather
                            than from a tint. */}
                        <span
                          aria-hidden="true"
                          data-state={deadlineOnly ? "on" : "off"}
                          className={`inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                            deadlineOnly ? "bg-primary" : "bg-input"
                          }`}
                        >
                          <span
                            className={`h-3 w-3 rounded-full bg-background shadow transition-transform ${
                              deadlineOnly ? "translate-x-3.5" : "translate-x-0.5"
                            }`}
                          />
                        </span>
                      </button>
                    )}
                    {/* Date spans sit behind this, so the bar stays one line
                        until someone wants them. It shows when one is set. */}
                    {(deadlinesShown || createdShown) && (
                      <button
                        type="button"
                        onClick={() => setDatesOpen((open) => !open)}
                        aria-expanded={datesOpen || filteringByDate}
                        aria-label="Date range filter"
                        title="Show rows by a range of dates"
                        className={`flex h-9 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium ${
                          filteringByDate ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Date range filter</span>
                      </button>
                    )}
                  </div>
                  {(datesOpen || filteringByDate) && (deadlinesShown || createdShown) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      {(
                        [
                          ["deadline", "Deadline", deadlinesShown],
                          ["created", "Created", createdShown],
                        ] as const
                      )
                        .filter(([, , shown]) => shown)
                        .map(([which, label]) => (
                          <span key={which} className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground">{label}</span>
                            <input
                              type="date"
                              aria-label={`${label} from`}
                              value={dateRanges[which]?.from ?? ""}
                              max={dateRanges[which]?.to}
                              onChange={(e) => setRange(which, "from", e.target.value)}
                              className="h-8 rounded-md border bg-background px-1.5 text-xs text-foreground"
                            />
                            <span aria-hidden="true">–</span>
                            <input
                              type="date"
                              aria-label={`${label} to`}
                              value={dateRanges[which]?.to ?? ""}
                              min={dateRanges[which]?.from}
                              onChange={(e) => setRange(which, "to", e.target.value)}
                              className="h-8 rounded-md border bg-background px-1.5 text-xs text-foreground"
                            />
                          </span>
                        ))}
                      {filteringByDate && (
                        <button
                          type="button"
                          onClick={() => setDateRanges({})}
                          className="rounded px-1.5 py-1 font-medium hover:bg-accent hover:text-foreground"
                        >
                          Clear dates
                        </button>
                      )}
                    </div>
                  )}
                  {filtering && (
                    <p className="mt-1 text-xs text-muted-foreground" role="status">
                      {filterSummary({
                        matched: matchedRows,
                        total: totalRows,
                        terms,
                        match: filterMatch,
                        byDate: filteringByDate,
                        withDeadlineOnly: deadlineOnly,
                      })}
                    </p>
                  )}
                </div>
                {items.length > 0 && (
                <>
                {/* Headings for the dates the page shows, each a way to sort by
                    it. "Deadline" stands over the dates that lead the titles;
                    "Created" over its own column at the row's end. */}
                {(deadlinesShown || createdShown) && (
                  <div className="mb-1 flex items-center justify-between gap-2 pl-14 pr-2">
                    <span>
                      {deadlinesShown && (
                        <SortHeading
                          label="Deadline"
                          by="deadline"
                          sort={activeSort}
                          onSort={() => setSort(nextPublicSort(activeSort, "deadline"))}
                        />
                      )}
                    </span>
                    {createdShown && (
                      <SortHeading
                        label="Created"
                        by="created"
                        sort={activeSort}
                        onSort={() => setSort(nextPublicSort(activeSort, "created"))}
                        className="w-14 justify-end"
                      />
                    )}
                  </div>
                )}
              <HighlightContext.Provider value={terms}>
              <ul className="space-y-px">
                {items.map((node) => (
                  <ItemRow
                    key={node.item.id}
                    node={node}
                    depth={0}
                    lookups={lk}
                    numbers={itemNumbers}
                    expandedIds={expandedItems}
                    onToggle={toggleItem}
                    selectedIds={selectedItemIds}
                    onSelect={selectItem}
                  />
                ))}
              </ul>
              </HighlightContext.Provider>
                </>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}

function rootName(p: PublishedPayload): string {
  return p.backlogs.find((b) => b.id === p.rootBacklogId)?.name ?? p.tree.name;
}

/** Two names that read as the same thing to a visitor. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* In the shell rather than the loaded page, so it is there from the
            first paint and the backlog does not jump down underneath it. */}
        <PublicAnnouncement />
        <div className="mb-6 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">
            Agilefant<sup className="text-primary">2</sup>
            <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Read-only
            </span>
          </p>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A column heading that sorts the list by its date. The arrow says which way
 * the list runs now; the faint double arrow, that it could be sorted this way.
 */
function SortHeading({
  label,
  by,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  by: "deadline" | "created";
  sort: PublicSort;
  onSort: () => void;
  className?: string;
}) {
  const direction = sort?.by === by ? sort.direction : null;
  const next = nextPublicSort(sort, by);
  const describe = (s: PublicSort) =>
    !s
      ? "the list's own order"
      : s.by === "deadline"
        ? s.direction === "asc" ? "deadline, soonest first" : "deadline, latest first"
        : s.direction === "desc" ? "created date, newest first" : "created date, oldest first";
  return (
    <button
      type="button"
      onClick={onSort}
      aria-pressed={direction !== null}
      title={`${direction ? `Sorted by ${describe(sort)}. ` : ""}Click for ${describe(next)}.`}
      className={`inline-flex items-center gap-0.5 rounded text-xs font-medium hover:text-foreground ${
        direction ? "text-foreground" : "text-muted-foreground"
      } ${className}`}
    >
      {label}
      {direction === "asc" ? (
        <ArrowUp className="h-3 w-3" aria-label="ascending" />
      ) : direction === "desc" ? (
        <ArrowDown className="h-3 w-3" aria-label="descending" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />
      )}
    </button>
  );
}

function TimeBadge({ minutes, label }: { minutes: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground" title={`${formatDuration(minutes)} ${label}`}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      {formatDuration(minutes)}
    </span>
  );
}

/** Labels the way the app's item row shows them: one as its coloured name,
 *  several as a bracketed, comma-separated list. */
function LabelList({ ids, labels }: { ids: string[]; labels: Map<string, LabelInfo> }) {
  const shown = ids.map((id) => labels.get(id)).filter((l): l is LabelInfo => !!l);
  if (shown.length === 0) return null;
  if (shown.length === 1) {
    return (
      <span className="text-xs" style={{ color: shown[0].color }}>
        <Marked text={shown[0].name} />
      </span>
    );
  }
  return (
    <span className="text-xs">
      {"["}
      {shown.map((l, i) => (
        <span key={l.id}>
          {i > 0 && ", "}
          <span style={{ color: l.color }}>
            <Marked text={l.name} />
          </span>
        </span>
      ))}
      {"]"}
    </span>
  );
}

function BacklogNavItem({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: BacklogNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const isSelected = node.backlog.id === selectedId;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.backlog.id)}
        aria-current={isSelected ? "true" : undefined}
        style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
        className={`w-full truncate rounded-md py-1 pr-2 text-left text-sm transition-colors ${
          isSelected ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        }`}
      >
        <IconizedTitle title={node.backlog.name} />
      </button>
      {node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <BacklogNavItem key={child.backlog.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ItemRow({
  node,
  depth,
  lookups,
  numbers,
  expandedIds,
  onToggle,
  selectedIds,
  onSelect,
}: {
  node: ItemNode;
  depth: number;
  lookups: Lookups;
  /** Running number per visible row, from the page. */
  numbers: Map<string, number>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  selectedIds: Set<string>;
  onSelect: (id: string, modifiers: { multi: boolean; range: boolean }) => void;
}) {
  const [detailsOpened, setShowDetails] = useState(false);
  const terms = useContext(HighlightContext);
  const expanded = expandedIds.has(node.item.id);
  const selected = selectedIds.has(node.item.id);
  const { item, children } = node;
  const { payload: p } = lookups;
  const status = statusFor(item, p.statusesByBacklog);
  const hasChildren = children.length > 0;
  const hasLinks = item.links.length > 0;
  // Descriptions come from the integrations and are mostly a URL with a line of
  // context, so the first line sits on the row and only the rest hides behind
  // the title.
  const descriptionLines = (item.description ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const [firstLine, ...restOfDescription] = descriptionLines;
  const hasDetails = restOfDescription.length > 0;
  // A match in the part of the description that is folded away would leave the
  // row in the list with nothing marked on it, so that part opens by itself.
  const matchInDetails =
    terms.length > 0 && terms.some((term) => restOfDescription.join("\n").toLowerCase().includes(term));
  const showDetails = detailsOpened || matchInDetails;
  // Precomputed by the server, exactly as the app shows it — including time on
  // children this link does not show.
  const minutes = item.totalMinutes;
  const teamNames = item.teamIds.map((id) => lookups.teams.get(id)).filter((n): n is string => !!n);

  return (
    <li>
      {/* Selecting a row is what makes Enter meaningful: it opens the item's
          first link in a new tab. */}
      <div
        data-item-id={item.id}
        aria-selected={selected}
        onClick={(e) => onSelect(item.id, { multi: e.ctrlKey || e.metaKey, range: e.shiftKey })}
        className={`flex items-start gap-1.5 rounded-md py-1.5 pr-2 ${
          selected ? "bg-accent ring-1 ring-primary/30" : "hover:bg-accent/40"
        }`}
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(item.id)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}

        <span
          className="w-6 shrink-0 text-right text-xs leading-5 tabular-nums text-muted-foreground/70"
          data-row-number={numbers.get(item.id)}
          aria-hidden="true"
        >
          {numbers.get(item.id)}
        </span>

        {p.statusVisible && item.status != null && (
          <span
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium leading-4"
            title={status.label}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} aria-hidden="true" />
            <Marked text={status.label} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            {/* Before the title, as in the app: a job list reads date first. */}
            {p.deadlinesVisible && item.deadline && (
              <span
                className={`shrink-0 text-xs tabular-nums ${isDeadlinePassed(item.deadline) ? "text-destructive" : "text-muted-foreground"}`}
                title={`Deadline ${item.deadline}${isDeadlinePassed(item.deadline) ? " — passed" : ""}`}
              >
                {formatDeadline(item.deadline)}
              </span>
            )}
            {hasDetails ? (
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="inline-flex max-w-full items-start gap-1 text-left text-sm hover:underline underline-offset-4"
              >
                <span className="min-w-0 break-words">
                  <IconizedTitle title={item.title} renderText={markText} />
                </span>
                <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-label="Has more to read" />
              </button>
            ) : (
              <span className="text-sm break-words">
                <IconizedTitle title={item.title} renderText={markText} />
              </span>
            )}
            {hasLinks && item.links.map((link, i) => <ItemLink key={i} link={link} />)}
            {p.labelsVisible && <LabelList ids={item.labelIds} labels={lookups.labels} />}
            {teamNames.length > 0 && (
              <span className="text-xs text-muted-foreground">
                <Marked text={teamNames.join(", ")} />
              </span>
            )}
          </div>

          {/* The description's first line, with its addresses clickable. For an
              item the GitHub or Gmail integration wrote, that line is the whole
              point of the row, so it does not hide behind a click. */}
          {firstLine && (
            <p className="truncate text-xs text-muted-foreground">
              <Linkified text={firstLine} />
            </p>
          )}

          {showDetails && hasDetails && (
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
              <Linkified text={restOfDescription.join("\n")} />
            </p>
          )}
        </div>

        {p.timeVisible && minutes > 0 && (
          <span className="shrink-0 leading-5">
            <TimeBadge minutes={minutes} label="logged" />
          </span>
        )}
        {p.ratingsVisible && item.rating != null && (
          <StarRating rating={item.rating} label={item.title} className="shrink-0" />
        )}
        {p.pointsVisible && item.points != null && (
          <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground">
            {item.points}
          </span>
        )}
        {/* A column of its own, last in the row, so the dates line up down the
            list under their heading. Kept even where a row has none, for the
            same reason. */}
        {p.createdDatesVisible && (
          <span
            className="w-14 shrink-0 text-right text-xs leading-5 tabular-nums text-muted-foreground"
            title={item.createdOn ? `Created ${item.createdOn}` : undefined}
          >
            {item.createdOn ? formatDeadline(item.createdOn) : ""}
          </span>
        )}
      </div>

      {hasChildren && expanded && (
        <ul className="space-y-px">
          {children.map((child) => (
            <ItemRow
              key={child.item.id}
              node={child}
              depth={depth + 1}
              lookups={lookups}
              numbers={numbers}
              expandedIds={expandedIds}
              onToggle={onToggle}
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A stored hyperlink, sitting on the item's row and opening in a new tab.
 *
 * Clickable only if safeLinkHref() accepts it: anything else — a javascript: or
 * data: URL, or plain prose — is shown as text, since these come straight from
 * the database onto a page anyone can open.
 */
function ItemLink({ link }: { link: PublishedLink }) {
  const href = safeLinkHref(link.url);
  const label = link.altText?.trim() || shortLinkLabel(href, link.url);
  if (!href) {
    return (
      <span className="break-all text-xs text-muted-foreground">
        <Marked text={label} />
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      // nofollow/ugc: these are user-supplied links on a public page, and
      // should not lend it any search ranking.
      rel="noopener noreferrer nofollow ugc"
      title={link.url}
      className="inline-flex max-w-[14rem] items-center gap-0.5 text-xs text-primary underline-offset-4 hover:underline"
    >
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        <Marked text={label} />
      </span>
    </a>
  );
}

/**
 * Description text with its addresses as links, everything else as text.
 *
 * The text is rendered as text — React escapes it — so nothing written into
 * a description can inject markup into a page anyone can open, and an address
 * becomes a link only if safeLinkHref() accepts it.
 */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {linkifySegments(text).map((segment, i) =>
        segment.href ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-primary underline-offset-4 hover:underline"
          >
            <Marked text={segment.text} />
          </a>
        ) : (
          <span key={i}>
            <Marked text={segment.text} />
          </span>
        ),
      )}
    </>
  );
}

/** What to call a link with no text of its own: its host, or its address. */
function shortLinkLabel(href: string | null, raw: string): string {
  if (!href) return raw;
  try {
    const url = new URL(href);
    if (url.protocol === "mailto:") return href.slice("mailto:".length);
    return url.hostname.replace(/^www\./, "") + (url.pathname !== "/" ? url.pathname : "");
  } catch {
    return raw;
  }
}
