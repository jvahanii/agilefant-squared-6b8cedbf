/**
 * Live updates by broadcast (2026-11-17; migration 20261117100000): the app
 * listens to two private channels, applies each change as the Postgres change
 * it replaces would have been, and falls back to Postgres changes if a
 * private channel is refused.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Handler = (msg: { payload: unknown }) => void;
const opened: Array<{ name: string; config?: { config?: { private?: boolean } }; kind?: string; handler?: Handler }> = [];
const status = vi.hoisted(() => ({ refuse: false }));

vi.mock("@/integrations/supabase/client", () => {
  const channel = (name: string, config?: { config?: { private?: boolean } }) => {
    const entry: (typeof opened)[number] = { name, config };
    opened.push(entry);
    const ch = {
      topic: name,
      on: (kind: string, _opts: unknown, handler: Handler) => {
        entry.kind ??= kind;
        entry.handler ??= handler;
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
  subscribeWithHealth: (build: () => unknown, onStatus?: (s: string, e?: Error) => void) => {
    build();
    if (status.refuse) {
      onStatus?.("CHANNEL_ERROR", new Error('"Unauthorized: You do not have permissions to read from this Channel topic: org:org"'));
    }
    return () => {};
  },
}));

vi.mock("@/lib/currentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/currentUser")>()),
  getCurrentUserId: async () => "me",
}));

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  readOutgoingShares: async () => ({ data: [], error: null }),
}));

import { applyBroadcastChange, onTreeSharesChanged, setLiveUpdatesByBroadcast, useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { usePublishedLinksStore } from "@/store/publishedLinksStore";
import { useTeamStore } from "@/store/teamStore";

let calls: string[] = [];
const spy = (name: string) => (...args: unknown[]) => {
  const first = args[0] as { eventType?: string } | string;
  calls.push(`${name}(${typeof first === "string" ? first : first?.eventType ?? ""})`);
};

function Host() {
  useRealtimeSync();
  return null;
}

beforeEach(() => {
  opened.length = 0;
  calls = [];
  status.refuse = false;
  setLiveUpdatesByBroadcast(true);
  useAppStore.setState({
    applyRealtimeWorkItem: spy("workItem"),
    applyRealtimeBacklogTree: spy("tree"),
    backlogTrees: { "org::t1": { id: "org::t1" }, "partner::t2": { id: "partner::t2" } },
    backlogs: {},
    workItems: {},
  } as never);
  useOrgSettingsStore.setState({ applyRealtimeSettings: spy("settings") } as never);
  useSnoozeStore.setState({ applyRealtimeSnooze: spy("snooze") } as never);
  usePublishedLinksStore.setState({ scheduleLoad: spy("publishedLinksReload") } as never);
  useTeamStore.setState({ applyRealtimeTeam: spy("team") } as never);
  useOrgStore.setState({ activeOrgId: "org" });
});

const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

describe("live updates by broadcast", () => {
  it("listen to two private channels: the organisation's and the person's", async () => {
    render(<Host />);
    await settle();
    expect(opened.map((c) => [c.name, c.config?.config?.private, c.kind])).toEqual([
      ["org:org", true, "broadcast"],
      ["user:me", true, "broadcast"],
    ]);
  });

  it("apply a change of ours, and a partner's only where it is in a tree we can see", () => {
    applyBroadcastChange({ table: "work_items", op: "UPDATE", row: { id: "a", organization_id: "org", backlog_assignments: {} } }, "org");
    applyBroadcastChange({ table: "work_items", op: "INSERT", row: { id: "b", organization_id: "partner", backlog_assignments: { "partner::t2": "x" } } }, "org");
    applyBroadcastChange({ table: "work_items", op: "INSERT", row: { id: "c", organization_id: "partner", backlog_assignments: { "x::t9": "y" } } }, "org");
    expect(calls).toEqual(["workItem(UPDATE)", "workItem(INSERT)"]);
  });

  it("take trees and settings from our own organisation only", () => {
    applyBroadcastChange({ table: "backlog_trees", op: "INSERT", row: { id: "t", organization_id: "partner" } }, "org");
    applyBroadcastChange({ table: "organization_settings", op: "UPDATE", row: { organization_id: "partner" } }, "org");
    applyBroadcastChange({ table: "organization_settings", op: "UPDATE", row: { organization_id: "org" } }, "org");
    expect(calls).toEqual(["settings(UPDATE)"]);
  });

  it("tell the page when a tree's shares change, so it reloads", () => {
    let told = 0;
    const stop = onTreeSharesChanged(() => told++);
    applyBroadcastChange({ table: "backlog_tree_shares", op: "INSERT", row: { tree_id: "org::t1", organization_id: "partner" } }, "org");
    stop();
    applyBroadcastChange({ table: "backlog_tree_shares", op: "DELETE" }, "org");
    expect(told).toBe(1);
  });

  it("reload what is sent without its contents", () => {
    applyBroadcastChange({ table: "published_links", op: "DELETE" }, "org");
    expect(calls).toEqual(["publishedLinksReload()"]);
  });

  it("apply a snooze from the person's own channel", async () => {
    render(<Host />);
    await settle();
    opened.find((c) => c.name === "user:me")!.handler!({ payload: { table: "work_item_snoozes", op: "INSERT", row: { id: "s" } } });
    expect(calls).toEqual(["snooze(INSERT)"]);
  });

  it("fall back to Postgres changes when a private channel is refused", async () => {
    status.refuse = true;
    render(<Host />);
    await settle();
    status.refuse = false;
    await settle();
    expect(opened.some((c) => c.name === "entity-realtime-org" && c.kind === "postgres_changes")).toBe(true);
  });
});

describe("the migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261117100000_live_updates_by_broadcast.sql"), "utf8").replace(/--[^\n]*/g, "");
  const hook = readFileSync(join(process.cwd(), "src/hooks/useRealtimeSync.ts"), "utf8");

  it("drops the old rule that fails on Clerk user ids and would refuse every private channel", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Authenticated users can listen to their org channels" ON realtime.messages;');
  });

  it("puts a trigger on every table the app listens to", () => {
    const tables = [...hook.matchAll(/table: '([a-z_]+)'/g)].map((m) => m[1]).concat("work_item_snoozes", "backlog_tree_shares");
    for (const t of new Set(tables)) expect(sql, t).toContain(`'${t}'`);
  });

  it("never sends public link tokens, scrambled names or Jira details", () => {
    expect(sql).toContain("IN ('published_links', 'work_item_scrambles', 'backlog_scrambles', 'jira_issue_links', 'jira_connections')");
    expect(sql).toContain("_payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);");
  });

  it("lets only members, the person and superusers listen, to broadcasts only", () => {
    expect(sql).toContain("realtime.messages.extension = 'broadcast' AND public.may_hear_topic(realtime.topic())");
    expect(sql).toContain("public.is_member_of(_uid, substr(_topic, 5)::uuid) OR public.is_superuser(_uid)");
    expect(sql).toContain("_topic = 'user:' || _uid::text");
  });

  it("keeps a copied-in list from sending a message per row", () => {
    expect(sql).toContain("ALTER FUNCTION public.add_new_published_items(uuid, jsonb, integer) RENAME TO add_new_published_items_loudly");
    expect(sql).toContain("PERFORM set_config('agilefant.quiet', 'on', true);\n  _added := public.add_new_published_items_loudly(_copy_id, _payload, _limit);");
    expect(sql).toContain("current_setting('agilefant.quiet', true) = 'on'");
  });
});

describe("the nightly backup", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261117110000_backup_only_changed.sql"), "utf8").replace(/--[^\n]*/g, "");
  const fn = readFileSync(join(process.cwd(), "supabase/functions/daily-backup/index.ts"), "utf8");

  it("backs up only organisations that changed since their newest backup", () => {
    expect(sql).toContain("IF _last IS NOT NULL AND NOT public.organization_changed_since(_org_id, _last - interval '1 hour') THEN");
    expect(fn).toContain('admin.rpc("create_organization_backup_if_changed"');
    expect(fn).not.toContain('admin.rpc("create_organization_backup",');
  });

  it("is for the nightly job only", () => {
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.create_organization_backup_if_changed(uuid) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.create_organization_backup_if_changed(uuid) TO service_role");
  });
});
