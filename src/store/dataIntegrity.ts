import { WorkItem, Backlog, BacklogTree } from "@/types/models";

export interface DataIssue {
  category: string;
  type: "work_item" | "backlog" | "backlog_tree";
  id: string;
  name: string;
  detail: string;
}

interface StoreData {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
}

/**
 * Comprehensive data integrity check covering 8 failure categories.
 */
export function checkDataIntegrity(data: StoreData): DataIssue[] {
  const { workItems, backlogs, backlogTrees } = data;
  const issues: DataIssue[] = [];

  // === WORK ITEMS ===
  Object.values(workItems).forEach((wi) => {
    // 1. Ghost Parent — parentId points to non-existent item
    if (wi.parentId && !workItems[wi.parentId]) {
      issues.push({ category: "Ghost Parent", type: "work_item", id: wi.id, name: wi.title, detail: `parentId "${wi.parentId}" does not exist` });
    }

    // 2. Orphaned Children — child says parentId=A, but A.childrenIds doesn't include child
    if (wi.parentId && workItems[wi.parentId]) {
      if (!workItems[wi.parentId].childrenIds.includes(wi.id)) {
        issues.push({ category: "Orphaned Children", type: "work_item", id: wi.id, name: wi.title, detail: `parent "${workItems[wi.parentId].title}" doesn't list this item in childrenIds` });
      }
    }

    // Missing children (childrenIds references non-existent items)
    wi.childrenIds.forEach((cid) => {
      if (!workItems[cid]) {
        issues.push({ category: "Ghost Parent", type: "work_item", id: wi.id, name: wi.title, detail: `childrenIds contains non-existent "${cid}"` });
      }
    });

    // Child doesn't point back
    wi.childrenIds.forEach((cid) => {
      const child = workItems[cid];
      if (child && child.parentId !== wi.id) {
        issues.push({ category: "Orphaned Children", type: "work_item", id: wi.id, name: wi.title, detail: `child "${child.title}" has parentId="${child.parentId}" instead of "${wi.id}"` });
      }
    });

    // 3. Circular References
    const visited = new Set<string>();
    let cur: string | null = wi.id;
    while (cur) {
      if (visited.has(cur)) {
        issues.push({ category: "Circular Reference", type: "work_item", id: wi.id, name: wi.title, detail: `circular parent chain detected at "${cur}"` });
        break;
      }
      visited.add(cur);
      cur = workItems[cur]?.parentId ?? null;
    }

    // 4. Backlog Displacement — assignment points to missing tree or backlog
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      if (!backlogTrees[treeId]) {
        issues.push({ category: "Backlog Displacement", type: "work_item", id: wi.id, name: wi.title, detail: `assigned to missing tree "${treeId}"` });
      }
      if (!backlogs[blId]) {
        issues.push({ category: "Backlog Displacement", type: "work_item", id: wi.id, name: wi.title, detail: `assigned to missing backlog "${blId}"` });
      }
    });

    // 8. Zombie Assignment — backlog exists but belongs to a different tree than the assignment key
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      const bl = backlogs[blId];
      if (bl && backlogTrees[treeId] && bl.treeId !== treeId) {
        issues.push({ category: "Zombie Assignment", type: "work_item", id: wi.id, name: wi.title, detail: `assigned via tree "${treeId}" to backlog "${bl.name}" which belongs to tree "${bl.treeId}"` });
      }
    });

    // No assignments at all
    if (Object.keys(wi.backlogAssignments).length === 0) {
      issues.push({ category: "Backlog Displacement", type: "work_item", id: wi.id, name: wi.title, detail: "has no backlog assignments (fully orphaned)" });
    }
  });

  // === BACKLOGS ===
  Object.values(backlogs).forEach((bl) => {
    // Ghost parent
    if (bl.parentId && !backlogs[bl.parentId]) {
      issues.push({ category: "Ghost Parent", type: "backlog", id: bl.id, name: bl.name, detail: `parentId "${bl.parentId}" does not exist` });
    }

    // Missing tree
    if (!backlogTrees[bl.treeId]) {
      issues.push({ category: "Backlog Displacement", type: "backlog", id: bl.id, name: bl.name, detail: `treeId "${bl.treeId}" does not exist` });
    }

    // Missing children
    bl.childrenIds.forEach((cid) => {
      if (!backlogs[cid]) {
        issues.push({ category: "Ghost Parent", type: "backlog", id: bl.id, name: bl.name, detail: `childrenIds contains non-existent "${cid}"` });
      }
    });

    // Orphaned from parent
    if (bl.parentId && backlogs[bl.parentId]) {
      if (!backlogs[bl.parentId].childrenIds.includes(bl.id)) {
        issues.push({ category: "Orphaned Children", type: "backlog", id: bl.id, name: bl.name, detail: `parent "${backlogs[bl.parentId].name}" doesn't list this backlog in childrenIds` });
      }
    }

    // 5. Tree-Backlog Desync — root backlog not in tree's rootBacklogIds
    if (!bl.parentId && backlogTrees[bl.treeId]) {
      if (!backlogTrees[bl.treeId].rootBacklogIds.includes(bl.id)) {
        issues.push({ category: "Tree-Backlog Desync", type: "backlog", id: bl.id, name: bl.name, detail: `is a root backlog but not listed in tree "${backlogTrees[bl.treeId].name}" rootBacklogIds` });
      }
    }

    // Circular backlog references
    const visited = new Set<string>();
    let cur: string | null = bl.id;
    while (cur) {
      if (visited.has(cur)) {
        issues.push({ category: "Circular Reference", type: "backlog", id: bl.id, name: bl.name, detail: `circular parent chain detected at "${cur}"` });
        break;
      }
      visited.add(cur);
      cur = backlogs[cur]?.parentId ?? null;
    }
  });

  // === BACKLOG TREES ===
  Object.values(backlogTrees).forEach((tree) => {
    tree.rootBacklogIds.forEach((blId) => {
      if (!backlogs[blId]) {
        issues.push({ category: "Tree-Backlog Desync", type: "backlog_tree", id: tree.id, name: tree.name, detail: `rootBacklogIds contains non-existent "${blId}"` });
      }
    });
  });

  // === 6. Duplicate Rank Collisions ===
  // Work items: group by (parentId, backlogId in each tree)
  const wiRankGroups = new Map<string, { id: string; title: string; rank: number }[]>();
  Object.values(workItems).forEach((wi) => {
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      const key = `${treeId}::${blId}::${wi.parentId ?? "ROOT"}`;
      if (!wiRankGroups.has(key)) wiRankGroups.set(key, []);
      wiRankGroups.get(key)!.push({ id: wi.id, title: wi.title, rank: wi.rank });
    });
  });
  wiRankGroups.forEach((items, key) => {
    const rankCounts = new Map<number, typeof items>();
    items.forEach((item) => {
      if (!rankCounts.has(item.rank)) rankCounts.set(item.rank, []);
      rankCounts.get(item.rank)!.push(item);
    });
    rankCounts.forEach((dupes, rank) => {
      if (dupes.length > 1) {
        issues.push({
          category: "Duplicate Rank",
          type: "work_item",
          id: dupes.map((d) => d.id).join(", "),
          name: dupes.map((d) => d.title).join(", "),
          detail: `${dupes.length} siblings share rank ${rank} in group ${key}`,
        });
      }
    });
  });

  // Backlog rank collisions among siblings
  const blRankGroups = new Map<string, { id: string; name: string; rank: number }[]>();
  Object.values(backlogs).forEach((bl) => {
    const key = `${bl.treeId}::${bl.parentId ?? "ROOT"}`;
    if (!blRankGroups.has(key)) blRankGroups.set(key, []);
    blRankGroups.get(key)!.push({ id: bl.id, name: bl.name, rank: bl.rank });
  });
  blRankGroups.forEach((items) => {
    const rankCounts = new Map<number, typeof items>();
    items.forEach((item) => {
      if (!rankCounts.has(item.rank)) rankCounts.set(item.rank, []);
      rankCounts.get(item.rank)!.push(item);
    });
    rankCounts.forEach((dupes, rank) => {
      if (dupes.length > 1) {
        issues.push({
          category: "Duplicate Rank",
          type: "backlog",
          id: dupes.map((d) => d.id).join(", "),
          name: dupes.map((d) => d.name).join(", "),
          detail: `${dupes.length} sibling backlogs share rank ${rank}`,
        });
      }
    });
  });

  // === 7. Cross-Pollinated Organization IDs ===
  // Check if item ID prefix mismatches its backlog assignment org prefix
  Object.values(workItems).forEach((wi) => {
    const wiOrgPrefix = wi.id.includes("::") ? wi.id.split("::")[0] : null;
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      const treeOrgPrefix = treeId.includes("::") ? treeId.split("::")[0] : null;
      const blOrgPrefix = blId.includes("::") ? blId.split("::")[0] : null;
      if (wiOrgPrefix && treeOrgPrefix && wiOrgPrefix !== treeOrgPrefix) {
        issues.push({ category: "Cross-Org Pollution", type: "work_item", id: wi.id, name: wi.title, detail: `item org prefix "${wiOrgPrefix}" mismatches tree org prefix "${treeOrgPrefix}"` });
      }
      if (wiOrgPrefix && blOrgPrefix && wiOrgPrefix !== blOrgPrefix) {
        issues.push({ category: "Cross-Org Pollution", type: "work_item", id: wi.id, name: wi.title, detail: `item org prefix "${wiOrgPrefix}" mismatches backlog org prefix "${blOrgPrefix}"` });
      }
    });
  });

  // === 9. Unique ID Prefix — every ID must have at most one "::" separator ===
  const checkIdFormat = (id: string, name: string, type: DataIssue["type"]) => {
    const parts = id.split("::");
    if (parts.length > 2) {
      issues.push({ category: "Malformed ID", type, id, name, detail: `ID contains ${parts.length - 1} "::" separators (expected at most 1)` });
    }
  };
  Object.values(workItems).forEach((wi) => checkIdFormat(wi.id, wi.title, "work_item"));
  Object.values(backlogs).forEach((bl) => checkIdFormat(bl.id, bl.name, "backlog"));
  Object.values(backlogTrees).forEach((t) => checkIdFormat(t.id, t.name, "backlog_tree"));

  // Also check consistency: if a backlog has an org prefix, its treeId should share it
  Object.values(backlogs).forEach((bl) => {
    const blOrgPrefix = bl.id.includes("::") ? bl.id.split("::")[0] : null;
    const treeOrgPrefix = bl.treeId.includes("::") ? bl.treeId.split("::")[0] : null;
    if (blOrgPrefix && treeOrgPrefix && blOrgPrefix !== treeOrgPrefix) {
      issues.push({ category: "Cross-Org Pollution", type: "backlog", id: bl.id, name: bl.name, detail: `backlog org prefix "${blOrgPrefix}" mismatches tree org prefix "${treeOrgPrefix}"` });
    }
  });

  return issues;
}

