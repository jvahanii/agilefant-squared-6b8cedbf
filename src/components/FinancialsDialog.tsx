import { useEffect, useState } from "react";
import { z } from "zod";
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
import { useFinancialsStore } from "@/store/financialsStore";
import { useOrgStore } from "@/store/orgStore";
import { toast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";

interface FinancialsDialogProps {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CURRENCIES = ["EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CHF", "SEK", "NOK", "DKK"];

const schema = z.object({
  monthlySavings: z.number().min(0).max(1_000_000_000),
  monthlyIncome: z.number().min(0).max(1_000_000_000),
  currency: z.string().min(1).max(8),
});

export function FinancialsDialog({ workItemId, open, onOpenChange }: FinancialsDialogProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const entry = useFinancialsStore((s) => s.byWorkItem[workItemId]);
  const upsert = useFinancialsStore((s) => s.upsert);
  const remove = useFinancialsStore((s) => s.remove);

  const [savings, setSavings] = useState("");
  const [income, setIncome] = useState("");
  const [currency, setCurrency] = useState("EUR");

  useEffect(() => {
    if (!open) return;
    setSavings(entry?.monthlySavings ? String(entry.monthlySavings) : "");
    setIncome(entry?.monthlyIncome ? String(entry.monthlyIncome) : "");
    setCurrency(entry?.currency ?? "EUR");
  }, [open, entry]);

  if (!item) return null;

  const orgId = item.organizationId ?? activeOrgId;
  if (!orgId) return null;

  const handleSave = async () => {
    const parsed = schema.safeParse({
      monthlySavings: Number(savings || 0),
      monthlyIncome: Number(income || 0),
      currency,
    });
    if (!parsed.success) {
      toast({ title: "Invalid values", description: parsed.error.issues[0]?.message, variant: "destructive" });
      return;
    }
    if (parsed.data.monthlySavings === 0 && parsed.data.monthlyIncome === 0) {
      if (entry) await remove(workItemId);
      onOpenChange(false);
      return;
    }
    await upsert(workItemId, orgId, {
      monthlySavings: parsed.data.monthlySavings,
      monthlyIncome: parsed.data.monthlyIncome,
      currency: parsed.data.currency,
    });
    onOpenChange(false);
  };

  const handleClear = async () => {
    if (entry) await remove(workItemId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Savings &amp; Income</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-2 truncate" title={item.title}>
          {item.title}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Monthly savings</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={savings}
              onChange={(e) => setSavings(e.target.value)}
              placeholder="0.00"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Monthly income</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={income}
              onChange={(e) => setIncome(e.target.value)}
              placeholder="0.00"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Amounts accrue each month from when this entry is first created. They appear in the
            cumulative flow diagram for this backlog tree.
          </p>
        </div>

        <div className="flex justify-between mt-4">
          {entry ? (
            <Button variant="ghost" size="sm" onClick={handleClear} className="text-destructive hover:text-destructive">
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear
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
