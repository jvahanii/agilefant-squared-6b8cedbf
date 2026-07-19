import { create } from 'zustand';
import type { DeleteTarget } from '@/lib/timeUtils';

interface PendingDelete {
  target: DeleteTarget;
  entryIds: string[];
  label: string;
  onConfirm: () => void;
}

interface DeleteGuardState {
  pending: PendingDelete | null;
  request: (p: PendingDelete) => void;
  clear: () => void;
}

export const useDeleteGuardStore = create<DeleteGuardState>((set) => ({
  pending: null,
  request: (p) => set({ pending: p }),
  clear: () => set({ pending: null }),
}));
