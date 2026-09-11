import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Clock, FileText, Link2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconizedTitle } from "@/components/IconizedTitle";
import { formatDuration } from "@/lib/formatDuration";
import {
  backlogScope,
  buildBacklogTree,
  buildItemTree,
  safeLinkHref,
  scopeMinutes,
  statusFor,
  subtreeMinutes,
  totalPoints,
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
  minutes: Map<string, number>;
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

  const lookups = useMemo<Lookups | null>(() => {
    if (!payload) return null;
    return {
      teams: new Map(payload.teams.map((t) => [t.id, t.name])),
      labels: new Map(payload.labels.map((l) => [l.id, l])),
      minutes: subtreeMinutes(items),
      payload,
    };
  }, [payload, items]);

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

  // The whole-tree total adds time logged against the tree itself.
  const treeTotal =
    p.kind === "tree"
      ? p.backlogs.reduce((s, b) => s + b.minutes, 0) + p.items.reduce((s, i) => s + i.minutes, 0) + p.treeMinutes
      : null;
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
        {p.kind === "backlog" && (
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
                  <h2 id="backlog-heading" className="font-medium">
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
                  <ItemRow key={node.item.id} node={node} depth={0} lookups={lk} />
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

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
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

function ItemRow({ node, depth, lookups }: { node: ItemNode; depth: number; lookups: Lookups }) {
  const [expanded, setExpanded] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const { item, children } = node;
  const { payload: p } = lookups;
  const status = statusFor(item, p.statusesByBacklog);
  const hasChildren = children.length > 0;
  const hasDescription = !!item.description?.trim();
  const hasLinks = item.links.length > 0;
  const hasDetails = hasDescription || hasLinks;
  const minutes = lookups.minutes.get(item.id) ?? 0;
  const teamNames = item.teamIds.map((id) => lookups.teams.get(id)).filter((n): n is string => !!n);

  return (
    <li>
      <div className="flex items-start gap-1.5 rounded-md py-1.5 pr-2 hover:bg-accent/40" style={{ paddingLeft: `${depth * 1.25}rem` }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}

        <span
          className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4"
          title={status.label}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} aria-hidden="true" />
          {status.label}
        </span>

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
                {hasDescription && (
                  <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-label="Has a description" />
                )}
                {hasLinks && <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-label="Has links" />}
              </button>
            ) : (
              <span className="text-sm break-words">
                <IconizedTitle title={item.title} />
              </span>
            )}
            {p.labelsVisible && <LabelList ids={item.labelIds} labels={lookups.labels} />}
            {teamNames.length > 0 && <span className="text-xs text-muted-foreground">{teamNames.join(", ")}</span>}
          </div>

          {showDetails && hasDetails && (
            <div className="mt-1 space-y-1.5">
              {hasDescription && (
                // Plain text on purpose: React escapes it, so nothing in a
                // description can inject markup into a page anyone can open.
                <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.description}</p>
              )}
              {hasLinks && (
                <ul className="space-y-0.5">
                  {item.links.map((link, i) => (
                    <li key={i}>
                      <LinkLine link={link} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {p.timeVisible && minutes > 0 && (
          <span className="mt-0.5 shrink-0">
            <TimeBadge minutes={minutes} label="logged" />
          </span>
        )}
        {p.pointsVisible && item.points != null && (
          <span className="mt-0.5 shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {item.points}
          </span>
        )}
      </div>

      {hasChildren && expanded && (
        <ul className="space-y-px">
          {children.map((child) => (
            <ItemRow key={child.item.id} node={child} depth={depth + 1} lookups={lookups} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A stored hyperlink, clickable only if safeLinkHref() accepts it. Anything
 *  else — a javascript: or data: URL, or plain prose — is shown as text. */
function LinkLine({ link }: { link: PublishedLink }) {
  const href = safeLinkHref(link.url);
  const text = link.altText?.trim() || link.url;
  if (!href) {
    return <span className="break-all text-xs text-muted-foreground">{text}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      // nofollow/ugc: these are user-supplied links on a public page, and
      // should not lend it any search ranking.
      rel="noopener noreferrer nofollow ugc"
      className="break-all text-xs text-primary underline underline-offset-4 hover:opacity-80"
    >
      {text}
    </a>
  );
}
