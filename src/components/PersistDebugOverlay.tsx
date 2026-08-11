import { useEffect, useState, useRef } from "react";
import { subscribePersistDebug, type PersistEvent } from "@/lib/persistDebug";
import { useOrgStore } from "@/store/orgStore";

/**
 * Desktop overlay anchored at the bottom-left of the screen.
 * Shows the 5 most recent persist confirmations as they happen,
 * then fades them out after 3 seconds. Only appears when the
 * active organization has slug "agilefant".
 */
export function PersistDebugOverlay() {
  const activeOrg = useOrgStore((s) => {
    const m = s.getActiveOrg();
    return m?.organization_slug === "agilefant" ? m : null;
  });

  const [entries, setEntries] = useState<PersistEvent[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    if (!activeOrg) {
      setEntries([]);
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      return;
    }

    const unsub = subscribePersistDebug((e) => {
      console.log("[persist-debug]", e.kind, e.title);
      setEntries((prev) => [e, ...prev].slice(0, 5));
      const timer = setTimeout(() => {
        setEntries((prev) => prev.filter((x) => x.id !== e.id));
        timersRef.current.delete(e.id);
      }, 3_000);
      timersRef.current.set(e.id, timer);
    });

    return () => {
      unsub();
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    };
  }, [activeOrg]);

  if (!activeOrg || entries.length === 0) return null;

  const label: Record<string, string> = {
    workitem: "📝 item",
    backlogRank: "📊 rank",
    boardRank: "🗂 board",
  };

  return (
    <div className="fixed bottom-4 left-4 z-[200] flex flex-col gap-1.5 max-w-xs">
      {entries.map((e) => (
        <div
          key={e.id}
          className="bg-card/95 backdrop-blur border border-border rounded-lg px-3 py-2 text-xs shadow-lg"
        >
          <span className="text-muted-foreground">
            {label[e.kind] ?? e.kind}
          </span>{" "}
          <span className="font-medium">{e.title}</span>{" "}
          <span className="text-emerald-500">→ DB</span>
        </div>
      ))}
    </div>
  );
}