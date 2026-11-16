import { useMemo, useState } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import type { WorkItem } from "@/types/models";
import { closeSteps, gettingStartedSteps, stepsClosed, type StepKey } from "./startSteps";

const TEXT: Record<StepKey, { title: string; how: string }> = {
  more: {
    title: "Add a few more items",
    how: "Use + at the top of the list. The clipboard button next to it adds one item per copied line.",
  },
  nest: {
    title: "Put an item under another",
    how: "Select it and press Tab (Shift+Tab takes it back out), or drag it onto the other item.",
  },
  done: {
    title: "Mark an item done",
    how: "Double-click it, or click its coloured dot and pick Done.",
  },
};

/**
 * What to do after the first item, at the foot of the list in a new
 * organisation. The first-item prompt used to be the only help: once it was
 * answered the person was on their own, and of 34 people who signed up from
 * August to mid-November 2026 only 4 came back after their first day. The
 * steps tick off as they are done and the panel stays until closed.
 */
export function GettingStarted({ orgId, workItems }: { orgId: string; workItems: Record<string, WorkItem> }) {
  const steps = useMemo(() => gettingStartedSteps(Object.values(workItems)), [workItems]);
  const [closed, setClosed] = useState(() => stepsClosed(orgId));
  if (!steps || closed) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="shrink-0 border-t bg-muted/40 px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <h2 id="getting-started-heading" className="text-sm font-semibold">
          {allDone ? "That's the basics" : "Getting started"}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {doneCount} of {steps.length} done
        </span>
        <button
          type="button"
          className="ml-auto -mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close getting started"
          onClick={() => {
            closeSteps(orgId);
            setClosed(true);
          }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <ol className="mt-1.5 space-y-1.5">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-sm">
            {s.done ? (
              <CheckCircle2 aria-hidden className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
            ) : (
              <Circle aria-hidden className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/60" />
            )}
            <div className="min-w-0">
              <span className={s.done ? "text-muted-foreground line-through" : ""}>{TEXT[s.key].title}</span>
              <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
              {!s.done && <span className="block text-xs text-muted-foreground">{TEXT[s.key].how}</span>}
            </div>
          </li>
        ))}
      </ol>
      {allDone && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          From here: rename your lists, add more trees, and switch on extras such as story points in your
          organisation's settings.
        </p>
      )}
    </section>
  );
}
