import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useWebAnalytics } from "@/lib/webAnalytics";
import { useOnboardingStep } from "@/lib/onboardingSteps";
import { enterDemoMode } from "@/lib/demoMode";
import { demoContent, DEMO_ORG, visitorOutline } from "@/lib/demoContent";
import { loadTryList, saveTryList, toTree } from "@/lib/tryList";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

/**
 * /try: the real app, without an account (2026-11-16). It opens on an example
 * organisation (lib/demoContent.ts) with the database switched off
 * (lib/demoMode.ts), so everything works and nothing is saved. What the
 * visitor adds is kept in this browser (lib/tryList.ts) and moves into their
 * first list when they sign up.
 *
 * It replaced a stand-alone checklist that looked nothing like the app.
 */

const SETTINGS = {
  timeLoggingEnabled: false,
  pointsEnabled: false,
  labelsEnabled: false,
  customStatusesEnabled: false,
  savingsIncomeEnabled: false,
  boardsEnabled: true,
  burnupsEnabled: false,
  persistNotificationsEnabled: false,
  publicLinksEnabled: false,
  ratingsEnabled: false,
  deadlinesEnabled: true,
  createdDatesEnabled: false,
  startEndDatesEnabled: false,
  scramblingEnabled: false,
};

function startTryOut(): Set<string> {
  enterDemoMode();
  const { workItems, backlogs, backlogTrees, seedItemIds } = demoContent();
  const firstTree = Object.values(backlogTrees).sort((a, b) => a.rank - b.rank)[0];
  const firstList = firstTree.rootBacklogIds[0];
  const opened = Object.values(workItems).find((it) => it.childrenIds.length > 0 && it.backlogAssignments[firstTree.id] === firstList);

  useOrgStore.setState({
    activeOrgId: DEMO_ORG,
    roleOverride: null,
    memberships: [{ organization_id: DEMO_ORG, organization_name: "Try-out", organization_slug: "try-out", role: "owner" }],
  } as never);
  useOrgSettingsStore.setState((s) => ({ settings: { ...s.settings, [DEMO_ORG]: SETTINGS } }) as never);
  useAppStore.setState({
    organizationId: DEMO_ORG,
    workItems,
    backlogs,
    backlogTrees,
    selectedWorkItemIds: [],
    expandedWorkItems: new Set(opened ? [opened.id] : []),
    searchQuery: "",
    isLoading: false,
    workItemsLoading: false,
    workItemsRefreshing: false,
    loadingProgress: 100,
    undoStack: [],
    redoStack: [],
    changeLog: [],
  } as never);
  useAppStore.getState().selectBacklog(firstList, firstTree.id);
  // What the visitor added before a reload is back where it started, so it
  // is not gone from view while it waits for sign-up.
  const kept = loadTryList();
  if (kept) {
    useAppStore.getState().addWorkItemTree(toTree(kept), firstList, firstTree.id);
    useAppStore.setState({ undoStack: [], redoStack: [] } as never);
  }
  return seedItemIds;
}

function TryOutBar() {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-primary px-3 py-1.5 text-xs text-primary-foreground sm:text-sm">
      <span className="font-semibold">Try-out</span>
      <span className="min-w-0 flex-1">
        <span className="sm:hidden">Nothing here is saved.</span>
        <span className="hidden sm:inline">
          Example lists to play with: add, nest, drag, mark done, open the board. Nothing is saved, but what you add
          comes with you when you sign up.
        </span>
      </span>
      {/* Plain links: leaving reloads the page, so the app starts afresh. */}
      <a href="/" className="underline-offset-2 hover:underline">
        Front page
      </a>
      <a
        href="/auth/sign-up"
        className="whitespace-nowrap rounded-md bg-background px-2.5 py-1 font-medium text-foreground hover:bg-background/90"
      >
        Sign up to keep it
      </a>
    </div>
  );
}

export default function Try() {
  useWebAnalytics();
  useOnboardingStep("try_opened");
  const [seed] = useState(startTryOut);

  // What the visitor adds is kept for sign-up; the examples are not.
  useEffect(() => {
    const keep = (s: ReturnType<typeof useAppStore.getState>) =>
      saveTryList(visitorOutline(s.workItems, s.backlogs, s.backlogTrees, seed));
    return useAppStore.subscribe((s, prev) => {
      if (s.workItems !== prev.workItems) keep(s);
    });
  }, [seed]);

  // Left by a link inside the app: start the next page afresh, with the
  // database client and the stores as a real session needs them.
  useEffect(() => {
    const startedAt = window.location.pathname;
    return () => {
      if (window.location.pathname !== startedAt) window.location.reload();
    };
  }, []);

  return <AppLayout banner={<TryOutBar />} tryOut />;
}
