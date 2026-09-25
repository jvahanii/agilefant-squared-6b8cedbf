// Per-user Gmail integration endpoint.
//
// Actions:
//   status      → is this user connected, and to which address
//   start       → returns the OAuth authorization URL (opened in a popup)
//   exchange    → exchanges the OAuth code for a connection key and stores it
//   disconnect  → forgets the stored connection
//   preview     → runs a Gmail search and returns extracted links (no writes)
//                 mode 'jobs' narrows the result to job postings
//   import      → creates one work item per selected link
//   mark_read   → removes the UNREAD label from the given messages

import {
  adminClient,
  corsHeaders,
  decryptKey,
  encryptKey,
  env,
  exchangeCode,
  forScope,
  getConnection,
  getOAuthClient,
  gmail,
  GOOGLE_SCOPES,
  json,
  markMessagesRead,
  searchLinks,
  startAuthorize,
  usesSharedConnector,
  ExtractedLink,
  GmailAuth,
  LinkMode,
} from '../_shared/gmail.ts';
import {
  exchangeGoogleCode,
  googleAuthorizeUrl,
  looksLikeGoogleClientId,
  signState,
  verifyState,
} from '../_shared/googleOAuth.ts';
import { importLinksAsWorkItems, urlsInBacklog, urlsInTree } from '../_shared/gmailImport.ts';
import { fillDeadlines } from '../_shared/fetchDeadline.ts';
import { wellFormedDeadline } from '../_shared/deadlines.ts';
import { requireAppUser } from '../_shared/auth.ts';

const MAX_MESSAGES = 100;
/** Postings per posting_facts call: one round of the reader's concurrency. */
const POSTING_FACTS_BATCH = 6;


async function assertOrgMember(userId: string, orgId: string) {
  const admin = adminClient();
  const { data, error } = await admin
    .from('memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('forbidden: not a member of this organization');
}

/** An owner or admin of the organization, or a superuser. */
async function canManageOrg(userId: string, orgId: string): Promise<boolean> {
  const admin = adminClient();
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (membership?.role === 'owner' || membership?.role === 'admin') return true;
  const { data: profile } = await admin.from('profiles').select('is_superuser').eq('id', userId).maybeSingle();
  return !!profile?.is_superuser;
}

/**
 * The redirect URI for a consent with an organization's own client.
 *
 * Only the app's own callback page, and only over https — or plain http on
 * localhost, for development. Google refuses any URI the organization has not
 * registered anyway, but a URI this function would never have produced should
 * not get as far as asking.
 */
function callbackUri(returnUrl: string): string {
  let u: URL;
  try {
    u = new URL(returnUrl);
  } catch {
    throw new Error('bad_request: returnUrl is not a URL');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.pathname !== '/gmail-callback.html' || (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))) {
    throw new Error('bad_request: returnUrl must be the app callback page');
  }
  return `${u.origin}${u.pathname}`;
}

