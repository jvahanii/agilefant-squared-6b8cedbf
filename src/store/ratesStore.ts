import { create } from 'zustand';

/**
 * Exchange rates store. Fetches latest daily ECB rates from frankfurter.dev
 * (free, no API key) and caches them in localStorage for the day.
 *
 * All rates are relative to EUR (base). Use `convert(amount, from, to)` to
 * convert amounts between currencies for display purposes.
 */

const CACHE_KEY = 'fx-rates-v1';
const BASE = 'EUR';

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  fetchedOn: string; // YYYY-MM-DD (UTC)
}

interface RatesState {
  base: string;
  rates: Record<string, number>;
  fetchedOn: string | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

function todayUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function readCache(): CachedRates | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRates;
    if (!parsed?.rates || typeof parsed.rates !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(c: CachedRates): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* ignore quota errors */
  }
}

export const useRatesStore = create<RatesState>((set, get) => ({
  base: BASE,
  rates: { EUR: 1 },
  fetchedOn: null,
  loading: false,
  error: null,

  load: async () => {
    // Seed from cache immediately so first render has rates available.
    const cached = readCache();
    if (cached && cached.base === BASE) {
      set({ rates: { ...cached.rates, [BASE]: 1 }, fetchedOn: cached.fetchedOn });
      if (cached.fetchedOn === todayUTC()) return; // fresh enough
    }
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${BASE}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { base: string; rates: Record<string, number> };
      const rates = { ...json.rates, [BASE]: 1 };
      const fetchedOn = todayUTC();
      writeCache({ base: BASE, rates, fetchedOn });
      set({ rates, fetchedOn, loading: false, error: null });
    } catch (e) {
      console.warn('ratesStore.load failed, using cached or identity rates', e);
      set({ loading: false, error: e instanceof Error ? e.message : 'unknown' });
    }
  },
}));

/** Pure conversion helper. Returns the input amount when rates are missing. */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (!Number.isFinite(amount) || amount === 0) return amount;
  if (!from || !to || from === to) return amount;
  const f = rates[from];
  const t = rates[to];
  if (!f || !t) return amount; // unknown currency -> identity
  return (amount * t) / f;
}

/** Selector-friendly convert that reads the live rates from the store. */
export function convertAmount(amount: number, from: string, to: string): number {
  return convertCurrency(amount, from, to, useRatesStore.getState().rates);
}
