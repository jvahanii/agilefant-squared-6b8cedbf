/**
 * The test setup keeps every test away from the live database (2026-11-17):
 * requests to a Supabase address are answered locally, and sockets never
 * connect. Before, tests that did not mock the client reached production.
 */
import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

describe("tests and the live database", () => {
  it("a request to Supabase is answered here as unavailable", async () => {
    const res = await fetch("https://hwwjwkdbautfkhpxuord.supabase.co/rest/v1/work_items?select=id");
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe("Tests do not reach the database");
  });

  it("the real client gets that answer instead of production's", async () => {
    const { error } = await supabase.rpc("current_user_id" as never);
    expect(error?.message).toBe("Tests do not reach the database");
  });

  it("sockets never connect", () => {
    const socket = new WebSocket("wss://hwwjwkdbautfkhpxuord.supabase.co/realtime/v1/websocket");
    expect(socket.readyState).toBe(0);
  });
});
