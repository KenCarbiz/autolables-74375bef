// A PostgREST-shaped in-memory stand-in for the Supabase client, good enough to
// run the command-surface LOADERS and MUTATIONS end to end.
//
// It exists because every regression test that shipped alongside a live defect
// in rounds 3-5 called an inner predicate with a hand-authored row instead of
// the entry point the app calls. These loaders are the entry points; this mock
// is what lets a test call them.
//
// `rpc("issue_vehicle_ready_token")` is modelled on 20260629010000:62-83 rather
// than stubbed, so a test can construct the QR state through the writer that
// actually mints it instead of asserting an invariant against a literal row.

export type MockRow = Record<string, unknown>;

interface Filter { op: "eq" | "neq" | "in" | "is" | "not_is"; column: string; value: unknown }

export interface RecordedUpdate {
  table: string;
  patch: MockRow;
  filters: Filter[];
}

export interface RecordedInsert { table: string; values: MockRow }
export interface RecordedRpc { fn: string; args: MockRow }
export interface RecordedInvoke { fn: string; body: MockRow }

export interface CommandDbOptions {
  tables?: Record<string, MockRow[]>;
  /** table name -> driver message. Every read/write of that table fails. */
  errors?: Record<string, string>;
  /** Result for supabase.functions.invoke(fn). */
  invokeResults?: Record<string, { data?: unknown; error?: unknown }>;
  /** Result for supabase.rpc(fn), for the RPCs this mock does not model. */
  rpcResults?: Record<string, { data?: unknown; error?: unknown }>;
  now?: () => Date;
}

const matches = (row: MockRow, f: Filter): boolean => {
  const v = row[f.column];
  switch (f.op) {
    case "eq": return v === f.value;
    case "neq": return v !== f.value;
    case "in": return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    case "is": return f.value === null ? v === null || v === undefined : v === f.value;
    case "not_is": return f.value === null ? v !== null && v !== undefined : v !== f.value;
  }
};

export class CommandDb {
  readonly tables: Record<string, MockRow[]>;
  readonly errors: Record<string, string>;
  readonly updates: RecordedUpdate[] = [];
  readonly inserts: RecordedInsert[] = [];
  readonly rpcs: RecordedRpc[] = [];
  readonly invokes: RecordedInvoke[] = [];
  private readonly invokeResults: Record<string, { data?: unknown; error?: unknown }>;
  private readonly rpcResults: Record<string, { data?: unknown; error?: unknown }>;
  private readonly now: () => Date;

  constructor(opts: CommandDbOptions = {}) {
    this.tables = opts.tables ?? {};
    this.errors = opts.errors ?? {};
    this.invokeResults = opts.invokeResults ?? {};
    this.rpcResults = opts.rpcResults ?? {};
    this.now = opts.now ?? (() => new Date());
  }

