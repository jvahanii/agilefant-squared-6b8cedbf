export interface ChangeLogEntry {
  timestamp: string;
  action: string;
  entityType: 'work_item' | 'backlog' | 'backlog_tree' | 'data';
  entityId?: string;
  entityName?: string;
  details?: string;
}

const changeLog: ChangeLogEntry[] = [];

export function logChange(entry: Omit<ChangeLogEntry, 'timestamp'>) {
  changeLog.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
}

export function getChangeLog(): ChangeLogEntry[] {
  return [...changeLog];
}

export function clearChangeLog() {
  changeLog.length = 0;
}

export function exportChangeLogAsCsv(entries?: ChangeLogEntry[]): string {
  const source = entries ?? changeLog;
  const headers = ['Timestamp', 'Action', 'Entity Type', 'Entity ID', 'Entity Name', 'Details'];
  const rows = source.map(e => [
    e.timestamp,
    e.action,
    e.entityType,
    e.entityId ?? '',
    e.entityName ?? '',
    e.details ?? '',
  ].map(v => `"${v.replace(/"/g, '""')}"`).join(','));
  return [headers.join(','), ...rows].join('\n');
}
