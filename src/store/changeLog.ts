import { supabase } from '@/integrations/supabase/client';

export interface ChangeLogEntry {
  id?: string;
  timestamp: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  details?: string;
  userEmail?: string;
}

/**
 * Insert a change log entry into the database.
 * Fire-and-forget – errors are silently ignored to avoid blocking UI.
 */
export async function insertChangeLogEntry(
  organizationId: string,
  userId: string,
  userEmail: string,
  entry: Omit<ChangeLogEntry, 'timestamp' | 'id' | 'userEmail'>,
) {
  await (supabase as any).from('change_log').insert({
    organization_id: organizationId,
    user_id: userId,
    user_email: userEmail,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    entity_name: entry.entityName ?? null,
    details: entry.details ?? null,
  });
}

/**
 * Load change log entries for an organization, newest first, max 5000.
 */
export async function loadChangeLog(organizationId: string): Promise<ChangeLogEntry[]> {
  const { data, error } = await (supabase as any)
    .from('change_log')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error || !data) return [];

  return (data as any[]).map((row) => ({
    id: row.id,
    timestamp: row.created_at,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? undefined,
    entityName: row.entity_name ?? undefined,
    details: row.details ?? undefined,
    userEmail: row.user_email ?? undefined,
  }));
}

export function exportChangeLogAsCsv(entries: ChangeLogEntry[]): string {
  const headers = ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'Entity Name', 'Details'];
  const rows = entries.map((e) =>
    [
      e.timestamp,
      e.userEmail ?? '',
      e.action,
      e.entityType,
      e.entityId ?? '',
      e.entityName ?? '',
      e.details ?? '',
    ]
      .map((v) => `"${v.replace(/"/g, '""')}"`)
      .join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}
