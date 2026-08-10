# Fix the two leaking realtime rank tests

## What is actually wrong

Confirmed by reading the code: the rank-echo suppression state in `src/store/appStore.ts` is **module-level**, not store state:

- `recentlyWrittenRanks` / `recentlyWrittenBoardRanks` (lines 625-626) are plain `Map`s living in module scope.
- `suppressLocalRankEcho` drops any incoming realtime rank event for a `workItemId::backlogId` written locally within the last 800 ms.
- Test `beforeEach` (`src/test/appStore.test.ts:84`) reseeds the store but cannot clear those maps.

So earlier tests in the same file that reorder `wi-1` in `bl-1` leave a fresh timestamp behind, and the two `applyRealtimeWorkItemRank` tests ("INSERT: sets rank…", "UPDATE: updates the rank…") get their event suppressed — hence `undefined` instead of `-5` and `0` instead of `42`. This is a test-isolation defect, not a product bug: in the real app the maps are per page-load and the 800 ms window is intended.

## The fix

1. In `src/store/appStore.ts`, add a small exported test-only reset (e.g. `resetRankEchoSuppression()`) that clears both maps, kept next to the existing suppression helpers and documented as used by tests.
2. Call it from the `beforeEach` in `src/test/appStore.test.ts` so every test starts with an empty suppression window.
3. Optionally also clear the module-level `pendingRankResorts` / `rankResortScheduled` flags in the same reset, since they leak the same way.

No behavior change in the running app.

## Verification

Run the store suite; all `applyRealtimeWorkItemRank` tests, including the two currently failing, must pass, and the rest of the file must stay green.
