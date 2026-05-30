import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrencyCompact } from "@/store/financialsStore";

interface Props {
  savings: number;
  income: number;
  currency: string;
  /** Compact rendering for tree/backlog rows. */
  compact?: boolean;
}

/**
 * Small inline badge showing total savings + income for a work item / backlog /
 * tree. Hover for the full breakdown.
 */
export function FinancialTotalsBadge({ savings, income, currency, compact = true }: Props) {
  const total = savings + income;
  if (total <= 0) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`tabular-nums shrink-0 inline-flex items-center rounded-full bg-muted text-muted-foreground ${
              compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs"
            }`}
          >
            {formatCurrencyCompact(total, currency)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          <div className="font-medium mb-0.5">Savings &amp; Income</div>
          <div className="tabular-nums">
            Savings: {formatCurrencyCompact(savings, currency)}
          </div>
          <div className="tabular-nums">
            Income: {formatCurrencyCompact(income, currency)}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
