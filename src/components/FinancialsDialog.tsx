import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/store/appStore";
import {
  useFinancialsStore,
  sumMap,
  formatCurrencyCompact,
  isPastMonth,
  type MonthlyMap,
} from "@/store/financialsStore";
import { useOrgStore } from "@/store/orgStore";
import { useRatesStore, convertCurrency } from "@/store/ratesStore";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

interface FinancialsDialogProps {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CURRENCIES = ["EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CHF", "SEK", "NOK", "DKK"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_AMOUNT = 1_000_000_000;

type RowKey = "savingsPlan" | "savingsActual" | "incomePlan" | "incomeActual";
type DraftMap = Record<RowKey, string>;
const ROW_KEYS: RowKey[] = ["savingsPlan", "savingsActual", "incomePlan", "incomeActual"];
const ROW_LABELS: Record<RowKey, { metric: string; kind: string }> = {
  savingsPlan: { metric: "Savings", kind: "Plan" },
  savingsActual: { metric: "Savings", kind: "Actual" },
  incomePlan: { metric: "Income", kind: "Plan" },
  incomeActual: { metric: "Income", kind: "Actual" },
};
const ACTUAL_KEYS: RowKey[] = ["savingsActual", "incomeActual"];

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function seedActualFromPlan(plan: MonthlyMap, savedActual: MonthlyMap): MonthlyMap {
  // Pre-populate actual rows with plan values for past months when the stored
  // actual has no value yet for that month. Future months are left empty.
  const out: MonthlyMap = { ...savedActual };
  for (const [k, v] of Object.entries(plan)) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const [y, m] = k.split("-").map(Number);
    if (!isPastMonth(y, m - 1)) continue;
    if (out[k] != null) continue;
    out[k] = v;
  }
  return out;
}

export function FinancialsDialog({ workItemId, open, onOpenChange }: FinancialsDialogProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const logChange = useAppStore((s) => s.logChange);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const entry = useFinancialsStore((s) => s.byWorkItem[workItemId]);
  const upsert = useFinancialsStore((s) => s.upsert);
  const remove = useFinancialsStore((s) => s.remove);

  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [maps, setMaps] = useState<Record<RowKey, MonthlyMap>>({
    savingsPlan: {},
    savingsActual: {},
    incomePlan: {},
    incomeActual: {},
  });
  const [currency, setCurrency] = useState("EUR");
  const [yearTotalDraft, setYearTotalDraft] = useState<DraftMap>({
    savingsPlan: "",
    savingsActual: "",
    incomePlan: "",
    incomeActual: "",
  });

  useEffect(() => {
    if (!open) return;
    const savingsPlan = entry?.savingsByMonth ? { ...entry.savingsByMonth } : {};
    const incomePlan = entry?.incomeByMonth ? { ...entry.incomeByMonth } : {};
    const savingsActual = seedActualFromPlan(savingsPlan, entry?.actualSavingsByMonth ?? {});
    const incomeActual = seedActualFromPlan(incomePlan, entry?.actualIncomeByMonth ?? {});
    setMaps({ savingsPlan, savingsActual, incomePlan, incomeActual });
    setCurrency(entry?.currency ?? "EUR");
    setYear(currentYear);
    setYearTotalDraft({ savingsPlan: "", savingsActual: "", incomePlan: "", incomeActual: "" });
  }, [open, entry, currentYear]);

  const totals = useMemo(() => {
    return {
      savingsPlan: sumMap(maps.savingsPlan),
      savingsActual: sumMap(maps.savingsActual),
      incomePlan: sumMap(maps.incomePlan),
      incomeActual: sumMap(maps.incomeActual),
    } as Record<RowKey, number>;
  }, [maps]);

  // Reset drafts when year navigation clears the typed-but-not-committed value
  useEffect(() => {
    setYearTotalDraft({ savingsPlan: "", savingsActual: "", incomePlan: "", incomeActual: "" });
  }, [year]);

  if (!item) return null;
  const orgId = item.organizationId ?? activeOrgId;
  if (!orgId) return null;

  const updateCell = (row: RowKey, monthIndex: number, raw: string) => {
    const key = monthKey(year, monthIndex);
    const num = Number(raw);
    setMaps((prev) => {
      const next = { ...prev[row] };
      if (!raw.trim() || !Number.isFinite(num) || num <= 0) {
        delete next[key];
      } else {
        next[key] = Math.min(num, MAX_AMOUNT);
      }
      return { ...prev, [row]: next };
    });
  };

  const distributeYearTotal = (row: RowKey, raw: string) => {
    const num = Number(raw);
    const isActual = ACTUAL_KEYS.includes(row);
    // For Actual rows, distribute only across past months of the selected year.
    const monthIdxs: number[] = [];
    for (let i = 0; i < 12; i++) {
      if (isActual && !isPastMonth(year, i)) continue;
      monthIdxs.push(i);
    }
    setMaps((prev) => {
      const next = { ...prev[row] };
      // Remove existing months for this year (only the ones we'd distribute into)
      for (const i of monthIdxs) delete next[monthKey(year, i)];
      if (monthIdxs.length > 0 && raw.trim() && Number.isFinite(num) && num > 0) {
        const total = Math.min(num, MAX_AMOUNT * monthIdxs.length);
        const base = Math.round((total / monthIdxs.length) * 100) / 100;
        const sumRest = base * (monthIdxs.length - 1);
        const last = Math.round((total - sumRest) * 100) / 100;
        for (let j = 0; j < monthIdxs.length - 1; j++) {
          next[monthKey(year, monthIdxs[j])] = base;
        }
        next[monthKey(year, monthIdxs[monthIdxs.length - 1])] = Math.max(0, last);
      }
      return { ...prev, [row]: next };
    });
    setYearTotalDraft((d) => ({ ...d, [row]: "" }));
  };

  const handleCurrencyChange = (next: string) => {
    if (next === currency) return;
    const rates = useRatesStore.getState().rates;
    const convertMap = (m: MonthlyMap): MonthlyMap => {
      const out: MonthlyMap = {};
      for (const [k, v] of Object.entries(m)) {
        const c = convertCurrency(v, currency, next, rates);
        out[k] = Math.round(c * 100) / 100;
      }
      return out;
    };
    setMaps((prev) => ({
      savingsPlan: convertMap(prev.savingsPlan),
      savingsActual: convertMap(prev.savingsActual),
      incomePlan: convertMap(prev.incomePlan),
      incomeActual: convertMap(prev.incomeActual),
    }));
    setYearTotalDraft((d) => {
      const conv = (s: string) => {
        if (!s.trim()) return s;
        const n = Number(s);
        if (!Number.isFinite(n)) return s;
        return String(Math.round(convertCurrency(n, currency, next, rates) * 100) / 100);
      };
      return {
        savingsPlan: conv(d.savingsPlan),
        savingsActual: conv(d.savingsActual),
        incomePlan: conv(d.incomePlan),
        incomeActual: conv(d.incomeActual),
      };
    });
    setCurrency(next);
  };

  const handleSave = async () => {
    const hasAny = ROW_KEYS.some((k) => Object.keys(maps[k]).length > 0);
    if (!hasAny) {
      if (entry) {
        await remove(workItemId);
        logChange({ action: "Clear Financials", entityType: "work_item", entityId: workItemId, entityName: item.title });
      }
      onOpenChange(false);
      return;
    }
    await upsert(workItemId, orgId, {
      savingsByMonth: maps.savingsPlan,
      incomeByMonth: maps.incomePlan,
      actualSavingsByMonth: maps.savingsActual,
      actualIncomeByMonth: maps.incomeActual,
      currency,
    });
    logChange({
      action: "Update Financials",
      entityType: "work_item",
      entityId: workItemId,
      entityName: item.title,
      details: `savings: ${formatCurrencyCompact(totals.savingsPlan, currency)}, income: ${formatCurrencyCompact(totals.incomePlan, currency)}`,
    });
    onOpenChange(false);
  };

  const handleClear = async () => {
    if (entry) {
      await remove(workItemId);
      logChange({ action: "Clear Financials", entityType: "work_item", entityId: workItemId, entityName: item.title });
    }
    onOpenChange(false);
  };

  const yearSums = useMemo(() => {
    const sums = {} as Record<RowKey, number>;
    for (const row of ROW_KEYS) {
      let s = 0;
      for (let i = 0; i < 12; i++) s += maps[row][monthKey(year, i)] ?? 0;
      sums[row] = s;
    }
    return sums;
  }, [maps, year]);

  const yearHasPastMonths = useMemo(() => {
    for (let i = 0; i < 12; i++) if (isPastMonth(year, i)) return true;
    return false;
  }, [year]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] sm:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Savings &amp; Income</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-1 truncate" title={item.title}>
          {item.title}
        </div>

        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Previous year"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-base font-semibold tabular-nums min-w-[3.5rem] text-center">
              {year}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setYear((y) => y + 1)}
              aria-label="Next year"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            {year !== currentYear && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setYear(currentYear)}
              >
                Today
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Entry currency</Label>
            <Select value={currency} onValueChange={handleCurrencyChange}>
              <SelectTrigger className="h-7 text-xs w-[88px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground -mt-2 mb-2">
          Plan rows hold projected amounts. Actual rows are editable only for past months and start pre-filled from the plan. Amounts are entered in <span className="font-medium">{currency}</span>; totals elsewhere convert to your display currency using daily ECB rates.
        </p>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground sticky left-0 bg-muted/50 z-10">
                  &nbsp;
                </th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="px-1 py-1.5 text-center font-medium text-muted-foreground">
                    {m}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Year</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {ROW_KEYS.map((row, rowIdx) => {
                const map = maps[row];
                const isActual = ACTUAL_KEYS.includes(row);
                const label = ROW_LABELS[row];
                const yearTotal = yearSums[row];
                const yearDistributeDisabled = isActual && !yearHasPastMonths;
                // Add a thicker top border between metric groups (every other row).
                const groupBorder = rowIdx === 0 || rowIdx === 2 ? "border-t-2" : "border-t";
                return (
                  <tr key={row} className={groupBorder}>
                    <td className="px-2 py-1 font-medium sticky left-0 bg-card z-10 whitespace-nowrap">
                      <span>{label.metric}</span>
                      <span className={`ml-1 text-[10px] ${isActual ? "text-foreground/70" : "text-muted-foreground"}`}>
                        · {label.kind}
                      </span>
                    </td>
                    {MONTH_LABELS.map((_, i) => {
                      const k = monthKey(year, i);
                      const v = map[k];
                      const disabled = isActual && !isPastMonth(year, i);
                      return (
                        <td key={i} className="p-0.5">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={v != null ? String(v) : ""}
                            onChange={(e) => updateCell(row, i, e.target.value)}
                            placeholder={disabled ? "—" : "0"}
                            disabled={disabled}
                            title={disabled ? "Future month — actuals can only be entered after the month ends." : undefined}
                            className={`h-7 w-10 px-1.5 text-xs text-right tabular-nums ${disabled ? "bg-muted/40 text-muted-foreground/60 cursor-not-allowed" : ""}`}
                          />
                        </td>
                      );
                    })}
                    <td className="p-0.5 whitespace-nowrap">
                      {(() => {
                        const draft = yearTotalDraft[row];
                        const displayValue = draft !== "" ? draft : (yearTotal > 0 ? String(yearTotal) : "");
                        return (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={displayValue}
                            disabled={yearDistributeDisabled}
                            onChange={(e) =>
                              setYearTotalDraft((d) => ({ ...d, [row]: e.target.value }))
                            }
                            onBlur={(e) => {
                              if (draft !== "") {
                                distributeYearTotal(row, e.target.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && draft !== "") {
                                distributeYearTotal(row, (e.target as HTMLInputElement).value);
                              }
                            }}
                            placeholder="0"
                            className={`h-7 px-1.5 text-xs text-right tabular-nums w-24 ${yearDistributeDisabled ? "bg-muted/40 text-muted-foreground/60 cursor-not-allowed" : ""}`}
                            title={
                              yearDistributeDisabled
                                ? "No past months in this year yet."
                                : isActual
                                ? "Distribute evenly across past months of this year"
                                : "Distribute evenly across all 12 months"
                            }
                          />
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium whitespace-nowrap">
                      {formatCurrencyCompact(totals[row], currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between mt-3">
          {entry ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear all
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
