import { create } from 'zustand';
import type { BurnupScope } from '@/components/BurnupChartDialog';

interface State {
  scope: BurnupScope | null;
  open: boolean;
  openBurnup: (scope: BurnupScope) => void;
  close: () => void;
}

export const useBurnupDialogStore = create<State>((set) => ({
  scope: null,
  open: false,
  openBurnup: (scope) => set({ scope, open: true }),
  close: () => set({ open: false }),
}));
