// ──────────────────────────────────────────────────────────────────────
// A missing optional source must degrade to "not started", never fail the whole
// screen. But a swallowed RLS denial and a genuinely empty table produced the
// SAME screen — "Not started", zero counts, no exception — and only one of them
// is a bug somebody has to fix. A console warning is not a surface a dealer
// standing at the car can see.
//
// Every read therefore records the source it could not read. The loader hands
// that list back with the data, and the hook publishes it as `degraded`, so a
// screen built on partial data can say so instead of quietly under-reporting.
// ──────────────────────────────────────────────────────────────────────

// Matches the existing `Row = Record<string, any>` convention for PostgREST
// rows — the shapes are per-query and are narrowed at the point of use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReaderRow = Record<string, any>;

export interface SourceDegradation {
  /** The table or query that failed, e.g. "get_ready_records". */
  source: string;
  /** The driver message, for support and debugging. */
  message: string;
}

type ReadResult = { data: unknown; error: { message?: string } | null };

export interface SourceReader {
  rows(query: PromiseLike<ReadResult>, source: string): Promise<ReaderRow[]>;
  oneRow(query: PromiseLike<ReadResult>, source: string): Promise<ReaderRow | null>;
  readonly degraded: SourceDegradation[];
}

export function createSourceReader(): SourceReader {
  const degraded: SourceDegradation[] = [];

  const note = (source: string, message: string) => {
    console.warn(`[useCommandCenter] ${source} read failed:`, message);
    if (!degraded.some((d) => d.source === source)) degraded.push({ source, message });
  };

  const rows = async (query: PromiseLike<ReadResult>, source: string): Promise<ReaderRow[]> => {
    try {
      const { data, error } = await query;
      if (error) {
        note(source, error.message || String(error));
        return [];
      }
      return (data as ReaderRow[]) || [];
    } catch (e) {
      note(source, (e as Error)?.message || String(e));
      return [];
    }
  };

  const oneRow = async (query: PromiseLike<ReadResult>, source: string): Promise<ReaderRow | null> =>
    (await rows(query, source))[0] || null;

  return { rows, oneRow, degraded };
}
