import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

/**
 * Lightweight skeleton that mimics the AppLayout structure so the page feels
 * responsive while the real data is still loading.  Rendered by `Index.tsx`
 * in place of the centered "Loading…" spinner.
 */
export function AppShellSkeleton({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Skeleton className="h-7 w-7 rounded-md shrink-0" />
          <Skeleton className="h-5 w-32 sm:w-48" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="hidden sm:block h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-full" />
        </div>
      </header>

      {/* Body: single column on mobile, two panels on sm+ */}
      <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
        <PanelSkeleton title />
        <div className="hidden sm:block w-px bg-border" />
        <PanelSkeleton />
      </div>

      {/* Progress strip */}
      <div className="px-4 py-2 border-t border-border" aria-live="polite" role="status">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Loading your workspace…</span>
          <span className="text-xs text-muted-foreground tabular-nums">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>
    </div>
  );
}

function PanelSkeleton({ title }: { title?: boolean } = {}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col p-3 gap-3 overflow-hidden">
      {title && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Row key={i} depth={i % 3} widthClass={WIDTHS[i % WIDTHS.length]} />
        ))}
      </div>
    </div>
  );
}

const WIDTHS = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-4/5", "w-3/5"] as const;

function Row({ depth, widthClass }: { depth: number; widthClass: string }) {
  return (
    <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
      <Skeleton className="h-3.5 w-3.5 rounded-sm shrink-0" />
      <Skeleton className={`h-4 ${widthClass}`} />
    </div>
  );
}
