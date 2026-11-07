/**
 * The Gmail server function (supabase/functions/gmail-connector), action by
 * action, pinned as it answers: what each refuses, and what it answers and
 * asks of the database and Gmail when it has what it needs.
 *
 * Written before its one long handler was taken apart into a function per
 * action. The database, Gmail and Google are stand-ins here; what is pinned
 * is the handler's own logic.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/** Every question put to the database, as table and calls. */
let dbCalls: string[] = [];
/** What a table answers, by name; a membership row unless said otherwise. */
let tableAnswers: Record<string, { data: unknown; error: unknown }> = {};

function fakeAdmin() {
  return {
    from(table: string) {
      const calls: string[] = [];
      const answer = () => {
        dbCalls.push(`${table}: ${calls.join(" ")}`);
        return Promise.resolve(tableAnswers[table] ?? { data: { id: "m", role: "member" }, error: null });
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "delete", "upsert", "update", "insert"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push(`${m}(${args.map((a) => (typeof a === "string" ? a : Array.isArray(a) ? `[${a.length}]` : typeof a)).join(",")})`);
          return builder;
        };
      }
      builder.maybeSingle = answer;
      builder.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => answer().then(ok, bad);
      return builder;
    },
  };
}

const gmailCalls: string[] = [];
vi.mock("../../supabase/functions/_shared/gmail.ts", async () => {
  const corsHeaders = { "Access-Control-Allow-Origin": "*" };
  return {
    adminClient: () => fakeAdmin(),
    corsHeaders,
    json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
    decryptKey: async (k: string) => `plain:${k}`,
    encryptKey: async (k: string) => `enc:${k}`,
    env: (name: string) => `env:${name}`,
    exchangeCode: async (code: string) => `gateway-key-for-${code}`,
    forScope: (query: { is: (...a: unknown[]) => unknown; eq: (...a: unknown[]) => unknown }, shared: boolean, organizationId: string) =>
      shared ? query.is("organization_id", null) : query.eq("organization_id", organizationId),
    getConnection: async () => ({ auth: { kind: "gateway", key: "k" }, email: "me@example.com" }),
    getOAuthClient: async () => (tableAnswers.__oauthClient?.data ?? null),
    gmail: async () => ({ emailAddress: "me@example.com" }),
    GOOGLE_SCOPES: ["scope"],
    markMessagesRead: async (_auth: unknown, ids: string[]) => {
      gmailCalls.push(`markRead ${ids.length}`);
    },
    searchLinks: async (_auth: unknown, query: string, max: number, mode: string) => {
      gmailCalls.push(`search ${query} ${max} ${mode}`);
      return [
        { url: "https://x/a", title: "Job A", messageId: "m1", subject: "s", from: "f", date: "2026-01-01" },
        { url: "https://x/b", title: "Job B", messageId: "m2", subject: "s", from: "f", date: "2026-01-02" },
      ];
    },
    startAuthorize: async (userId: string, returnUrl: string, key: string | null) => `https://gateway/authorize?u=${userId}&r=${returnUrl}&k=${key}`,
    usesSharedConnector: async () => !!tableAnswers.__shared?.data,
  };
});
vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  requireAppUser: async (req: Request) => {
    if (!req.headers.get("Authorization")) throw new Error("unauthorized: no bearer token");
    return { id: "user-1" };
  },
}));
vi.mock("../../supabase/functions/_shared/fetchDeadline.ts", () => ({
  fetchPosting: async () => ({ ok: false, status: 404 }),
  fillDeadlines: async (links: Array<{ url: string }>) => links.map((l) => ({ ...l, deadline: "2026-12-01" })),
}));
vi.mock("../../supabase/functions/_shared/postingLanguage.ts", () => ({ rememberLanguage: async () => {} }));
vi.mock("../../supabase/functions/_shared/gmailImport.ts", () => ({
  importLinksAsWorkItems: async (_admin: unknown, opts: { backlogId: string; fetchDeadlines: boolean; allowDuplicates: boolean }, links: unknown[]) => ({
    created: links.length,
    skipped: 0,
    collapsed: 0,
    createdIds: links.map((_, i) => `${opts.backlogId}-${i}`),
    createdByUrl: {},
    opts,
  }),
  postingsInTree: async () => ({ urls: new Map([["https://x/a", "Open jobs"]]), names: new Map() }),
  urlsInBacklog: async () => new Set(["https://x/b"]),
}));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = {
    serve: (h: typeof handler) => {
      handler = h;
    },
  };
  // By a path the app's type check does not follow: the function is Deno code,
  // checked on its own (tsconfig.functions.json).
  const FUNCTION = "../../supabase/functions/gmail-connector/index.ts";
  await import(/* @vite-ignore */ FUNCTION);
});

