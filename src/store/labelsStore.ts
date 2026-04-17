import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export type LabelEntityType = 'work_item' | 'backlog';

export interface Label {
  id: string;
  organizationId: string;
  name: string;
  color: string;
}

export interface LabelAssignment {
  id: string;
  labelId: string;
  entityType: LabelEntityType;
  entityId: string;
  organizationId: string;
}

interface LabelsState {
  /** All labels visible to the current user, keyed by label id. */
  labels: Record<string, Label>;
  /** All assignments visible to the current user, keyed by assignment id. */
  assignments: Record<string, LabelAssignment>;
  loading: boolean;

  /** Loads labels and assignments for the active org plus any orgs that own
   *  trees we currently have access to (so labels on shared trees show up). */
  loadLabels: (orgIds: string[]) => Promise<void>;

  createLabel: (orgId: string, name: string, color: string) => Promise<Label | null>;
  updateLabel: (id: string, patch: { name?: string; color?: string }) => Promise<void>;
  deleteLabel: (id: string) => Promise<void>;

  assignLabel: (
    labelId: string,
    entityType: LabelEntityType,
    entityId: string,
    organizationId: string,
  ) => Promise<void>;
  unassignLabel: (
    labelId: string,
    entityType: LabelEntityType,
    entityId: string,
  ) => Promise<void>;

  /** Selectors */
  getLabelsForEntity: (entityType: LabelEntityType, entityId: string) => Label[];
  getLabelsForOrg: (orgId: string) => Label[];

  /** Realtime appliers */
  applyRealtimeLabel: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeAssignment: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

function rowToLabel(row: Record<string, unknown>): Label {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    name: row.name as string,
    color: row.color as string,
  };
}

function rowToAssignment(row: Record<string, unknown>): LabelAssignment {
  return {
    id: row.id as string,
    labelId: row.label_id as string,
    entityType: row.entity_type as LabelEntityType,
    entityId: row.entity_id as string,
    organizationId: row.organization_id as string,
  };
}

export const useLabelsStore = create<LabelsState>((set, get) => ({
  labels: {},
  assignments: {},
  loading: false,

  loadLabels: async (orgIds) => {
    if (orgIds.length === 0) return;
    set({ loading: true });

    const [{ data: labelRows, error: labelErr }, { data: assignRows, error: assignErr }] =
      await Promise.all([
        supabase.from('labels').select('*').in('organization_id', orgIds),
        supabase.from('label_assignments').select('*').in('organization_id', orgIds),
      ]);

    if (labelErr) console.error('loadLabels: labels query failed', labelErr);
    if (assignErr) console.error('loadLabels: assignments query failed', assignErr);

    const labels: Record<string, Label> = {};
    for (const row of (labelRows ?? []) as Record<string, unknown>[]) {
      const l = rowToLabel(row);
      labels[l.id] = l;
    }
    const assignments: Record<string, LabelAssignment> = {};
    for (const row of (assignRows ?? []) as Record<string, unknown>[]) {
      const a = rowToAssignment(row);
      assignments[a.id] = a;
    }

    set({ labels, assignments, loading: false });
  },

  createLabel: async (orgId, name, color) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const { data, error } = await supabase
      .from('labels')
      .insert({ organization_id: orgId, name: trimmed, color })
      .select('*')
      .single();
    if (error) {
      console.error('createLabel failed', error);
      return null;
    }
    const label = rowToLabel(data as Record<string, unknown>);
    set((s) => ({ labels: { ...s.labels, [label.id]: label } }));
    return label;
  },

  updateLabel: async (id, patch) => {
    const prev = get().labels[id];
    if (!prev) return;
    const next: Label = {
      ...prev,
      name: patch.name?.trim() || prev.name,
      color: patch.color ?? prev.color,
    };
    set((s) => ({ labels: { ...s.labels, [id]: next } }));

    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) dbPatch.name = next.name;
    if (patch.color !== undefined) dbPatch.color = next.color;
    const { error } = await supabase.from('labels').update(dbPatch).eq('id', id);
    if (error) {
      console.error('updateLabel failed', error);
      // revert
      set((s) => ({ labels: { ...s.labels, [id]: prev } }));
    }
  },

  deleteLabel: async (id) => {
    const prev = get().labels[id];
    const prevAssignments = Object.values(get().assignments).filter((a) => a.labelId === id);
    // Optimistic remove (DB cascades assignments)
    set((s) => {
      const labels = { ...s.labels };
      delete labels[id];
      const assignments = { ...s.assignments };
      for (const a of prevAssignments) delete assignments[a.id];
      return { labels, assignments };
    });
    const { error } = await supabase.from('labels').delete().eq('id', id);
    if (error) {
      console.error('deleteLabel failed', error);
      if (prev) {
        set((s) => {
          const assignments = { ...s.assignments };
          for (const a of prevAssignments) assignments[a.id] = a;
          return { labels: { ...s.labels, [id]: prev }, assignments };
        });
      }
    }
  },

  assignLabel: async (labelId, entityType, entityId, organizationId) => {
    // Idempotent: skip if already present
    const existing = Object.values(get().assignments).find(
      (a) => a.labelId === labelId && a.entityType === entityType && a.entityId === entityId,
    );
    if (existing) return;

    const { data, error } = await supabase
      .from('label_assignments')
      .insert({
        label_id: labelId,
        entity_type: entityType,
        entity_id: entityId,
        organization_id: organizationId,
      })
      .select('*')
      .single();
    if (error) {
      console.error('assignLabel failed', error);
      return;
    }
    const a = rowToAssignment(data as Record<string, unknown>);
    set((s) => ({ assignments: { ...s.assignments, [a.id]: a } }));
  },

  unassignLabel: async (labelId, entityType, entityId) => {
    const existing = Object.values(get().assignments).find(
      (a) => a.labelId === labelId && a.entityType === entityType && a.entityId === entityId,
    );
    if (!existing) return;

    set((s) => {
      const assignments = { ...s.assignments };
      delete assignments[existing.id];
      return { assignments };
    });

    const { error } = await supabase
      .from('label_assignments')
      .delete()
      .eq('label_id', labelId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    if (error) {
      console.error('unassignLabel failed', error);
      set((s) => ({ assignments: { ...s.assignments, [existing.id]: existing } }));
    }
  },

  getLabelsForEntity: (entityType, entityId) => {
    const { assignments, labels } = get();
    const out: Label[] = [];
    for (const a of Object.values(assignments)) {
      if (a.entityType === entityType && a.entityId === entityId) {
        const l = labels[a.labelId];
        if (l) out.push(l);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },

  getLabelsForOrg: (orgId) => {
    return Object.values(get().labels)
      .filter((l) => l.organizationId === orgId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  applyRealtimeLabel: (event, row) => {
    if (event === 'DELETE') {
      const id = row.id as string;
      set((s) => {
        const labels = { ...s.labels };
        delete labels[id];
        return { labels };
      });
      return;
    }
    const label = rowToLabel(row);
    set((s) => ({ labels: { ...s.labels, [label.id]: label } }));
  },

  applyRealtimeAssignment: (event, row) => {
    if (event === 'DELETE') {
      const id = row.id as string;
      set((s) => {
        const assignments = { ...s.assignments };
        delete assignments[id];
        return { assignments };
      });
      return;
    }
    const a = rowToAssignment(row);
    set((s) => ({ assignments: { ...s.assignments, [a.id]: a } }));
  },
}));
