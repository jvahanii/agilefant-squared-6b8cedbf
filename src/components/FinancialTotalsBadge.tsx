import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrencyCompact, formatAmountCompact } from "@/store/financialsStore";

interface Props {
  actual: number;
  plan: number;
  currency: string;
  /** Compact rendering for tree/backlog rows. */
  compact?: boolean;
}

/**
 * Small inline badge showing actual/plan totals for a work item / backlog /
 * tree. Hover for the full breakdown.
 */
export function FinancialTotalsBadge({ actual, plan, currency, compact = true }: Props) {
  if (actual <= 0 && plan <= 0) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`tabular-nums shrink-0 inline-flex items-center rounded-full bg-muted text-muted-foreground ${
              compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs"
            }`}
          >
            {currency} {formatAmountCompact(actual)}/{formatAmountCompact(plan)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          <div className="font-medium mb-0.5">Actual / Plan</div>
          <div className="tabular-nums">
            Actual: {formatCurrencyCompact(actual, currency)}
          </div>
          <div className="tabular-nums">
            Plan: {formatCurrencyCompact(plan, currency)}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
