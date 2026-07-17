/**
 * Regression guard: every read from a table that can grow past PostgREST's
 * 1000-row default cap must go through the shared `paginateSelect` helper
 * (or be an obviously bounded lookup by primary key / user id / single-row).
 *
 * If this test fails you probably added a plain `supabase.from('<table>').select(...)`
 * to one of the denylisted tables. Wrap it in `paginateSelect(...)` from
 * `@/integrations/supabase/pagination` instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

// Tables where any org-scoped or user-scoped list read can realistically
// exceed 1k rows. Reads filtered by primary id, or wrapped in paginateSelect,
// are still fine — the check below only flags the risky shape.
const UNBOUNDED_TABLES = [
  'work_items',
  'work_item_backlog_ranks',
  'work_item_board_ranks',
  'work_item_hyperlinks',
  'work_item_financials',
  'work_item_snoozes',
  'work_item_team_assignments',
  'label_assignments',
  'labels',
  'time_entries',
  'change_log',
  'backlogs',
  'backlog_statuses',
  'tree_financial_targets',
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

/**
 * Return true if the `.select(...)` at `selectIdx` inside `source` looks like
 * a bounded read: filtered by primary key, single-row, count-only, or a small
 * enum. We look at a small window after the select call.
 */
function looksBounded(source: string, selectIdx: number): boolean {
  const window = source.slice(selectIdx, selectIdx + 400);
  return (
    /\.single\s*\(/.test(window) ||
    /\.maybeSingle\s*\(/.test(window) ||
    /count:\s*['"]exact['"]\s*,\s*head:\s*true/.test(window) ||
    /\.eq\(\s*['"]id['"]\s*,/.test(window) ||
    /\.eq\(\s*['"]user_id['"]\s*,/.test(window) ||
    /\.limit\(\s*1\s*\)/.test(window)
  );
}

describe('supabase pagination guard', () => {
  const files = walk(SRC);

  for (const table of UNBOUNDED_TABLES) {
    it(`every read from "${table}" is paginated or bounded`, () => {
      const violations: string[] = [];
      const re = new RegExp(
        `supabase\\s*(?:as\\s+any\\s*)?\\.?\\s*\\.\\s*from\\(\\s*['"\`]${table}['"\`]`,
        'g',
      );

      for (const file of files) {
        // Skip the shared helper itself and this test file.
        if (file.endsWith('pagination.ts')) continue;
        const source = readFileSync(file, 'utf8');
        let match: RegExpExecArray | null;
        // Reset each file
        re.lastIndex = 0;
        while ((match = re.exec(source)) !== null) {
          // Find the first `.select(` after this .from(...) call
          const selectIdx = source.indexOf('.select(', match.index);
          if (selectIdx === -1 || selectIdx - match.index > 300) continue;

          // Look at a wider window around this call: if it uses `.range(` or
          // is wrapped by `paginateSelect(` it is paginated.
          const before = source.slice(Math.max(0, match.index - 800), match.index);
          const after = source.slice(selectIdx, selectIdx + 600);
          if (/paginateSelect\s*\(/.test(before)) continue;
          if (/\.range\s*\(/.test(after)) continue;

          if (looksBounded(source, selectIdx)) continue;

          const line = source.slice(0, match.index).split('\n').length;
          violations.push(`${file.replace(process.cwd() + '/', '')}:${line}`);
        }
      }

      expect(violations, `Unpaginated reads of ${table}:\n  ${violations.join('\n  ')}`).toEqual([]);
    });
  }
});