export interface CleanseResult {
  removed: DataIssue[];
  fixed: DataIssue[];
  data: StoreData;
}

/**
 * Comprehensive data cleansing covering all 8 failure categories.
 */
export function cleanseData(data: StoreData): CleanseResult {
  const workItems = { ...data.workItems };
  const backlogs = { ...data.backlogs };
  const backlogTrees = { ...data.backlogTrees };
  const removed: DataIssue[] = [];
  const fixed: DataIssue[] = [];

  // --- Remove backlogs with missing trees ---
  Object.keys(backlogs).forEach((id) => {
    if (!backlogTrees[backlogs[id].treeId]) {
      removed.push({ category: "Backlog Displacement", type: "backlog", id, name: backlogs[id].name, detail: `tree "${backlogs[id].treeId}" missing` });
      delete backlogs[id];
    }
  });

  // --- Remove backlogs with missing parents (iteratively) ---
  let changed = true;
  while (changed) {
    changed = false;
    Object.keys(backlogs).forEach((id) => {
      const bl = backlogs[id];
      if (bl.parentId && !backlogs[bl.parentId]) {
        removed.push({ category: "Ghost Parent", type: "backlog", id, name: bl.name, detail: `parent "${bl.parentId}" missing` });
        delete backlogs[id];
        changed = true;
      }
    });
  }

  // --- Fix circular backlog references ---
  Object.values(backlogs).forEach((bl) => {
    const visited = new Set<string>();
    let cur: string | null = bl.id;
    while (cur) {
      if (visited.has(cur)) {
        // Break cycle by making this backlog a root
        fixed.push({ category: "Circular Reference", type: "backlog", id: bl.id, name: bl.name, detail: `broke circular chain, made root` });
        backlogs[bl.id] = { ...backlogs[bl.id], parentId: null };
        break;
      }
      visited.add(cur);
      cur = backlogs[cur]?.parentId ?? null;
    }
  });

  // --- Fix Tree-Backlog Desync: add missing root backlogs to tree ---
  Object.values(backlogs).forEach((bl) => {
    if (!bl.parentId && backlogTrees[bl.treeId]) {
      if (!backlogTrees[bl.treeId].rootBacklogIds.includes(bl.id)) {
        fixed.push({ category: "Tree-Backlog Desync", type: "backlog", id: bl.id, name: bl.name, detail: `added to tree's rootBacklogIds` });
        backlogTrees[bl.treeId] = { ...backlogTrees[bl.treeId], rootBacklogIds: [...backlogTrees[bl.treeId].rootBacklogIds, bl.id] };
      }
    }
  });

  // --- Clean stale rootBacklogIds from trees ---
  Object.values(backlogTrees).forEach((tree) => {
    const valid = tree.rootBacklogIds.filter((id) => backlogs[id]);
    if (valid.length !== tree.rootBacklogIds.length) {
      const stale = tree.rootBacklogIds.filter((id) => !backlogs[id]);
      stale.forEach((id) => fixed.push({ category: "Tree-Backlog Desync", type: "backlog_tree", id: tree.id, name: tree.name, detail: `removed stale rootBacklogId "${id}"` }));
      backlogTrees[tree.id] = { ...tree, rootBacklogIds: valid };
    }
  });

  // --- Clean stale childrenIds in backlogs ---
  Object.values(backlogs).forEach((bl) => {
    const valid = bl.childrenIds.filter((id) => backlogs[id]);
    if (valid.length !== bl.childrenIds.length) {
      fixed.push({ category: "Ghost Parent", type: "backlog", id: bl.id, name: bl.name, detail: `removed ${bl.childrenIds.length - valid.length} stale childrenIds` });
      backlogs[bl.id] = { ...bl, childrenIds: valid };
    }
  });

  // --- Clean work item backlog assignments (remove stale/zombie) ---
  Object.values(workItems).forEach((wi) => {
    const cleanAssignments: Record<string, string> = {};
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      const bl = backlogs[blId];
      if (backlogTrees[treeId] && bl && bl.treeId === treeId) {
        cleanAssignments[treeId] = blId;
      } else {
        const reason = !backlogTrees[treeId]
          ? `tree "${treeId}" missing`
          : !bl
            ? `backlog "${blId}" missing`
            : `backlog belongs to tree "${bl.treeId}" not "${treeId}" (zombie)`;
        fixed.push({ category: "Zombie Assignment", type: "work_item", id: wi.id, name: wi.title, detail: reason });
      }
    });
    if (Object.keys(cleanAssignments).length !== Object.keys(wi.backlogAssignments).length) {
      workItems[wi.id] = { ...workItems[wi.id], backlogAssignments: cleanAssignments };
    }
  });

  // --- Remove work items with no valid assignments left ---
  Object.keys(workItems).forEach((id) => {
    if (Object.keys(workItems[id].backlogAssignments).length === 0) {
      removed.push({ category: "Backlog Displacement", type: "work_item", id, name: workItems[id].title, detail: "no valid backlog assignments remain" });
      delete workItems[id];
    }
  });

  // --- Fix ghost parents in work items ---
  Object.values(workItems).forEach((wi) => {
    if (wi.parentId && !workItems[wi.parentId]) {
      fixed.push({ category: "Ghost Parent", type: "work_item", id: wi.id, name: wi.title, detail: `cleared missing parent "${wi.parentId}"` });
      workItems[wi.id] = { ...workItems[wi.id], parentId: null };
    }
  });

  // --- Fix circular work item references ---
  Object.values(workItems).forEach((wi) => {
    const visited = new Set<string>();
    let cur: string | null = wi.id;
    while (cur) {
      if (visited.has(cur)) {
        fixed.push({ category: "Circular Reference", type: "work_item", id: wi.id, name: wi.title, detail: `broke circular chain, cleared parentId` });
        workItems[wi.id] = { ...workItems[wi.id], parentId: null };
        break;
      }
      visited.add(cur);
      cur = workItems[cur]?.parentId ?? null;
    }
  });

  // --- Fix orphaned children (bidirectional link repair) ---
  // Ensure all childrenIds are valid and point back
  Object.values(workItems).forEach((wi) => {
    const validChildren = wi.childrenIds.filter((cid) => {
      const child = workItems[cid];
      return child !== undefined;
    });
    if (validChildren.length !== wi.childrenIds.length) {
      fixed.push({ category: "Ghost Parent", type: "work_item", id: wi.id, name: wi.title, detail: `removed ${wi.childrenIds.length - validChildren.length} stale childrenIds` });
      workItems[wi.id] = { ...workItems[wi.id], childrenIds: validChildren };
    }
  });

  // Ensure if child.parentId = A, then A.childrenIds includes child
  Object.values(workItems).forEach((wi) => {
    if (wi.parentId && workItems[wi.parentId]) {
      const parent = workItems[wi.parentId];
      if (!parent.childrenIds.includes(wi.id)) {
        fixed.push({ category: "Orphaned Children", type: "work_item", id: wi.id, name: wi.title, detail: `added to parent "${parent.title}" childrenIds` });
        workItems[wi.parentId] = { ...workItems[wi.parentId], childrenIds: [...parent.childrenIds, wi.id] };
      }
    }
  });

  // Ensure if A.childrenIds includes B, then B.parentId = A
  Object.values(workItems).forEach((wi) => {
    wi.childrenIds.forEach((cid) => {
      const child = workItems[cid];
      if (child && child.parentId !== wi.id) {
        fixed.push({ category: "Orphaned Children", type: "work_item", id: cid, name: child.title, detail: `set parentId to "${wi.id}" to match parent's childrenIds` });
        workItems[cid] = { ...workItems[cid], parentId: wi.id };
      }
    });
  });

  // --- Fix duplicate rank collisions ---
  // Work items
  const wiRankGroups = new Map<string, string[]>();
  Object.values(workItems).forEach((wi) => {
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      const key = `${treeId}::${blId}::${wi.parentId ?? "ROOT"}`;
      if (!wiRankGroups.has(key)) wiRankGroups.set(key, []);
      wiRankGroups.get(key)!.push(wi.id);
    });
  });
  wiRankGroups.forEach((ids) => {
    const sorted = ids
      .map((id) => workItems[id])
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank);
    const ranks = sorted.map((s) => s.rank);
    const hasDupes = new Set(ranks).size !== ranks.length;
    if (hasDupes) {
      sorted.forEach((wi, i) => {
        if (wi.rank !== i) {
          fixed.push({ category: "Duplicate Rank", type: "work_item", id: wi.id, name: wi.title, detail: `rank ${wi.rank} → ${i}` });
          workItems[wi.id] = { ...workItems[wi.id], rank: i };
        }
      });
    }
  });

  // Backlogs
  const blRankGroups = new Map<string, string[]>();
  Object.values(backlogs).forEach((bl) => {
    const key = `${bl.treeId}::${bl.parentId ?? "ROOT"}`;
    if (!blRankGroups.has(key)) blRankGroups.set(key, []);
    blRankGroups.get(key)!.push(bl.id);
  });
  blRankGroups.forEach((ids) => {
    const sorted = ids
      .map((id) => backlogs[id])
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank);
    const ranks = sorted.map((s) => s.rank);
    const hasDupes = new Set(ranks).size !== ranks.length;
    if (hasDupes) {
      sorted.forEach((bl, i) => {
        if (bl.rank !== i) {
          fixed.push({ category: "Duplicate Rank", type: "backlog", id: bl.id, name: bl.name, detail: `rank ${bl.rank} → ${i}` });
          backlogs[bl.id] = { ...backlogs[bl.id], rank: i };
        }
      });
    }
  });

  // --- Remove cross-org polluted assignments (work items) ---
  Object.values(workItems).forEach((wi) => {
    const wiOrgPrefix = wi.id.includes("::") ? wi.id.split("::")[0] : null;
    if (!wiOrgPrefix) return;
    const cleanAssignments: Record<string, string> = {};
    let changed = false;
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      const treeOrgPrefix = treeId.includes("::") ? treeId.split("::")[0] : null;
      if (treeOrgPrefix && treeOrgPrefix !== wiOrgPrefix) {
        fixed.push({ category: "Cross-Org Pollution", type: "work_item", id: wi.id, name: wi.title, detail: `removed cross-org assignment to tree "${treeId}"` });
        changed = true;
      } else {
        cleanAssignments[treeId] = blId;
      }
    });
    if (changed) {
      workItems[wi.id] = { ...workItems[wi.id], backlogAssignments: cleanAssignments };
      if (Object.keys(cleanAssignments).length === 0) {
        removed.push({ category: "Cross-Org Pollution", type: "work_item", id: wi.id, name: wi.title, detail: "removed: no valid assignments after cross-org cleanup" });
        delete workItems[wi.id];
      }
    }
  });

  // --- Remove cross-org polluted backlogs (backlog org prefix vs tree org prefix) ---
  Object.keys(backlogs).forEach((id) => {
    const bl = backlogs[id];
    if (!bl) return;
    const blOrgPrefix = bl.id.includes("::") ? bl.id.split("::")[0] : null;
    const treeOrgPrefix = bl.treeId.includes("::") ? bl.treeId.split("::")[0] : null;
    if (blOrgPrefix && treeOrgPrefix && blOrgPrefix !== treeOrgPrefix) {
      removed.push({ category: "Cross-Org Pollution", type: "backlog", id: bl.id, name: bl.name, detail: `backlog org "${blOrgPrefix}" mismatches tree org "${treeOrgPrefix}"` });
      delete backlogs[id];
    }
  });

  // --- Fix backlog orphaned children (bidirectional repair) ---
  // If child.parentId = A, ensure A.childrenIds includes child
  Object.values(backlogs).forEach((bl) => {
    if (bl.parentId && backlogs[bl.parentId]) {
      const parent = backlogs[bl.parentId];
      if (!parent.childrenIds.includes(bl.id)) {
        fixed.push({ category: "Orphaned Children", type: "backlog", id: bl.id, name: bl.name, detail: `added to parent "${parent.name}" childrenIds` });
        backlogs[bl.parentId] = { ...backlogs[bl.parentId], childrenIds: [...parent.childrenIds, bl.id] };
      }
    }
  });
  // If A.childrenIds includes B, ensure B.parentId = A
  Object.values(backlogs).forEach((bl) => {
    bl.childrenIds.forEach((cid) => {
      const child = backlogs[cid];
      if (child && child.parentId !== bl.id) {
        fixed.push({ category: "Orphaned Children", type: "backlog", id: cid, name: child.name, detail: `set parentId to "${bl.id}" to match parent's childrenIds` });
        backlogs[cid] = { ...backlogs[cid], parentId: bl.id };
      }
    });
  });

  // --- Remove malformed IDs (multiple "::" separators) ---
  Object.keys(workItems).forEach((id) => {
    if (id.split("::").length > 2) {
      removed.push({ category: "Malformed ID", type: "work_item", id, name: workItems[id].title, detail: `ID has ${id.split("::").length - 1} "::" separators` });
      delete workItems[id];
    }
  });
  Object.keys(backlogs).forEach((id) => {
    if (id.split("::").length > 2) {
      removed.push({ category: "Malformed ID", type: "backlog", id, name: backlogs[id].name, detail: `ID has ${id.split("::").length - 1} "::" separators` });
      delete backlogs[id];
    }
  });
  Object.keys(backlogTrees).forEach((id) => {
    if (id.split("::").length > 2) {
      removed.push({ category: "Malformed ID", type: "backlog_tree", id, name: backlogTrees[id].name, detail: `ID has ${id.split("::").length - 1} "::" separators` });
      delete backlogTrees[id];
    }
  });

  return { removed, fixed, data: { workItems, backlogs, backlogTrees } };
}

export function formatIssueReport(issues: DataIssue[]): string {
  return issues.map((i) => `[${i.category}] [${i.type}] "${i.name}" (${i.id}): ${i.detail}`).join("\n");
}
