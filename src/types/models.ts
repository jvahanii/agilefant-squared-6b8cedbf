export interface WorkItem {
  id: string;
  title: string;
  description?: string;
  points?: number;
  parentId: string | null;
  childrenIds: string[];
  /** Maps backlogTreeId -> backlogId */
  backlogAssignments: Record<string, string>;
  rank: number;
}

export interface Backlog {
  id: string;
  name: string;
  parentId: string | null;
  childrenIds: string[];
  treeId: string;
  rank: number;
}

export interface BacklogTree {
  id: string;
  name: string;
  rootBacklogIds: string[];
}
