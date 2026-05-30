import { create } from 'zustand';

/**
 * User-local preference for the currency used to display financial totals
 * across the app. The stored entry currency on each work item is unaffected;
 * this only changes presentation.
 */

const STORAGE_KEY = 'display-currency-v1';
const DEFAULT = 'EUR';

function readInitial(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && /^[A-Z]{3}$/.test(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

interface DisplayCurrencyState {
  displayCurrency: string;
  setDisplayCurrency: (c: string) => void;
}

export const useDisplayCurrencyStore = create<DisplayCurrencyState>((set) => ({
  displayCurrency: readInitial(),
  setDisplayCurrency: (c) => {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore */
    }
    set({ displayCurrency: c });
  },
}));
