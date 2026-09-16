/**
 * The "Check for closed ads" button in the backlog header reads this store. What it has
 * to get right is the bookkeeping either side of the request: a work item may
 * carry several links and a link may be on several items, batches must not
 * exceed what the endpoint accepts, and a run that fails half way is still
 * worth what it found — the items already marked are as true as they were.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import { POSTING_BATCH, useClosedPostingsStore } from "@/store/closedPostingsStore";

const state = () => useClosedPostingsStore.getState();

/** Answer as the endpoint does: every URL asked about, closed or not. */
const answer = (closedUrls: string[]) => (_name: string, opts: { body: { urls: string[] } }) => ({
  data: { results: opts.body.urls.map((url) => ({ url, closed: closedUrls.includes(url) })) },
  error: null,
});

/** Answer as a board that refuses us does: reachable, but nothing learnt. */
const refuse = (status: number) => (_name: string, opts: { body: { urls: string[] } }) => ({
  data: { results: opts.body.urls.map((url) => ({ url, closed: false, unreachable: status })) },
  error: null,
});

beforeEach(() => {
  useClosedPostingsStore.setState({
    closed: new Set(),
    checked: new Set(),
    unknown: new Set(),
    checking: false,
    progress: null,
  });
  invoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("closedPostingsStore", () => {
  it("marks the items whose posting has closed, and only those", async () => {
    invoke.mockImplementation(answer(["https://b.example/2"]));

    const result = await state().check([
      { id: "i1", title: "i1", urls: ["https://b.example/1"] },
      { id: "i2", title: "i2", urls: ["https://b.example/2"] },
      { id: "i3", title: "i3", urls: ["https://b.example/3"] },
    ]);

    expect([...state().closed]).toEqual(["i2"]);
    expect([...state().checked].sort()).toEqual(["i1", "i2", "i3"]);
    expect(result).toEqual({ closed: 1, checked: 3, unknown: 0, fromTitle: 0, error: undefined });
  });

  it("closes an item when any one of its links has closed", async () => {
    invoke.mockImplementation(answer(["https://b.example/second"]));

    await state().check([{ id: "i1", title: "i1", urls: ["https://b.example/first", "https://b.example/second"] }]);

    expect([...state().closed]).toEqual(["i1"]);
  });

  it("marks every item sharing a closed link, and fetches it once", async () => {
    invoke.mockImplementation(answer(["https://b.example/same"]));

    await state().check([
      { id: "i1", title: "i1", urls: ["https://b.example/same"] },
      { id: "i2", title: "i2", urls: ["https://b.example/same"] },
    ]);

    expect([...state().closed].sort()).toEqual(["i1", "i2"]);
    expect(invoke.mock.calls[0][1].body.urls).toEqual(["https://b.example/same"]);
  });

  it("splits a long list into batches the endpoint will accept", async () => {
    invoke.mockImplementation(answer([]));
    const items = Array.from({ length: POSTING_BATCH + 5 }, (_, i) => ({
      id: `i${i}`,
      title: `i${i}`,
      urls: [`https://b.example/${i}`],
    }));

    await state().check(items);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][1].body.urls).toHaveLength(POSTING_BATCH);
    expect(invoke.mock.calls[1][1].body.urls).toHaveLength(5);
    expect(state().checked.size).toBe(POSTING_BATCH + 5);
  });

  it("keeps what the first batch found when a later one fails", async () => {
    invoke
      .mockImplementationOnce(answer(["https://b.example/0"]))
      .mockResolvedValueOnce({ data: null, error: new Error("network is down") });
    const items = Array.from({ length: POSTING_BATCH + 5 }, (_, i) => ({
      id: `i${i}`,
      title: `i${i}`,
      urls: [`https://b.example/${i}`],
    }));

    const result = await state().check(items);

    expect([...state().closed]).toEqual(["i0"]);
    expect(result.checked).toBe(POSTING_BATCH);
    expect(result.error).toBe("network is down");
    expect(state().checking).toBe(false);
  });

  it("reports an error the endpoint returned in its body", async () => {
    invoke.mockResolvedValue({ data: { error: "forbidden: superuser only" }, error: null });

    const result = await state().check([{ id: "i1", title: "i1", urls: ["https://b.example/1"] }]);

    expect(result.error).toBe("forbidden: superuser only");
    expect(state().closed.size).toBe(0);
  });

  it("does nothing, and asks nothing, when no item carries a link", async () => {
    const result = await state().check([{ id: "i1", title: "i1", urls: [] }]);

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({ closed: 0, checked: 0, unknown: 0, fromTitle: 0 });
  });

  it("drops a previous run's marks when a new one starts", async () => {
    useClosedPostingsStore.setState({ closed: new Set(["stale"]), checked: new Set(["stale"]) });
    invoke.mockImplementation(answer([]));

    await state().check([{ id: "i1", title: "i1", urls: ["https://b.example/1"] }]);

    expect([...state().closed]).toEqual([]);
    expect([...state().checked]).toEqual(["i1"]);
  });

  /**
   * The distinction the whole feature rests on. LinkedIn answers 999 to an
   * address it takes for a robot, and a backlog checked from a datacentre meets
   * that often. Counting those as open would report a list of dead ads as a
   * healthy one — which is exactly what it did, until it said so.
   */
  it("does not count a posting it could not read as open", async () => {
    invoke.mockImplementation(refuse(999));

    const result = await state().check([
      { id: "i1", title: "i1", urls: ["https://b.example/1"] },
      { id: "i2", title: "i2", urls: ["https://b.example/2"] },
    ]);

    expect([...state().unknown].sort()).toEqual(["i1", "i2"]);
    expect(state().closed.size).toBe(0);
    expect(result).toEqual({ closed: 0, checked: 2, unknown: 2, fromTitle: 0, error: undefined });
  });

  it("settles an item from whichever of its links did answer", async () => {
    invoke.mockImplementation((_name: string, opts: { body: { urls: string[] } }) => ({
      data: {
        results: opts.body.urls.map((url) => ({
          url,
          closed: false,
          unreachable: url.endsWith('blocked') ? 999 : null,
        })),
      },
      error: null,
    }));

    await state().check([{ id: "i1", title: "i1", urls: ["https://b.example/blocked", "https://b.example/fine"] }]);

    expect([...state().unknown]).toEqual([]);
    expect([...state().checked]).toEqual(["i1"]);
  });

  /**
   * The cheapest answer there is. The import writes the closing date into the
   * title, so an item whose date has gone by is closed without asking anyone --
   * and a board that refuses the request cannot take that away.
   */
  it("closes an item from its own title without a request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T09:00:00.000Z"));
    invoke.mockImplementation(answer([]));

    const result = await state().check([
      { id: "past", title: "0816 OP Senior Product Owner", urls: ["https://b.example/1"] },
      { id: "ahead", title: "0920 Fennia Product owner", urls: ["https://b.example/2"] },
    ]);

    expect([...state().closed]).toEqual(["past"]);
    expect(result.fromTitle).toBe(1);
    // Only the one still ahead of its date was worth a request.
    expect(invoke.mock.calls[0][1].body.urls).toEqual(["https://b.example/2"]);
  });

  it("asks nothing at all when every title has already answered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T09:00:00.000Z"));

    const result = await state().check([
      { id: "a", title: "0816 One", urls: ["https://b.example/1"] },
      { id: "b", title: "0901 Two", urls: ["https://b.example/2"] },
    ]);

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({ closed: 2, checked: 2, unknown: 0, fromTitle: 2 });
    expect([...state().closed].sort()).toEqual(["a", "b"]);
  });

  it("clears on request, for when the backlog in view changes", () => {
    useClosedPostingsStore.setState({ closed: new Set(["i1"]), checked: new Set(["i1"]) });
    state().clear();
    expect(state().closed.size).toBe(0);
    expect(state().checked.size).toBe(0);
  });
});
