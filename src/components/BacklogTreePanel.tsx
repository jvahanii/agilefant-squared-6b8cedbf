import { useAppStore } from "@/store/appStore";
import { ChevronRight, ChevronDown, FolderKanban, Plus, Trash2, GripVertical, Share2, Users } from "lucide-react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ShareTreeDialog } from "./ShareTreeDialog";
import { supabase } from "@/integrations/supabase/client";
import { useOrgStore } from "@/store/orgStore";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ActionPrompt } from "./ActionPrompt";

interface TreeShare {
  orgId: string;
  orgName: string;
}

function useTreeShares(treeIds: string[]) {
  const [shares, setShares] = useState<Record<string, TreeShare[]>>({});
  const activeOrgId = useOrgStore((s) => s.activeOrgId);

  useEffect(() => {
    if (treeIds.length === 0) return;

    const load = async () => {
      const [sharesRes, treesRes] = await Promise.all([
        supabase.from('backlog_tree_shares' as any).select('tree_id, organization_id').in('tree_id', treeIds),
        supabase.from('backlog_trees').select('id, organization_id').in('id', treeIds),
      ]);
      if (sharesRes.error || !sharesRes.data) return;

      const treeOwnerMap = new Map<string, string>();
      for (const t of treesRes.data ?? []) {
        if (t.organization_id) treeOwnerMap.set(t.id, t.organization_id);
      }

      const allOrgIds = new Set<string>();
      for (const s of sharesRes.data as any[]) allOrgIds.add(s.organization_id);
      for (const ownerId of treeOwnerMap.values()) allOrgIds.add(ownerId);
      allOrgIds.delete(activeOrgId!);

      let orgMap = new Map<string, string>();
      if (allOrgIds.size > 0) {
        const { data: orgs } = await supabase
          .from('organizations')
          .select('id, name')
          .in('id', [...allOrgIds]);
        orgMap = new Map((orgs ?? []).map((o) => [o.id, o.name]));
      }

      const result: Record<string, TreeShare[]> = {};
      for (const treeId of treeIds) {
        const related: TreeShare[] = [];
        const ownerId = treeOwnerMap.get(treeId);
        if (ownerId && ownerId !== activeOrgId && orgMap.has(ownerId)) {
          related.push({ orgId: ownerId, orgName: orgMap.get(ownerId)! });
        }
        for (const row of (sharesRes.data as any[]).filter((s: any) => s.tree_id === treeId)) {
          if (row.organization_id !== activeOrgId && orgMap.has(row.organization_id)) {
            related.push({ orgId: row.organization_id, orgName: orgMap.get(row.organization_id)! });
          }
        }
        if (related.length > 0) result[treeId] = related;
      }
      setShares(result);
    };

    load();
  }, [treeIds.join(','), activeOrgId]);

  return shares;
}

interface BacklogNodeProps {
  backlogId: string;
  depth: number;
  index: number;
  parentId: string | null;
  treeId: string;
  onDeleteRequest: (id: string) => void; // New Prop
}

function InlineInput({
  onSubmit,
  onCancel,
  depth,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
  depth: number;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${depth * 16 + 28}px` }}>
      <FolderKanban className="w-4 h-4 shrink-0 text-primary/70" />
      <input
        ref={inputRef}
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50"
        placeholder="Name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={handleSubmit}
      />
    </div>
  );
}

function BacklogReorderDropZone({
  id,
  index,
  parentId,
  treeId,
  depth,
}: {
  id: string;
  index: number;
  parentId: string | null;
  treeId: string;
  depth: number;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "backlog-reorder", index, parentId, treeId },
  });

  return (
    <div ref={setNodeRef} className="relative py-0.5" style={{ marginLeft: `${depth * 16 + 8}px` }}>
      <div className={`h-0.5 rounded-full transition-all ${isOver ? "bg-selection" : ""}`} />
    </div>
  );
}

function useBacklogPoints(backlogId: string, treeId: string) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);

  return useMemo(() => {
    const backlogIds = new Set<string>();
    const collectBacklogs = (id: string) => {
      backlogIds.add(id);
      backlogs[id]?.childrenIds.forEach(collectBacklogs);
    };