/**
 * Shared pagination helpers for Supabase reads.
 *
 * PostgREST caps a single response at 1000 rows by default. Every read that
 * could realistically exceed that limit (org-wide lists, cross-org lookups,
 * anything scoped to a growing tenant) MUST be paginated — otherwise rows are
 * silently dropped and downstream code assumes the missing data doesn't exist.
 *
 * Use `paginateSelect` for arbitrary queries, or the convenience wrappers
 * `fetchAllByEq` / `fetchAllByIn` for the common filter shapes.
 */
import { supabase } from './client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseReadResult<T = any> = { data: T[] | null; error: any };

const DEFAULT_PAGE = 1000;

/**
 * Paginate an arbitrary Supabase query.
 *
 * The builder receives `from`/`to` (inclusive) and must return a query
 * that has NOT yet had `.range()` applied. Ordering on a stable column is
 * strongly recommended so that pages don't overlap or skip rows.
 *
 * @example
 *   const { data, error } = await paginateSelect((from, to) =>
 *     supabase.from('work_items').select('*').eq('organization_id', orgId)
 *       .order('id', { ascending: true }).range(from, to)
 *   );
 */
export async function paginateSelect<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>,
  pageSize: number = DEFAULT_PAGE,
): Promise<SupabaseReadResult<T>> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return { data: rows, error: null };
}

/** Fetch every row from `table` where `column = value`. */
export async function fetchAllByEq<T = unknown>(
  table: string,
  column: string,
  value: string,
  select = '*',
): Promise<SupabaseReadResult<T>> {
  return paginateSelect<T>((from, to) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from(table as any).select(select) as any)
      .eq(column, value)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

/**
 * Fetch every row from `table` where `column` is in `values`.
 *
 * Chunks the `values` list to stay under PostgREST URL limits AND paginates
 * within each chunk. Returns an empty array (not an error) when `values` is
 * empty so callers don't need to guard.
 */
export async function fetchAllByIn<T = unknown>(
  table: string,
  column: string,
  values: string[],
  select = '*',
  chunkSize = 500,
): Promise<SupabaseReadResult<T>> {
  if (values.length === 0) return { data: [], error: null };
  const collected: T[] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    const slice = values.slice(i, i + chunkSize);
    const res = await paginateSelect<T>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from(table as any).select(select) as any)
        .in(column, slice)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (res.error) return { data: null, error: res.error };
    collected.push(...(res.data ?? []));
  }
  return { data: collected, error: null };
}
