import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export interface TimeEntry {
  id: string;
  organizationId: string;
  userId: string;
  workItemId: string | null;
  backlogId: string | null;
  durationMinutes: number;
  spentDate: string; // YYYY-MM-DD
  note: string | null;
  createdAt: string;
}

function rowToTimeEntry(row: Record<string, unknown>): TimeEntry {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    userId: row.user_id as string,
    workItemId: (row.work_item_id as string) ?? null,
    backlogId: (row.backlog_id as string) ?? null,
    durationMinutes: row.duration_minutes as number,
    spentDate: row.spent_date as string,
    note: (row.note as string) ?? null,
    createdAt: row.created_at as string,
  };
}

interface TimeEntryState {
  timeEntries: Record<string, TimeEntry>;
  isLoading: boolean;

  loadTimeEntries: (organizationId: string) => Promise<void>;
  addTimeEntry: (entry: {
    organizationId: string;
    userId: string;
    workItemId?: string | null;
    backlogId?: string | null;
    durationMinutes: number;
    spentDate: string;
    note?: string | null;
  }) => Promise<void>;
  updateTimeEntry: (id: string, updates: Partial<{
    workItemId: string | null;
    backlogId: string | null;
    durationMinutes: number;
    spentDate: string;
    note: string | null;
    userId: string;
  }>) => Promise<void>;
  deleteTimeEntry: (id: string) => void;
  clearTimeEntries: () => void;

  applyRealtimeTimeEntry: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

export const useTimeEntryStore = create<TimeEntryState>((set, get) => ({
  timeEntries: {},
  isLoading: false,

  loadTimeEntries: async (organizationId) => {
    set({ isLoading: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('time_entries')
      .select('*')
      .eq('organization_id', organizationId)
      .order('spent_date', { ascending: false })
      .limit(5000);

    if (error) {
      console.error('Failed to load time entries', error);
      set({ isLoading: false });
      return;
    }

    const entries: Record<string, TimeEntry> = {};
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const entry = rowToTimeEntry(row);
      entries[entry.id] = entry;
    }
    set({ timeEntries: entries, isLoading: false });
  },

  addTimeEntry: async (entry) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('time_entries')
      .insert({
        organization_id: entry.organizationId,
        user_id: entry.userId,
        work_item_id: entry.workItemId ?? null,
        backlog_id: entry.backlogId ?? null,
        duration_minutes: entry.durationMinutes,
        spent_date: entry.spentDate,
        note: entry.note ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to add time entry', error);
      return;
    }

    const te = rowToTimeEntry(data as Record<string, unknown>);
    set((s) => ({ timeEntries: { ...s.timeEntries, [te.id]: te } }));
  },

  updateTimeEntry: async (id, updates) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.workItemId !== undefined) dbUpdates.work_item_id = updates.workItemId;
    if (updates.backlogId !== undefined) dbUpdates.backlog_id = updates.backlogId;
    if (updates.durationMinutes !== undefined) dbUpdates.duration_minutes = updates.durationMinutes;
    if (updates.spentDate !== undefined) dbUpdates.spent_date = updates.spentDate;
    if (updates.note !== undefined) dbUpdates.note = updates.note;
    if (updates.userId !== undefined) dbUpdates.user_id = updates.userId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('time_entries')
      .update(dbUpdates)
      .eq('id', id);

    if (error) {
      console.error('Failed to update time entry', error);
      return;
    }

    set((s) => {
      const existing = s.timeEntries[id];
      if (!existing) return s;
      return {
        timeEntries: {
          ...s.timeEntries,
          [id]: { ...existing, ...updates },
        },
      };
    });
  },

  deleteTimeEntry: (id) => {
    // Fire-and-forget
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('time_entries').delete().eq('id', id).then(({ error }: any) => {
      if (error) console.error('Failed to delete time entry', error);
    });

    set((s) => {
      const { [id]: _, ...rest } = s.timeEntries;
      return { timeEntries: rest };
    });
  },

  clearTimeEntries: () => set({ timeEntries: {} }),

  applyRealtimeTimeEntry: (eventType, row) => {
    set((s) => {
      const id = row.id as string;

      if (eventType === 'DELETE') {
        if (!s.timeEntries[id]) return s;
        const { [id]: _, ...rest } = s.timeEntries;
        return { timeEntries: rest };
      }

      const entry = rowToTimeEntry(row);
      return { timeEntries: { ...s.timeEntries, [id]: entry } };
    });
  },
}));
