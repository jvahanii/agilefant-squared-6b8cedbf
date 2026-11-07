/**
 * The dialogs a row can open, as one piece of state instead of a pair of
 * useStates each: which are open, and what each was opened with.
 */
import { useCallback, useMemo, useState } from "react";
import { releaseOverlayLock } from "@/lib/overlayLock";

export interface ScramblePrompt {
  kind: "scramble" | "reveal" | "unscramble";
  mode: "set" | "enter";
}

/** Each dialog, and what it is opened with: `true` for those opened as they are. */
export interface RowDialogPayloads {
  /** Delete, for items in several lists: from this one, or everywhere. */
  deleteChoice: string[];
  sortChildren: true;
  deleteLabel: string;
  respawn: true;
  scramble: ScramblePrompt;
  description: true;
  hyperlinks: true;
  financials: true;
  timeLog: true;
  moveTime: string[];
  snooze: true;
  deadline: true;
  createdDate: true;
  startEnd: true;
  attributes: true;
  moveToParent: string[];
  moveToBacklog: string[];
}
export type RowDialog = keyof RowDialogPayloads;

type PayloadArgs<K extends RowDialog> = RowDialogPayloads[K] extends true ? [] : [RowDialogPayloads[K]];

export interface RowDialogs {
  /** What each open dialog was opened with; absent when it is closed. */
  open: Partial<RowDialogPayloads>;
  show: <K extends RowDialog>(kind: K, ...payload: PayloadArgs<K>) => void;
  hide: (kind: RowDialog) => void;
  /** For a dialog's onOpenChange: closing it also lets the page scroll again. */
  onOpenChange: (kind: RowDialog) => (open: boolean) => void;
}

export function useRowDialogs(): RowDialogs {
  const [open, setOpen] = useState<Partial<RowDialogPayloads>>({});
  const show = useCallback(<K extends RowDialog>(kind: K, ...payload: PayloadArgs<K>) => {
    setOpen((o) => ({ ...o, [kind]: payload.length > 0 ? payload[0] : true }));
  }, []);
  const hide = useCallback((kind: RowDialog) => {
    setOpen((o) => {
      if (!(kind in o)) return o;
      const next = { ...o };
      delete next[kind];
      return next;
    });
  }, []);
  const onOpenChange = useCallback(
    (kind: RowDialog) => (isOpen: boolean) => {
      if (isOpen) return;
      hide(kind);
      releaseOverlayLock();
    },
    [hide],
  );
  return useMemo(() => ({ open, show, hide, onOpenChange }), [open, show, hide, onOpenChange]);
}
