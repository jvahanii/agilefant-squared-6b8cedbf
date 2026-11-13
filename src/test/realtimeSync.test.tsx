/**
 * The live updates (useRealtimeSync), pinned as they behave: which channels
 * are opened, which tables each listens to, and what each change does —
 * applied, or dropped for being in a tree this organisation cannot see.
 *
 * Written before the two near-copies of the table bindings (our own
 * organisation's channel and a partner's) were made one list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

type Payload = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown>; old: Record<string, unknown> };
type Binding = { channel: string; table: string; filter?: string; handler: (p: Payload) => void };
const bindings: Binding[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const channel = (name: string) => {
    const ch = {
      on: (_kind: string, opts: { table: string; filter?: string }, handler: (p: Payload) => void) => {
        bindings.push({ channel: name, table: opts.table, filter: opts.filter, handler });
        return ch;
      },
      subscribe: () => ch,
      unsubscribe: () => {},
    };
    return ch;
  };
  return { supabase: { channel, removeChannel: () => {}, from: () => ({}) } };
});

vi.mock("@/lib/realtimeHealth", () => ({
  noteVisibilityChange: () => {},
  subscribeWithHealth: (build: () => unknown) => {
    build();
    return () => {};
  },
}));

vi.mock("@/lib/currentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/currentUser")>()),
  getCurrentUserId: async () => "me",
}));

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  readOutgoingShares: async () => ({ data: [{ organization_id: "out" }, { organization_id: "partner" }], error: null }),
}));

import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { useTeamStore } from "@/store/teamStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useBacklogStatusesStore } from "@/store/backlogStatusesStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { useFinancialsStore } from "@/store/financialsStore";
import { useTargetsStore } from "@/store/targetsStore";
import { usePublishedLinksStore } from "@/store/publishedLinksStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { useScrambledListsStore } from "@/store/scrambledListsStore";

/** Every store update the hook can make, as a spy that records its name. */
let calls: string[] = [];
const spy = (name: string) => (...args: unknown[]) => {
  const first = args[0];
  calls.push(`${name}(${typeof first === "string" ? first : first && typeof first === "object" && "eventType" in first ? (first as Payload).eventType : ""})`);
};

function stubStores() {
  useAppStore.setState({
    applyRealtimeWorkItem: spy("workItem"),
    applyRealtimeWorkItemRank: spy("rank"),
    applyRealtimeWorkItemBoardRank: spy("boardRank"),
    applyRealtimeBacklog: spy("backlog"),
    applyRealtimeBacklogTree: spy("tree"),
    applyRealtimeHyperlink: spy("hyperlink"),
  } as never);
  useTimeEntryStore.setState({ applyRealtimeTimeEntry: spy("timeEntry") } as never);
  useTeamStore.setState({ applyRealtimeTeamAssignment: spy("teamAssignment"), applyRealtimeTeam: spy("team") } as never);
  useOrgSettingsStore.setState({ applyRealtimeSettings: spy("settings") } as never);
  useLabelsStore.setState({ applyRealtimeLabel: spy("label"), applyRealtimeAssignment: spy("labelAssignment") } as never);
  useBacklogStatusesStore.setState({ applyRealtimeStatus: spy("status") } as never);
  useSnoozeStore.setState({ applyRealtimeSnooze: spy("snooze") } as never);
  useFinancialsStore.setState({ applyRealtime: spy("financials") } as never);
  useTargetsStore.setState({ applyRealtime: spy("target") } as never);
  usePublishedLinksStore.setState({ scheduleLoad: spy("publishedLinksReload") } as never);
  useScrambledItemsStore.setState({ scheduleLoad: spy("scrambledItemsReload") } as never);
  useJiraIssuesStore.setState({ scheduleLoad: spy("jiraReload") } as never);
  useScrambledListsStore.setState({ scheduleLoad: spy("scrambledListsReload") } as never);
}

function Host() {
  useRealtimeSync();
  return null;
}

/** A row in a tree we can see, and one in a tree we cannot. */
const SEEN = { id: "r", work_item_id: "known", backlog_id: "kb", tree_id: "partner::t2", backlog_assignments: { "partner::t2": "kb" } };
const UNSEEN = { id: "r", work_item_id: "nope", backlog_id: "nob", tree_id: "x::t9", backlog_assignments: { "x::t9": "b" } };

beforeEach(async () => {
  bindings.length = 0;
  calls = [];
  stubStores();
  useOrgStore.setState({ activeOrgId: "org" });
  useAppStore.setState({
    backlogTrees: { "org::t1": { id: "org::t1" }, "partner::t2": { id: "partner::t2" } },
    backlogs: { kb: { id: "kb", treeId: "partner::t2" } },
    workItems: { known: { id: "known", backlogAssignments: { "partner::t2": "kb" } } },
  } as never);
  render(<Host />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("live updates", () => {
  it("open these channels, each listening to these tables", () => {
    const byChannel: Record<string, string[]> = {};
    for (const b of bindings) (byChannel[b.channel] ??= []).push(`${b.table}${b.filter ? ` [${b.filter}]` : ""}`);
    for (const list of Object.values(byChannel)) list.sort();
    expect(byChannel).toMatchSnapshot();
  });

  it("listen to each table once, however many organisations share trees with us", () => {
    // Every binding is a subscription Realtime checks each change against.
    // With two partners this was 43: each partner had its own copy of the tables.
    const perTable = new Map<string, number>();
    for (const b of bindings) perTable.set(b.table, (perTable.get(b.table) ?? 0) + 1);
    expect([...perTable].filter(([, n]) => n > 1)).toEqual([]);
    expect(bindings.length).toBe(21);
    expect(bindings.find((b) => b.table === "work_items")?.filter).toBe("organization_id=in.(org,out,partner)");
    expect(bindings.find((b) => b.table === "organization_settings")?.filter).toBe("organization_id=eq.org");
  });

  it("apply each change, or drop it when it is in a tree that cannot be seen", () => {
    // Keyed by the organisation a change comes from, not by channel: which
    // channel carries it is the hook's business. Each change goes to every
    // binding whose filter lets it through, as Realtime would send it.
    const covers = (filter: string | undefined, org: string) => {
      const eq = /^organization_id=eq\.(.+)$/.exec(filter ?? "");
      if (eq) return eq[1] === org;
      const inList = /^organization_id=in\.\((.*)\)$/.exec(filter ?? "");
      if (inList) return inList[1].split(",").includes(org);
      return true;
    };
    const outcome: Record<string, Record<string, string[]>> = {};
    for (const org of ["org", "partner", "out"]) {
      for (const b of bindings) {
        if (!covers(b.filter, org)) continue;
        // A deletion carries only the primary key on a table with row-level security.
        const rows: Array<[string, Payload]> = [
          ["insert seen", { eventType: "INSERT", new: { ...SEEN, organization_id: org }, old: {} }],
          ["update unseen", { eventType: "UPDATE", new: { ...UNSEEN, organization_id: org }, old: {} }],
          ["delete unseen", { eventType: "DELETE", new: {}, old: UNSEEN }],
        ];
        for (const [what, payload] of rows) {
          calls = [];
          b.handler(payload);
          const key = `${b.table}: ${what}`;
          expect((outcome[org] ??= {})[key], `${org} ${key} heard twice`).toBeUndefined();
          outcome[org][key] = [...calls];
        }
      }
    }
    for (const org of Object.keys(outcome)) {
      outcome[org] = Object.fromEntries(Object.entries(outcome[org]).sort(([a], [b]) => a.localeCompare(b)));
    }
    expect(outcome).toMatchSnapshot();
  });
});