  rows(table: string): MockRow[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string) {
    const db = this;
    const filters: Filter[] = [];
    // PostgREST semantics: chained .order() calls APPEND sort keys (primary
    // first), they do not replace each other.
    const sorts: { column: string; ascending: boolean }[] = [];
    let cap: number | null = null;
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let patch: MockRow = {};

    const resolve = (): { data: unknown; error: { message: string } | null } => {
      const message = db.errors[table];
      if (message) return { data: null, error: { message } };
      if (mode === "insert") return { data: null, error: null };
      const hits = db.rows(table).filter((r) => filters.every((f) => matches(r, f)));
      if (mode === "update") {
        db.updates.push({ table, patch: { ...patch }, filters: [...filters] });
        for (const r of hits) Object.assign(r, patch);
        return { data: hits.map((r) => ({ ...r })), error: null };
      }
      // PostgREST hands back values, not references into the table. Returning
      // the stored objects let a test's "meanwhile, another tab changed this
      // row" mutation reach into rows the code under test had already read.
      let out = hits.map((r) => ({ ...r }));
      if (sorts.length) {
        out = [...out].sort((a, b) => {
          for (const { column, ascending } of sorts) {
            const av = a[column] == null ? "" : String(a[column]);
            const bv = b[column] == null ? "" : String(b[column]);
            const cmp = ascending ? av.localeCompare(bv) : bv.localeCompare(av);
            if (cmp !== 0) return cmp;
          }
          return 0;
        });
      }
      if (cap != null) out = out.slice(0, cap);
      return { data: out, error: null };
    };

    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => { filters.push({ op: "eq", column, value }); return chain; },
      neq: (column: string, value: unknown) => { filters.push({ op: "neq", column, value }); return chain; },
      in: (column: string, value: unknown[]) => { filters.push({ op: "in", column, value }); return chain; },
      is: (column: string, value: unknown) => { filters.push({ op: "is", column, value }); return chain; },
      not: (column: string, _op: string, value: unknown) => { filters.push({ op: "not_is", column, value }); return chain; },
      order: (column: string, opts?: { ascending?: boolean }) => {
        sorts.push({ column, ascending: opts?.ascending !== false });
        return chain;
      },
      limit: (n: number) => { cap = n; return chain; },
      update: (next: MockRow) => { mode = "update"; patch = next; return chain; },
      insert: (values: MockRow) => {
        mode = "insert";
        const message = db.errors[table];
        if (!message) {
          db.inserts.push({ table, values });
          db.rows(table).push({ id: `${table}-${db.rows(table).length + 1}`, ...values });
        }
        return chain;
      },
      maybeSingle: async () => {
        const { data, error } = resolve();
        if (error) return { data: null, error };
        return { data: (data as MockRow[])[0] ?? null, error: null };
      },
      single: async () => {
        const { data, error } = resolve();
        if (error) return { data: null, error };
        return { data: (data as MockRow[])[0] ?? null, error: null };
      },
      then: (onFulfilled: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled),
    };
    return chain;
  }

  async rpc(fn: string, args: MockRow = {}): Promise<{ data: unknown; error: unknown }> {
    this.rpcs.push({ fn, args });
    if (fn === "issue_vehicle_ready_token") return this.issueVehicleReadyToken(args);
    const canned = this.rpcResults[fn];
    return { data: canned?.data ?? null, error: canned?.error ?? null };
  }

  // Mirrors public.issue_vehicle_ready_token (20260629010000:62-83): reuse a live
  // vehicle/get_ready token for the VIN, else mint one that lives a year.
  private issueVehicleReadyToken(args: MockRow): { data: unknown; error: unknown } {
    const tenantId = String(args.p_tenant_id ?? "");
    const vin = String(args.p_vin ?? "").trim().toUpperCase();
    const now = this.now();
    const live = this.rows("dept_signoff_tokens").find((r) =>
      r.tenant_id === tenantId && r.vin === vin && r.department === "vehicle" &&
      r.status === "pending" && new Date(String(r.expires_at)).getTime() > now.getTime());
    if (live) return { data: live.token, error: null };
    const listing = this.rows("vehicle_listings").find((r) => r.tenant_id === tenantId && r.vin === vin);
    const token = `tok-${this.rows("dept_signoff_tokens").length + 1}`;
    const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    this.rows("dept_signoff_tokens").push({
      id: `dst-${this.rows("dept_signoff_tokens").length + 1}`,
      tenant_id: tenantId,
      vehicle_listing_id: listing?.id ?? null,
      vin, ymm: listing?.ymm ?? null,
      department: "vehicle", purpose: "get_ready",
      token, status: "pending",
      expires_at: expires,
      created_at: now.toISOString(),
    });
    return { data: token, error: null };
  }

  async invoke(fn: string, opts?: { body?: MockRow }): Promise<{ data: unknown; error: unknown }> {
    this.invokes.push({ fn, body: opts?.body ?? {} });
    const canned = this.invokeResults[fn];
    return { data: canned?.data ?? { ok: true, dispatched: [] }, error: canned?.error ?? null };
  }

  /** The client shape the app imports. */
  get client() {
    return {
      from: (table: string) => this.from(table),
      rpc: (fn: string, args?: MockRow) => this.rpc(fn, args ?? {}),
      functions: { invoke: (fn: string, opts?: { body?: MockRow }) => this.invoke(fn, opts) },
    };
  }
}

export const createCommandDb = (opts: CommandDbOptions = {}): CommandDb => new CommandDb(opts);
