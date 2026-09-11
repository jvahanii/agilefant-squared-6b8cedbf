import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, FileText, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IconizedTitle } from "@/components/IconizedTitle";
import {
  backlogScope,
  buildBacklogTree,
  buildItemTree,
  statusFor,
  totalPoints,
  type BacklogNode,
  type ItemNode,
  type PublishedPayload,
  type PublishedStatus,
} from "@/lib/publicBacklog";

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; payload: PublishedPayload };

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

  const items = useMemo(() => {
    if (!payload || !effectiveSelected) return [];
    return buildItemTree(payload.items, backlogScope(effectiveSelected, payload.backlogs));
  }, [payload, effectiveSelected]);

  const heading = payload?.kind === "backlog" ? selectedOrRootName(payload) : payload?.tree.name ?? "";

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
  const showNav = p.kind === "tree" || backlogTree[0]?.children.length > 0;

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
        <h1 className="text-xl font-semibold">
          <IconizedTitle title={heading} />
        </h1>
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
              <div className="mb-3 flex items-baseline justify-between gap-3 border-b pb-2">
                <h2 id="backlog-heading" className="font-medium">
                  <IconizedTitle title={selected.name} />
                </h2>
                {p.pointsVisible && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {totalPoints(items)} pts
                  </span>
                )}
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
                    pointsVisible={p.pointsVisible}
                    statusesByBacklog={p.statusesByBacklog}
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

function selectedOrRootName(p: PublishedPayload): string {
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
  pointsVisible,
  statusesByBacklog,
}: {
  node: ItemNode;
  depth: number;
  pointsVisible: boolean;
  statusesByBacklog: Record<string, PublishedStatus[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const { item, children } = node;
  const status = statusFor(item, statusesByBacklog);
  const hasChildren = children.length > 0;
  const hasDescription = !!item.description?.trim();

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
          {hasDescription ? (
            <button
              type="button"
              onClick={() => setShowDescription((v) => !v)}
              aria-expanded={showDescription}
              className="inline-flex max-w-full items-start gap-1 text-left text-sm hover:underline underline-offset-4"
            >
              <span className="min-w-0 break-words">
                <IconizedTitle title={item.title} />
              </span>
              <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-label="Has a description" />
            </button>
          ) : (
            <span className="text-sm break-words">
              <IconizedTitle title={item.title} />
            </span>
          )}
          {showDescription && hasDescription && (
            // Plain text on purpose: React escapes it, so nothing in a
            // description can inject markup into a page anyone can open.
            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.description}</p>
          )}
        </div>

        {pointsVisible && item.points != null && (
          <span className="mt-0.5 shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
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
              pointsVisible={pointsVisible}
              statusesByBacklog={statusesByBacklog}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
