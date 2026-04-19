import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export interface WorkItemSnooze {
  id: string;
  userId: string;
  workItemId: string;
  organizationId: string;
  /** ISO timestamp (UTC) for when the item should reappear */
  snoozedUntil: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Snooze date helpers ────────────────────────────────────────────────────

/** 3 hours from now */
export function snoozeOptionLaterToday(): Date {
  return new Date(Date.now() + 3 * 60 * 60 * 1000);
}

/** Tomorrow at 7:00 AM local time */
export function snoozeOptionTomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0);
  return d;
}

/** Next Monday at 7:00 AM local time */
export function snoozeOptionNextWeek(): Date {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysUntilMonday = ((8 - day) % 7) || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(7, 0, 0, 0);
  return d;
}

/** Next Saturday at 7:00 AM local time */
export function snoozeOptionThisWeekend(): Date {
  const d = new Date();
  const day = d.getDay();
  const daysUntilSaturday = ((6 - day + 7) % 7) || 7;
  d.setDate(d.getDate() + daysUntilSaturday);
  d.setHours(7, 0, 0, 0);
  return d;
}

function rowToSnooze(row: Record<string, unknown>): WorkItemSnooze {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    workItemId: row.work_item_id as string,
    organizationId: row.organization_id as string,
    snoozedUntil: row.snoozed_until as string,
    note: (row.note as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

interface SnoozeState {
  /** Map of workItemId -> current user's snooze (one per user per item). */
  snoozes: Record<string, WorkItemSnooze>;
  /** Monotonic clock tick to force re-renders when a snooze expires. */
  tick: number;
  isLoading: boolean;

  loadSnoozes: () => Promise<void>;
  /**
   * Snooze a work item until the given Date. If a snooze already exists for
   * this user+item it is upserted.
   */
  snoozeWorkItem: (params: {
    workItemId: string;
    organizationId: string;
    snoozedUntil: Date;
    note?: string | null;
  }) => Promise<void>;
  unsnoozeWorkItem: (workItemId: string) => Promise<void>;
  clearSnoozes: () => void;

  /** True if the item is currently snoozed by the current user. */
  isSnoozed: (workItemId: string) => boolean;
  /** Returns the snooze record only if currently active (current user). */
  getActiveSnooze: (workItemId: string) => WorkItemSnooze | undefined;

  applyRealtimeSnooze: (
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
    row: Record<string, unknown>,
  ) => void;
  /** Increments the tick to trigger expiry checks across components. */
  bumpTick: () => void;
}

export const useSnoozeStore = create<SnoozeState>((set, get) => ({
  snoozes: {},
  tick: 0,
  isLoading: false,

  loadSnoozes: async () => {
    set({ isLoading: true });
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      set({ isLoading: false });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('work_item_snoozes')
      .select('*')
      .eq('user_id', userId)
      .limit(5000);

    if (error) {
      console.error('Failed to load snoozes', error);
      set({ isLoading: false });
      return;
    }

    const map: Record<string, WorkItemSnooze> = {};
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const s = rowToSnooze(row);
      map[s.workItemId] = s;
    }
    set({ snoozes: map, isLoading: false });
  },

  snoozeWorkItem: async ({ workItemId, organizationId, snoozedUntil, note }) => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      console.error('Cannot snooze: no authenticated user');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('work_item_snoozes')
      .upsert(
        {
          user_id: userId,
          work_item_id: workItemId,
          organization_id: organizationId,
          snoozed_until: snoozedUntil.toISOString(),
          note: note ?? null,
        },
        { onConflict: 'user_id,work_item_id' },
      )
      .select()
      .single();

    if (error) {
      console.error('Failed to snooze work item', error);
      return;
    }

    const s = rowToSnooze(data as Record<string, unknown>);
    set((state) => ({ snoozes: { ...state.snoozes, [s.workItemId]: s } }));
  },

  unsnoozeWorkItem: async (workItemId) => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    // Optimistic remove
    set((state) => {
      const { [workItemId]: _, ...rest } = state.snoozes;
      return { snoozes: rest };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('work_item_snoozes')
      .delete()
      .eq('user_id', userId)
      .eq('work_item_id', workItemId);

    if (error) console.error('Failed to unsnooze work item', error);
  },

  clearSnoozes: () => set({ snoozes: {}, tick: 0 }),

  isSnoozed: (workItemId) => {
    const s = get().snoozes[workItemId];
    if (!s) return false;
    return new Date(s.snoozedUntil).getTime() > Date.now();
  },

  getActiveSnooze: (workItemId) => {
    const s = get().snoozes[workItemId];
    if (!s) return undefined;
    return new Date(s.snoozedUntil).getTime() > Date.now() ? s : undefined;
  },

  applyRealtimeSnooze: (eventType, row) => {
    set((state) => {
      const workItemId = (row.work_item_id ?? row.workItemId) as string | undefined;
      if (!workItemId) return state;

      if (eventType === 'DELETE') {
        if (!state.snoozes[workItemId]) return state;
        const { [workItemId]: _, ...rest } = state.snoozes;
        return { snoozes: rest };
      }

      const s = rowToSnooze(row);
      return { snoozes: { ...state.snoozes, [s.workItemId]: s } };
    });
  },

  bumpTick: () => set((state) => ({ tick: state.tick + 1 })),
}));

/**
 * Starts an interval that bumps the store's `tick` periodically so that
 * `isSnoozed`/`getActiveSnooze` selectors re-evaluate as items wake up.
 * Returns a cleanup function. Default interval: 30s.
 */
export function startSnoozeExpiryWatcher(intervalMs = 30_000): () => void {
  const handle = setInterval(() => {
    const state = useSnoozeStore.getState();
    // Only bump if at least one snooze exists (cheap optimization)
    if (Object.keys(state.snoozes).length > 0) state.bumpTick();
  }, intervalMs);
  return () => clearInterval(handle);
}
