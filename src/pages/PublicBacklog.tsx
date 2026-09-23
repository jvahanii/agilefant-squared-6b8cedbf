import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Clock, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconizedTitle } from "@/components/IconizedTitle";
import { PublicAnnouncement } from "@/components/PublicAnnouncement";
import { StarRating } from "@/components/StarRating";
import { formatDuration } from "@/lib/formatDuration";
import {
  backlogScope,
  buildBacklogTree,
  buildItemTree,
  linkifySegments,
  safeLinkHref,
  scopeMinutes,
  statusFor,
  totalPoints,
  treeMinutes,
  type BacklogNode,
  type ItemNode,
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
  const items = useMemo(() => (payload ? buildItemTree(payload.items, scope) : []), [payload, scope]);

  // Which rows are open, held here rather than in each row, so the numbering
  // below can count exactly what is on screen.
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
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
        <p className="text-sm text-muted-foreground">There are no backlogs here yet.</p>
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          {showNav && (
            <nav aria-label="Backlogs" className="md:w-64 md:shrink-0">
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
                  {p.pointsVisible && <span>{totalPoints(items)} pts</span>}
                </div>
              </div>
            )}
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in this backlog yet.</p>
            ) : (
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
        {shown[0].name}
      </span>
    );
  }
  return (
    <span className="text-xs">
      {"["}
      {shown.map((l, i) => (
        <span key={l.id}>
          {i > 0 && ", "}
          <span style={{ color: l.color }}>{l.name}</span>
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
  const [showDetails, setShowDetails] = useState(false);
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
            {status.label}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            {hasDetails ? (
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="inline-flex max-w-full items-start gap-1 text-left text-sm hover:underline underline-offset-4"
              >
                <span className="min-w-0 break-words">
                  <IconizedTitle title={item.title} />
                </span>
                <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-label="Has more to read" />
              </button>
            ) : (
              <span className="text-sm break-words">
                <IconizedTitle title={item.title} />
              </span>
            )}
            {hasLinks && item.links.map((link, i) => <ItemLink key={i} link={link} />)}
            {p.labelsVisible && <LabelList ids={item.labelIds} labels={lookups.labels} />}
            {teamNames.length > 0 && <span className="text-xs text-muted-foreground">{teamNames.join(", ")}</span>}
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
    return <span className="break-all text-xs text-muted-foreground">{label}</span>;
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
      <span className="truncate">{label}</span>
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
            {segment.text}
          </a>
        ) : (
          <span key={i}>{segment.text}</span>
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
