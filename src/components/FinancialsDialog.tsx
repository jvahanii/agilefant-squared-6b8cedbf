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

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function FinancialsDialog({ workItemId, open, onOpenChange }: FinancialsDialogProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const entry = useFinancialsStore((s) => s.byWorkItem[workItemId]);
  const upsert = useFinancialsStore((s) => s.upsert);
  const remove = useFinancialsStore((s) => s.remove);

  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [savings, setSavings] = useState<MonthlyMap>({});
  const [income, setIncome] = useState<MonthlyMap>({});
  const [currency, setCurrency] = useState("EUR");
  const [yearTotalDraft, setYearTotalDraft] = useState<{ savings: string; income: string }>({
    savings: "",
    income: "",
  });

  useEffect(() => {
    if (!open) return;
    setSavings(entry?.savingsByMonth ? { ...entry.savingsByMonth } : {});
    setIncome(entry?.incomeByMonth ? { ...entry.incomeByMonth } : {});
    setCurrency(entry?.currency ?? "EUR");
    setYear(currentYear);
    setYearTotalDraft({ savings: "", income: "" });
  }, [open, entry, currentYear]);

  const totals = useMemo(() => {
    return {
      savings: sumMap(savings),
      income: sumMap(income),
    };
  }, [savings, income]);

  if (!item) return null;
  const orgId = item.organizationId ?? activeOrgId;
  if (!orgId) return null;

  const updateCell = (
    target: "savings" | "income",
    monthIndex: number,
    raw: string,
  ) => {
    const key = monthKey(year, monthIndex);
    const num = Number(raw);
    const setter = target === "savings" ? setSavings : setIncome;
    setter((prev) => {
      const next = { ...prev };
      if (!raw.trim() || !Number.isFinite(num) || num <= 0) {
        delete next[key];
      } else {
        next[key] = Math.min(num, MAX_AMOUNT);
      }
      return next;
    });
  };

  const distributeYearTotal = (
    target: "savings" | "income",
    raw: string,
  ) => {
    const num = Number(raw);
    const setter = target === "savings" ? setSavings : setIncome;
    setter((prev) => {
      const next = { ...prev };
      // Remove existing months for this year first
      for (let i = 0; i < 12; i++) {
        delete next[monthKey(year, i)];
      }
      if (raw.trim() && Number.isFinite(num) && num > 0) {
        const total = Math.min(num, MAX_AMOUNT * 12);
        // Distribute evenly and assign remainder to the last month to avoid rounding drift
        const base = Math.round((total / 12) * 100) / 100;
        const sum11 = base * 11;
        const last = Math.round((total - sum11) * 100) / 100;
        for (let i = 0; i < 11; i++) {
          next[monthKey(year, i)] = base;
        }
        next[monthKey(year, 11)] = Math.max(0, last);
      }
      return next;
    });
    setYearTotalDraft((d) => ({ ...d, [target]: "" }));
  };

  const handleSave = async () => {
    const hasAny = Object.keys(savings).length > 0 || Object.keys(income).length > 0;
    if (!hasAny) {
      if (entry) await remove(workItemId);
      onOpenChange(false);
      return;
    }
    await upsert(workItemId, orgId, {
      savingsByMonth: savings,
      incomeByMonth: income,
      currency,
    });
    onOpenChange(false);
  };

  const handleClear = async () => {
    if (entry) await remove(workItemId);
    onOpenChange(false);
  };

  const yearSavings = useMemo(() => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += savings[monthKey(year, i)] ?? 0;
    return s;
  }, [savings, year]);
  const yearIncome = useMemo(() => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += income[monthKey(year, i)] ?? 0;
    return s;
  }, [income, year]);

  // Reset drafts when year navigation clears the typed-but-not-committed value
  useEffect(() => {
    setYearTotalDraft({ savings: "", income: "" });
  }, [year]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] sm:max-w-4xl"
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
            <Select value={currency} onValueChange={setCurrency}>
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
          Amounts are entered in <span className="font-medium">{currency}</span>. Totals across lists and trees are shown in your chosen display currency and converted using daily ECB rates.
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
              {(["savings", "income"] as const).map((target) => {
                const map = target === "savings" ? savings : income;
                const yearTotal = target === "savings" ? yearSavings : yearIncome;
                return (
                  <tr key={target} className="border-t">
                    <td className="px-2 py-1 font-medium sticky left-0 bg-card z-10 whitespace-nowrap">
                      {target === "savings" ? "Savings" : "Income"}
                    </td>
                    {MONTH_LABELS.map((_, i) => {
                      const k = monthKey(year, i);
                      const v = map[k];
                      return (
                        <td key={i} className="p-0.5">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={v != null ? String(v) : ""}
                            onChange={(e) => updateCell(target, i, e.target.value)}
                            placeholder="0"
                            className="h-7 px-1.5 text-xs text-right tabular-nums"
                          />
                        </td>
                      );
                    })}
                    <td className="p-0.5 whitespace-nowrap">
                      {(() => {
                        const draft = yearTotalDraft[target];
                        const displayValue = draft !== "" ? draft : (yearTotal > 0 ? String(yearTotal) : "");
                        return (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={displayValue}
                            onChange={(e) =>
                              setYearTotalDraft((d) => ({ ...d, [target]: e.target.value }))
                            }
                            onBlur={(e) => {
                              if (draft !== "") {
                                distributeYearTotal(target, e.target.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && draft !== "") {
                                distributeYearTotal(target, (e.target as HTMLInputElement).value);
                              }
                            }}
                            placeholder="0"
                            className="h-7 px-1.5 text-xs text-right tabular-nums w-24"
                            title="Enter a year total to distribute evenly across months"
                          />
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium whitespace-nowrap">
                      {formatCurrencyCompact(totals[target], currency)}
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