beforeEach(() => {
  dbCalls = [];
  gmailCalls.length = 0;
  tableAnswers = {};
});

/** Call the function as the app does, and record what came back and what it asked. */
async function call(body: Record<string, unknown>, { signedIn = true, method = "POST" } = {}) {
  dbCalls = [];
  gmailCalls.length = 0;
  const res = await handler(
    new Request("https://fn/gmail-connector", {
      method,
      headers: signedIn ? { Authorization: "Bearer t" } : {},
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, db: [...dbCalls], gmail: [...gmailCalls] };
}

const ORG = { organizationId: "org-1" };
/** A client ID in the form Google gives them. */
const CLIENT_ID = "123456789012-abc123.apps.googleusercontent.com";

describe("the Gmail function", () => {
  it("answers a preflight, and refuses the signed-out and the unknown", async () => {
    const preflight = await handler(new Request("https://fn", { method: "OPTIONS" }));
    expect({
      preflight: preflight.status,
      signedOut: await call({ action: "status", ...ORG }, { signedIn: false }),
      unknown: await call({ action: "nonsense", ...ORG }),
      noOrg: await call({ action: "status" }),
    }).toMatchSnapshot();
  });

  it("says whether this user is connected, and how the organisation reaches Gmail", async () => {
    tableAnswers.gmail_connections = { data: { connected_email: "me@example.com", updated_at: "2026-01-01" }, error: null };
    tableAnswers.__oauthClient = { data: { clientId: "c.apps.googleusercontent.com", updatedAt: "2026-01-01" }, error: null };
    const own = await call({ action: "status", ...ORG });
    tableAnswers.__shared = { data: true, error: null };
    const shared = await call({ action: "status", ...ORG });
    expect({ own, shared }).toMatchSnapshot();
  });

  it("starts a connection: through the shared connector, or the organisation's own client", async () => {
    tableAnswers.__shared = { data: true, error: null };
    tableAnswers.gmail_connections = { data: { connection_key_encrypted: "old" }, error: null };
    const shared = await call({ action: "start", ...ORG, returnUrl: "https://app/gmail-callback.html" });
    tableAnswers = { __oauthClient: { data: { clientId: CLIENT_ID }, error: null } };
    const own = await call({ action: "start", ...ORG, returnUrl: "https://app/gmail-callback.html" });
    const badReturn = await call({ action: "start", ...ORG, returnUrl: "https://evil/elsewhere" });
    const noReturn = await call({ action: "start", ...ORG });
    tableAnswers = {};
    const noClient = await call({ action: "start", ...ORG, returnUrl: "https://app/gmail-callback.html" });
    expect({ shared, own: { status: own.status, starts: String(own.body?.authorizationUrl).split("?")[0] }, badReturn, noReturn, noClient }).toMatchSnapshot();
  });

  it("finishes a shared-connector connection, and refuses one without a code", async () => {
    tableAnswers.__shared = { data: true, error: null };
    expect({
      done: await call({ action: "exchange", ...ORG, code: "c0de" }),
      noCode: await call({ action: "exchange", ...ORG }),
    }).toMatchSnapshot();
  });

  it("disconnects", async () => {
    expect(await call({ action: "disconnect", ...ORG })).toMatchSnapshot();
  });

  it("sets and removes the organisation's own client, for its owners and admins only", async () => {
    const member = await call({ action: "set_oauth_client", ...ORG, clientId: CLIENT_ID, clientSecret: "s" });
    tableAnswers.memberships = { data: { id: "m", role: "admin" }, error: null };
    const notAClientId = await call({ action: "set_oauth_client", ...ORG, clientId: "nope", clientSecret: "s" });
    const noSecret = await call({ action: "set_oauth_client", ...ORG, clientId: CLIENT_ID });
    tableAnswers.__oauthClient = { data: { clientId: "old.apps.googleusercontent.com" }, error: null };
    const changed = await call({ action: "set_oauth_client", ...ORG, clientId: CLIENT_ID, clientSecret: "s" });
    const removed = await call({ action: "remove_oauth_client", ...ORG });
    expect({ member, notAClientId, noSecret, changed, removed }).toMatchSnapshot();
  });

  it("previews a search: job ads with where they already are, or links with what was imported", async () => {
    tableAnswers.gmail_imported_links = { data: [{ gmail_message_id: "m1", normalized_url: "https://x/a" }], error: null };
    const jobs = await call({ action: "preview", ...ORG, query: "jobs", mode: "jobs", treeId: "t", backlogId: "b" });
    const jobsByList = await call({ action: "preview", ...ORG, query: "jobs", mode: "jobs", backlogId: "b", readPostings: false });
    const links = await call({ action: "preview", ...ORG, query: "links", maxMessages: 500 });
    const noQuery = await call({ action: "preview", ...ORG });
    const noOrg = await call({ action: "preview", query: "q" });
    // Timings differ from run to run.
    for (const r of [jobs, jobsByList]) delete r.body.timings;
    expect({ jobs, jobsByList, links, noQuery, noOrg }).toMatchSnapshot();
  });

  it("reads a few postings at a time, and refuses more", async () => {
    expect({
      read: await call({ action: "posting_facts", ...ORG, links: [{ url: "https://x/a", date: "2026-01-01" }, { url: "ftp://no" }] }),
      six: (await call({ action: "posting_facts", ...ORG, links: Array.from({ length: 6 }, (_, i) => ({ url: `https://x/${i}` })) })).status,
      tooMany: await call({ action: "posting_facts", ...ORG, links: Array.from({ length: 7 }, (_, i) => ({ url: `https://x/${i}` })) }),
    }).toMatchSnapshot();
  });

  it("reads a search's career pages, and says why one told it nothing", async () => {
    tableAnswers.gmail_import_queries = { data: { id: "q", career_pages: ["https://unknown.example/careers"] }, error: null };
    tableAnswers.career_page_seen_postings = { data: [], error: null };
    const pages = await call({ action: "career_pages", ...ORG, queryId: "q", treeId: "t" });
    tableAnswers.gmail_import_queries = { data: { id: "q", career_pages: [] }, error: null };
    const none = await call({ action: "career_pages", ...ORG, queryId: "q" });
    tableAnswers.gmail_import_queries = { data: null, error: null };
    const notOurs = await call({ action: "career_pages", ...ORG, queryId: "q" });
    const noQuery = await call({ action: "career_pages", ...ORG });
    expect({ pages, none, notOurs, noQuery }).toMatchSnapshot();
  });

  it("remembers the career page jobs left out, and marks mail read", async () => {
    tableAnswers.gmail_import_queries = { data: { id: "q", career_pages: [] }, error: null };
    expect({
      seen: await call({ action: "mark_pages_seen", ...ORG, queryId: "q", urls: ["https://x/a", "https://x/a", "nope"] }),
      seenNone: await call({ action: "mark_pages_seen", ...ORG, queryId: "q", urls: [] }),
      read: await call({ action: "mark_read", ...ORG, messageIds: ["m1", "m1", "m2"] }),
      readNone: await call({ action: "mark_read", ...ORG, messageIds: [] }),
    }).toMatchSnapshot();
  });

  it("imports links: into one list, or split by deadline, keeping what the picker knew", async () => {
    const links = [
      { url: "https://x/a", title: "A", messageId: "m1", deadline: "2026-12-01", cities: ["Helsinki", "", 5], rating: 4 },
      { url: "https://x/b", title: "B", messageId: "m2", rating: 9 },
      { url: "", title: "no url", messageId: "m3" },
    ];
    const base = { action: "import", ...ORG, treeId: "t", backlogId: "b" };
    expect({
      jobs: await call({ ...base, mode: "jobs", links }),
      split: await call({ ...base, mode: "jobs", links, autoPlace: { datedBacklogId: "dated", undatedBacklogId: "undated" } }),
      noLinks: await call({ ...base, links: [] }),
      noTree: await call({ action: "import", ...ORG, backlogId: "b", links }),
    }).toMatchSnapshot();
  });
});
