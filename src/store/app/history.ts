/**
 * The undo history's bookkeeping: the copies undo goes back to, one undo step
 * for a bulk operation, and the count of edits the background refresh checks.
 * Taken out of appStore.ts word for word.
 */
import type { AppState, DataSnapshot, GetState, SetState } from "./types";

// Shallow snapshot for undo/redo. All reducers construct fresh objects when
// modifying entries (spread-and-replace), so sharing child references between
// a snapshot and live state is safe — nothing mutates a stored object in
// place after the fact. Keeping this shallow is critical for perf on bulk
// operations over large maps.
export const snapshot = (state: DataSnapshot): DataSnapshot => ({
  workItems: { ...state.workItems },
  backlogs: { ...state.backlogs },
  backlogTrees: { ...state.backlogTrees },
  hyperlinks: { ...state.hyperlinks },
  selectedBacklogIds: [...state.selectedBacklogIds],
  selectedTreeId: state.selectedTreeId,
  selectedWorkItemIds: [...state.selectedWorkItemIds],
  changeLog: state.changeLog,
  expandedWorkItems: new Set(state.expandedWorkItems),
  expandedBacklogs: new Set(state.expandedBacklogs),
});

export const MAX_UNDO = 100;

/**
 * Bulk-operation tracking: when `undoBatchDepth > 0`, mutators skip pushing
 * their own undo snapshot; the `runBulk` wrapper captures exactly one
 * snapshot at the start of the outermost batch and pushes it when the batch
 * ends, so a multi-item operation becomes a single undo step.
 */
export let undoBatchDepth = 0;

export let pendingBatchSnapshot: DataSnapshot | null = null;

/**
 * Mutation counter that increments on every user-initiated change to workItems,
 * backlogs, or backlogTrees.  The background refresh uses this to detect
 * whether the user made edits while the Supabase fetch was in-flight, and
 * skips overwriting state with potentially stale data if so.
 */
export let localMutationVersion = 0;

export function bumpMutationVersion() {
  localMutationVersion++;
}

export function pushUndoEntry(state: AppState): DataSnapshot[] {
  if (undoBatchDepth > 0) return state.undoStack;
  bumpMutationVersion();
  return [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)];
}

/**
 * runBulk: what `fn` does is one undo step. The copy is taken at the start of
 * the outermost batch, and put on the stack at its end if anything changed.
 */
export function runAsOneUndoStep(fn: () => void, get: GetState, set: SetState): void {
    let preState: AppState | null = null;
    if (undoBatchDepth === 0) {
      preState = get();
      pendingBatchSnapshot = snapshot(preState);
    }
    undoBatchDepth++;
    try {
      fn();
    } finally {
      undoBatchDepth--;
      if (undoBatchDepth === 0 && pendingBatchSnapshot) {
        const snap = pendingBatchSnapshot;
        pendingBatchSnapshot = null;
        const after = get();
        // Skip the snapshot if nothing relevant changed (e.g. early-return
        // path inside the batch). Mutators always replace these maps, so
        // reference equality is a safe "no change" detector.
        const changed =
          !preState ||
          after.workItems !== preState.workItems ||
          after.backlogs !== preState.backlogs ||
          after.backlogTrees !== preState.backlogTrees ||
          after.hyperlinks !== preState.hyperlinks;
        if (changed) {
          set((state) => ({
            undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snap],
            redoStack: [],
          }));
        }
      }
    }
}
