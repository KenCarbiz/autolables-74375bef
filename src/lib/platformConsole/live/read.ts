import { supabase } from "@/integrations/supabase/client";

// Read-only access to recorded telemetry for the live console. Each source is
// read independently and settled, so one missing table (for example a
// migration not yet applied) marks only its own reading Unknown instead of
// failing the whole page. Nothing here calls an edge function or a provider.

interface RawResult { data: unknown; error: { message: string } | null; count?: number | null }
interface Query extends PromiseLike<RawResult> {
  select(columns?: string, opts?: { count?: "exact"; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
}
const db = supabase as unknown as { from: (table: string) => Query };

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

export async function settle<T>(p: PromiseLike<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface Filter { col: string; op: "eq" | "gte" | "in"; value: unknown }

export async function readRows<T>(table: string, columns: string, opts: { filters?: Filter[]; order?: string; ascending?: boolean; limit?: number } = {}): Promise<T[]> {
  let q = db.from(table).select(columns);
  for (const f of opts.filters ?? []) {
    q = f.op === "eq" ? q.eq(f.col, f.value) : f.op === "gte" ? q.gte(f.col, f.value) : q.in(f.col, f.value as unknown[]);
  }
  if (opts.order) q = q.order(opts.order, { ascending: opts.ascending ?? false });
  q = q.limit(opts.limit ?? 500);
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as T[];
}

export const sinceHours = (now: number, h: number) => new Date(now - h * 3_600_000).toISOString();

export function relativeAge(fromIso: string | null, now: number): string {
  if (!fromIso) return "Unknown";
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  const min = Math.round(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hr`;
  return `${Math.round(hr / 24)} d`;
}
