import { useMemo, useState } from "react";
import { CheckCircle2, Circle, Smartphone, X } from "lucide-react";
import type { WorkItem } from "@/types/models";
import { closeSteps, gettingStartedSteps, stepsClosed, type StepKey } from "./startSteps";
import { OrgNameLine } from "./OrgNameLine";
import { StartChoice } from "./StartChoice";
import type { StartKind } from "./startPresets";
import { useInstallWay } from "@/lib/installPrompt";

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
 *
 * It also carries "Who is it for?" and the organisation's name, which
 * otherwise live under the first-item box: someone arriving from the try-out
 * brings items along, so that box is never shown to them (2026-11-16).
 */
export function GettingStarted({
  orgId,
  workItems,
  start,
  org,
}: {
  orgId: string;
  workItems: Record<string, WorkItem>;
  /** Who it is for, while the starter lists are untouched and the person may change them. */
  start?: { kind: StartKind; onChoose: (kind: StartKind) => Promise<void> };
  /** The organisation's name, for those who may rename it. */
  org?: { name: string; onRename: (name: string) => Promise<void> };
}) {
  const [closed, setClosed] = useState(() => stepsClosed(orgId));
  // Worked out at every change to any item, so not at all once closed.
  const steps = useMemo(() => (closed ? null : gettingStartedSteps(workItems)), [workItems, closed]);
  const install = useInstallWay();
  if (!steps || closed) return null;

  // Closing used to ask "what were you hoping Agilefant would do?" first
  // (2026-11-16). It met the people who had learnt the basics, not those
  // who left, and stood in the way of closing (2026-11-24): closing closes.
  const close = () => {
    closeSteps(orgId);
    setClosed(true);
  };

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="max-h-[50%] shrink-0 overflow-y-auto border-t bg-muted/40 px-3 py-2.5"
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
          onClick={close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* First: one-time choices, worth making before the lists fill up. */}
      {(start || org) && (
        <div className="mt-2 space-y-2 border-b pb-2.5">
          {start && <StartChoice kind={start.kind} onChoose={start.onChoose} />}
          {org && <OrgNameLine name={org.name} onRename={org.onRename} />}
        </div>
      )}
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
      {/* An icon on the home screen brings people back; offered where the
          browser can install the app, and explained on an iPhone. */}
      {install && (
        <div className="mt-2 flex items-start gap-2 border-t pt-2 text-sm">
          <Smartphone aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          {install.kind === "prompt" ? (
            <button
              type="button"
              className="text-left text-primary underline underline-offset-2 hover:no-underline"
              onClick={() => void install.install()}
            >
              Put Agilefant on your home screen
            </button>
          ) : (
            <span className="text-muted-foreground">
              To put Agilefant on your home screen, tap Share, then Add to Home Screen.
            </span>
          )}
        </div>
      )}
      {allDone && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          From here: rename your lists, add more trees, and switch on extras such as story points in your
          organisation's settings.
        </p>
      )}
    </section>
  );
}