/** Remove every connection made through an organization's own client. */
async function dropOwnClientConnections(admin: ReturnType<typeof adminClient>, organizationId: string) {
  const { error } = await admin.from('gmail_connections').delete().eq('organization_id', organizationId);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Was auth.getUser(), which resolves against auth.users and so rejected
    // every Clerk session. requireAppUser goes via current_user_id() instead.
    const user = await requireAppUser(req);
    const admin = adminClient();
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? 'status');

    // Every connection action is about one organization, because the
    // organization decides how Gmail is reached: its own Google OAuth client,
    // or — for the few allowed it — the shared connector.
    const organizationIdFor = (): string => {
      const id = String(body.organizationId ?? '');
      if (!id) throw new Error('bad_request: organizationId is required');
      return id;
    };

    if (action === 'status') {
      const organizationId = organizationIdFor();
      await assertOrgMember(user.id, organizationId);
      const shared = await usesSharedConnector(admin, organizationId);
      const { data, error } = await forScope(
        admin.from('gmail_connections').select('connected_email, updated_at').eq('user_id', user.id),
        shared,
        organizationId,
      ).maybeSingle();
      if (error) throw error;

      // Never the secret: whether a client exists, and its public ID, is all
      // the app needs to show.
      const client = shared ? null : await getOAuthClient(admin, organizationId);
      return json({
        connected: !!data,
        email: data?.connected_email ?? null,
        updatedAt: data?.updated_at ?? null,
        oauth: shared
          ? { mode: 'shared' }
          : {
              mode: 'own',
              configured: !!client,
              clientId: client?.clientId ?? null,
              updatedAt: client?.updatedAt ?? null,
              canManage: await canManageOrg(user.id, organizationId),
            },
      });
    }

    if (action === 'start') {
      const organizationId = organizationIdFor();
      const returnUrl = String(body.returnUrl ?? '');
      if (!returnUrl) return json({ error: 'returnUrl is required' }, 400);
      await assertOrgMember(user.id, organizationId);

      if (await usesSharedConnector(admin, organizationId)) {
        // A reconnect — typically after the connection expired — must name the
        // stored key, or the gateway refuses to start.
        const { data: existing, error: existingError } = await forScope(
          admin.from('gmail_connections').select('connection_key_encrypted').eq('user_id', user.id),
          true,
          organizationId,
        ).maybeSingle();
        if (existingError) throw existingError;
        const existingKey = existing?.connection_key_encrypted
          ? await decryptKey(existing.connection_key_encrypted as string)
          : null;
        try {
          return json({ authorizationUrl: await startAuthorize(user.id, returnUrl, existingKey) });
        } catch (e) {
          // The gateway remembers every app user it has connected, and demands
          // that user's own key to connect them again. Two ways that fails:
          //   - Disconnect deleted the key, so the old identity cannot be
          //     reconnected at all (400, "Reconnect requires the
          //     X-Connection-Api-Key header");
          //   - the stored key belongs to a fresh identity started after such a
          //     disconnect, not to the user id (403, "X-Connection-Api-Key does
          //     not match this app_user_id").
          // Nothing else uses the app user id — every later call names the
          // connection by its key — so start a fresh identity, and the
          // exchange replaces the stored connection with the new one.
          const message = e instanceof Error ? e.message : String(e);
          if (!/X-Connection-Api-Key/i.test(message)) throw e;
          console.error('gateway refused the reconnect for this app user; starting a fresh app user:', message);
          return json({ authorizationUrl: await startAuthorize(crypto.randomUUID(), returnUrl, null) });
        }
      }

      const client = await getOAuthClient(admin, organizationId);
      if (!client) throw new Error('oauth_client_not_configured');
      const redirectUri = callbackUri(returnUrl);
      const state = await signState(env('APP_USER_CONNECTION_KEY_SECRET'), {
        userId: user.id,
        organizationId,
        redirectUri,
      });
      return json({
        authorizationUrl: googleAuthorizeUrl({ clientId: client.clientId, redirectUri, state, scopes: GOOGLE_SCOPES }),
      });
    }

    if (action === 'exchange') {
      const organizationId = organizationIdFor();
      const code = String(body.code ?? '');
      if (!code) return json({ error: 'code is required' }, 400);
      await assertOrgMember(user.id, organizationId);

      const shared = await usesSharedConnector(admin, organizationId);
      let secret: string;
      let auth: GmailAuth;
      if (shared) {
        secret = await exchangeCode(code);
        auth = { kind: 'gateway', key: secret };
      } else {
        const client = await getOAuthClient(admin, organizationId);
        if (!client) throw new Error('oauth_client_not_configured');
        // The state proves this code was asked for by this user, for this
        // organization, in the last few minutes — and carries the redirect URI
        // Google requires the exchange to repeat.
        const started = await verifyState(env('APP_USER_CONNECTION_KEY_SECRET'), String(body.state ?? ''), {
          userId: user.id,
          organizationId,
        });
        const tokens = await exchangeGoogleCode(fetch, client, code, started.r);
        secret = tokens.refreshToken;
        auth = { kind: 'google', token: async () => tokens.accessToken };
      }

      let email: string | null = null;
      try {
        const profile = await gmail<{ emailAddress?: string }>(auth, '/users/me/profile');
        email = profile.emailAddress ?? null;
      } catch (e) {
        console.error('profile lookup failed', e instanceof Error ? e.message : e);
      }
      const { error } = await admin.from('gmail_connections').upsert(
        {
          user_id: user.id,
          organization_id: shared ? null : organizationId,
          provider: shared ? 'gateway' : 'google',
          connected_email: email,
          connection_key_encrypted: await encryptKey(secret),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,organization_id' },
      );
      if (error) throw error;
      return json({ connected: true, email });
    }

    if (action === 'disconnect') {
      const organizationId = organizationIdFor();
      const shared = await usesSharedConnector(admin, organizationId);
      const { error } = await forScope(
        admin.from('gmail_connections').delete().eq('user_id', user.id),
        shared,
        organizationId,
      );
      if (error) throw error;
      return json({ connected: false });
    }

    if (action === 'set_oauth_client') {
      const organizationId = organizationIdFor();
      const clientId = String(body.clientId ?? '').trim();
      const clientSecret = String(body.clientSecret ?? '').trim();
      if (!(await canManageOrg(user.id, organizationId))) {
        throw new Error("forbidden: only an owner or admin can set this organization's Google OAuth client");
      }
      if (await usesSharedConnector(admin, organizationId)) {
        return json({ error: 'This organization uses the shared connector and needs no OAuth client of its own.' }, 400);
      }
      if (!looksLikeGoogleClientId(clientId)) {
        return json(
          { error: 'That does not look like a Google OAuth client ID. It ends in .apps.googleusercontent.com.' },
          400,
        );
      }
      if (!clientSecret) return json({ error: 'The client secret is required.' }, 400);

      const previous = await getOAuthClient(admin, organizationId);
      const { error } = await admin.from('organization_google_oauth_clients').upsert(
        {
          organization_id: organizationId,
          client_id: clientId,
          client_secret_encrypted: await encryptKey(clientSecret),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
      if (error) throw error;

      // A refresh token is bound to the client that issued it. A new secret for
      // the same client keeps every connection working; a different client
      // leaves them all unusable, so they go now rather than failing later.
      if (previous && previous.clientId !== clientId) {
        await dropOwnClientConnections(admin, organizationId);
      }
      return json({ configured: true, clientId });
    }

    if (action === 'remove_oauth_client') {
      const organizationId = organizationIdFor();
      if (!(await canManageOrg(user.id, organizationId))) {
        throw new Error("forbidden: only an owner or admin can remove this organization's Google OAuth client");
      }
      const { error } = await admin.from('organization_google_oauth_clients').delete().eq('organization_id', organizationId);
      if (error) throw error;
      // Nothing can refresh these without the client, so none may linger
      // looking connected.
      await dropOwnClientConnections(admin, organizationId);
      return json({ configured: false });
    }

    if (action === 'preview') {
      const query = String(body.query ?? '').trim();
      const organizationId = String(body.organizationId ?? '');
      if (!query) return json({ error: 'query is required' }, 400);
      if (!organizationId) return json({ error: 'organizationId is required' }, 400);
      await assertOrgMember(user.id, organizationId);

      const { auth } = await getConnection(admin, user.id, organizationId);
      const max = Math.min(Number(body.maxMessages ?? 25) || 25, MAX_MESSAGES);
      const mode: LinkMode = body.mode === 'jobs' ? 'jobs' : 'links';
      const links = await searchLinks(auth, query, max, mode);

      if (mode === 'jobs') {
        // Job ad import keeps no ledger, so "already imported" is answered from
        // the work items themselves: is this posting's URL already attached to
        // one. Informational only -- the import never refuses.
        const backlogId = String(body.backlogId ?? '');
        const treeId = String(body.treeId ?? '');
        // The tree, not the backlog, is the unit that matters: the same posting
        // filed into another list a week ago is still one you have seen. Falls
        // back on the backlog alone for a caller that names no tree.
        const inTree = treeId ? await urlsInTree(admin, organizationId, treeId) : new Map<string, string>();
        const present = backlogId && !treeId ? await urlsInBacklog(admin, backlogId) : new Set<string>();
        // The same fetch the import does, so the picker can show a deadline and
        // say when a posting has stopped taking applications -- LinkedIn leaves
        // those up, and importing one as work is a waste of a row. Capped inside
        // fillDeadlines; a posting that will not load simply tells us nothing.
        // A caller that reads the postings itself, batch by batch through
        // posting_facts so it can show how far it has got, says so.
        const detailed = body.readPostings === false ? links : await fillDeadlines(links);
        return json({
          links: detailed.map((l) => ({
            ...l,
            alreadyImported: inTree.has(l.url) || present.has(l.url),
            // Which list it is already in, so the picker can say where rather
            // than leaving the reader to go and find it.
            alreadyIn: inTree.get(l.url) ?? null,
          })),
        });
      }

      const messageIds = [...new Set(links.map((l) => l.messageId))];
      const { data: existing, error } = await admin
        .from('gmail_imported_links')
        .select('gmail_message_id, normalized_url')
        .eq('organization_id', organizationId)
        .in('gmail_message_id', messageIds.length ? messageIds : ['none']);
      if (error) throw error;
      const seen = new Set((existing ?? []).map((r) => `${r.gmail_message_id}|${r.normalized_url}`));

      return json({
        links: links.map((l) => ({ ...l, alreadyImported: seen.has(`${l.messageId}|${l.url}`) })),
      });
    }

    // What a few postings say about themselves -- deadline, closed -- the same
    // reading the preview does, for a picker that asks batch by batch so it can
    // show its progress. Small batches keep each call well inside the
    // function's time limit.
    if (action === 'posting_facts') {
      const organizationId = organizationIdFor();
      await assertOrgMember(user.id, organizationId);
      const raw: unknown[] = Array.isArray(body.links) ? body.links : [];
      if (raw.length > POSTING_FACTS_BATCH) {
        return json({ error: `at most ${POSTING_FACTS_BATCH} postings per call` }, 400);
      }
      const links = raw
        .map((l) => l as { url?: unknown; date?: unknown })
        .filter((l) => typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
        .map((l) => ({ url: l.url as string, date: typeof l.date === 'string' ? l.date : undefined }));
      const read = await fillDeadlines(links);
      return json({
        facts: read.map((l) => ({
          url: l.url,
          deadline: (l as { deadline?: string }).deadline ?? null,
          applicationsClosed: (l as { applicationsClosed?: boolean }).applicationsClosed === true,
          cities: (l as { cities?: string[] }).cities ?? null,
        })),
      });
    }

    if (action === 'mark_read') {
      const organizationId = organizationIdFor();
      const messageIds = Array.isArray(body.messageIds) ? body.messageIds.map(String).filter(Boolean) : [];
      if (messageIds.length === 0) return json({ error: 'messageIds is required' }, 400);
      if (messageIds.length > 500) return json({ error: 'too many messages at once' }, 400);
      await assertOrgMember(user.id, organizationId);

      const { auth } = await getConnection(admin, user.id, organizationId);
      await markMessagesRead(auth, messageIds);
      return json({ marked: [...new Set(messageIds)].length });
    }

    if (action === 'import') {
      const organizationId = String(body.organizationId ?? '');
      const treeId = String(body.treeId ?? '');
      const backlogId = String(body.backlogId ?? '');
      const links = Array.isArray(body.links) ? (body.links as ExtractedLink[]) : [];
      if (!organizationId || !treeId || !backlogId) {
        return json({ error: 'organizationId, treeId and backlogId are required' }, 400);
      }
      if (links.length === 0) return json({ error: 'links is required' }, 400);
      await assertOrgMember(user.id, organizationId);

      const mapped = links.map((l) => ({
        url: String(l.url ?? ''),
        title: String(l.title ?? ''),
        messageId: String(l.messageId ?? ''),
        subject: String(l.subject ?? ''),
        from: String(l.from ?? ''),
        date: String(l.date ?? ''),
        // A deadline the picker already knows — from the mail, or read through
        // the browser from a board that refuses this server (Jobly) — is kept,
        // so the import does not fetch again and come back with nothing. Only
        // a well-formed date: it becomes part of the item's name.
        ...(wellFormedDeadline(l.deadline) ? { deadline: wellFormedDeadline(l.deadline) } : {}),
        ...(l.deadlineOpen === true ? { deadlineOpen: true } : {}),
        // Cities the picker already read — through the browser, for a board
        // that refuses this server. They go into the item's name, so only short
        // strings, and not many. An empty list is kept: it means the page was
        // read and named none, so the import need not read it again.
        ...(Array.isArray(l.cities)
          ? {
              cities: l.cities
                .filter((c): c is string => typeof c === 'string' && c.trim().length > 0 && c.length <= 60)
                .map((c) => c.trim())
                .slice(0, 10),
            }
          : {}),
        // The star rating the picker gave this row; the import drops one out
        // of range rather than failing.
        ...(Number.isInteger(l.rating) && (l.rating as number) >= 1 && (l.rating as number) <= 5
          ? { rating: l.rating }
          : {}),
      })).filter((l) => l.url && l.messageId);

      // Auto-place: which list a posting belongs in is decided here, after the
      // deadlines have been read, not in the browser before them. Splitting in
      // the picker meant a posting whose closing date the import discovered got
      // that date in its name while sitting in the "no deadline" list.
      const auto = body.autoPlace as { datedBacklogId?: string; undatedBacklogId?: string } | undefined;
      const datedBacklogId = String(auto?.datedBacklogId ?? '');
      const undatedBacklogId = String(auto?.undatedBacklogId ?? '');
      if (datedBacklogId && undatedBacklogId) {
        const read = body.mode === 'jobs' ? await fillDeadlines(mapped) : mapped;
        const dated = read.filter((l) => (l as { deadline?: string }).deadline);
        const undated = read.filter((l) => !(l as { deadline?: string }).deadline);
        const base = {
          organizationId,
          treeId,
          queryId: body.queryId ?? null,
          allowDuplicates: body.mode === 'jobs',
          fetchDeadlines: false,
        };
        const results = await Promise.all([
          dated.length
            ? importLinksAsWorkItems(admin, { ...base, backlogId: datedBacklogId }, dated)
            : Promise.resolve(null),
          undated.length
            ? importLinksAsWorkItems(admin, { ...base, backlogId: undatedBacklogId }, undated)
            : Promise.resolve(null),
        ]);
        return json({
          created: results.reduce((n, r) => n + (r?.created ?? 0), 0),
          skipped: results.reduce((n, r) => n + (r?.skipped ?? 0), 0),
          collapsed: results.reduce((n, r) => n + (r?.collapsed ?? 0), 0),
          createdIds: results.flatMap((r) => r?.createdIds ?? []),
          // A posting lands in one list or the other, so the two maps never
          // share a URL.
          createdByUrl: Object.assign({}, ...results.map((r) => r?.createdByUrl ?? {})),
          dated: dated.length,
          undated: undated.length,
        });
      }

      const result = await importLinksAsWorkItems(
        admin,
        {
          organizationId,
          treeId,
          backlogId,
          queryId: body.queryId ?? null,
          // Job ad import keeps no memory of what it has imported.
          allowDuplicates: body.mode === 'jobs',
          fetchDeadlines: body.mode === 'jobs',
        },
        mapped,
      );
      return json(result);
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('gmail-connector error:', message);
    if (message === 'unauthorized' || message.startsWith('unauthorized:')) return json({ error: 'unauthorized' }, 401);
    if (message === 'gmail_not_connected') return json({ error: 'gmail_not_connected' }, 409);
    if (message === 'gmail_permission_missing') return json({ error: 'gmail_permission_missing' }, 403);
    if (message === 'oauth_client_not_configured') return json({ error: 'oauth_client_not_configured' }, 409);
    if (message === 'oauth_client_rejected') return json({ error: 'oauth_client_rejected' }, 400);
    if (message === 'oauth_state_invalid' || message === 'oauth_state_expired') return json({ error: message }, 400);
    if (message.startsWith('bad_request:')) return json({ error: message.slice('bad_request:'.length).trim() }, 400);
    if (message.startsWith('forbidden')) return json({ error: message }, 403);
    return json({ error: message }, 500);
  }
});
