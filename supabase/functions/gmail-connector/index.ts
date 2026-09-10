// Per-user Gmail integration endpoint.
//
// Actions:
//   status      → is this user connected, and to which address
//   start       → returns the OAuth authorization URL (opened in a popup)
//   exchange    → exchanges the OAuth code for a connection key and stores it
//   disconnect  → forgets the stored connection
//   preview     → runs a Gmail search and returns extracted links (no writes)
//   import      → creates one work item per selected link

import {
  adminClient,
  corsHeaders,
  encryptKey,
  env,
  exchangeCode,
  getConnection,
  gmail,
  json,
  searchLinks,
  startAuthorize,
  ExtractedLink,
} from '../_shared/gmail.ts';
import { importLinksAsWorkItems } from '../_shared/gmailImport.ts';
import { requireAppUser } from '../_shared/auth.ts';

const MAX_MESSAGES = 100;


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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Was auth.getUser(), which resolves against auth.users and so rejected
    // every Clerk session. requireAppUser goes via current_user_id() instead.
    const user = await requireAppUser(req);
    const admin = adminClient();
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? 'status');

    if (action === 'status') {
      const { data, error } = await admin
        .from('gmail_connections')
        .select('connected_email, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return json({ connected: !!data, email: data?.connected_email ?? null, updatedAt: data?.updated_at ?? null });
    }

    if (action === 'start') {
      const returnUrl = String(body.returnUrl ?? '');
      if (!returnUrl) return json({ error: 'returnUrl is required' }, 400);
      const url = await startAuthorize(user.id, returnUrl);
      return json({ authorizationUrl: url });
    }

    if (action === 'exchange') {
      const code = String(body.code ?? '');
      if (!code) return json({ error: 'code is required' }, 400);
      const key = await exchangeCode(code);
      let email: string | null = null;
      try {
        const profile = await gmail<{ emailAddress?: string }>(key, '/users/me/profile');
        email = profile.emailAddress ?? null;
      } catch (e) {
        console.error('profile lookup failed', e instanceof Error ? e.message : e);
      }
      const { error } = await admin.from('gmail_connections').upsert(
        {
          user_id: user.id,
          connected_email: email,
          connection_key_encrypted: await encryptKey(key),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
      return json({ connected: true, email });
    }

    if (action === 'disconnect') {
      const { error } = await admin.from('gmail_connections').delete().eq('user_id', user.id);
      if (error) throw error;
      return json({ connected: false });
    }

    if (action === 'preview') {
      const query = String(body.query ?? '').trim();
      const organizationId = String(body.organizationId ?? '');
      if (!query) return json({ error: 'query is required' }, 400);
      if (!organizationId) return json({ error: 'organizationId is required' }, 400);
      await assertOrgMember(user.id, organizationId);

      const { key } = await getConnection(admin, user.id);
      const max = Math.min(Number(body.maxMessages ?? 25) || 25, MAX_MESSAGES);
      const links = await searchLinks(key, query, max);

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

      const result = await importLinksAsWorkItems(
        admin,
        { organizationId, treeId, backlogId, queryId: body.queryId ?? null },
        links.map((l) => ({
          url: String(l.url ?? ''),
          title: String(l.title ?? ''),
          messageId: String(l.messageId ?? ''),
          subject: String(l.subject ?? ''),
          from: String(l.from ?? ''),
          date: String(l.date ?? ''),
        })).filter((l) => l.url && l.messageId),
      );
      return json(result);
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('gmail-connector error:', message);
    if (message === 'unauthorized') return json({ error: 'unauthorized' }, 401);
    if (message === 'gmail_not_connected') return json({ error: 'gmail_not_connected' }, 409);
    if (message.startsWith('forbidden')) return json({ error: message }, 403);
    return json({ error: message }, 500);
  }
});
