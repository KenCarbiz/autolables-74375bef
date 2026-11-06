// Complete, verified reads. Every page is ordered by primary key so paging is
// deterministic while rows change, the first page carries an exact count, and
// the result is refused when the rows read do not add up to that count. A
// screen never shows a total it could not verify.

export const PAGE_SIZE = 1000;

export class IncompleteReadError extends Error {
  constructor(public readonly reason: "count_missing" | "count_changed" | "short_read" | "duplicate_rows", detail: string) {
    super(detail);
    this.name = "IncompleteReadError";
  }
}

export interface PageResult<T> { data: T[] | null; error: { message?: string; code?: string } | null; count?: number | null }

/**
 * `page(from, to)` must return rows ordered by a unique key with
 * `count: "exact"`. Throws the read error as-is, or IncompleteReadError.
 */
export async function readAllPages<T extends { id: string | number }>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<{ rows: T[]; count: number }> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let from = 0; ; from += pageSize) {
    const res = await page(from, from + pageSize - 1);
    if (res.error) throw res.error;
    const count = typeof res.count === "number" ? res.count : null;
    if (count === null) throw new IncompleteReadError("count_missing", "The database did not return a row count.");
    if (expected === null) expected = count;
    else if (count !== expected) throw new IncompleteReadError("count_changed", `The row count changed from ${expected} to ${count} while reading.`);
    const data = res.data ?? [];
    rows.push(...data);
    if (rows.length >= expected) break;
    if (data.length === 0) throw new IncompleteReadError("short_read", `Read ${rows.length} of ${expected} rows.`);
  }
  const ids = new Set(rows.map((r) => r.id));
  if (ids.size !== rows.length) throw new IncompleteReadError("duplicate_rows", "The same row came back twice while paging.");
  if (rows.length !== expected) throw new IncompleteReadError("short_read", `Read ${rows.length} of ${expected} rows.`);
  return { rows, count: expected! };
}
