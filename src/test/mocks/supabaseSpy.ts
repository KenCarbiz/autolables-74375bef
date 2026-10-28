// A recording Supabase stand-in for component tests. Every table operation,
// RPC and storage call is appended to `spyCalls`, so a test can prove that
// mounting a view issued reads only. Responses are configured per table and
// per RPC; an RPC with no configured response answers with Postgres 42883
// (undefined function), the honest state before a migration is applied.

export type SpyCall =
  | { kind: "table"; table: string; op: string; args: unknown[] }
  | { kind: "rpc"; fn: string; args: unknown }
  | { kind: "storage"; bucket: string; op: string }
  | { kind: "function"; fn: string; args: unknown };

export interface SpyResponse {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}

/** One link of a table chain, in call order: `select`, `eq`, `maybeSingle`, ... */
export interface SpyOp {
  op: string;
  args: unknown[];
}

/**
 * A table response, or a function of the chain that asked for it, for a table
 * a screen reads in more than one shape (a single head row and a page of rows).
 */
export type SpyTableResponse = SpyResponse | ((ops: SpyOp[]) => SpyResponse);

export const spyCalls: SpyCall[] = [];
export const spyResponses: {
  tables: Record<string, SpyTableResponse>;
  rpcs: Record<string, SpyResponse>;
  functions: Record<string, SpyResponse>;
} = { tables: {}, rpcs: {}, functions: {} };

export const resetSupabaseSpy = (): void => {
  spyCalls.length = 0;
  spyResponses.tables = {};
  spyResponses.rpcs = {};
  spyResponses.functions = {};
};

/** True when the chain ended in a single-row read. */
export const isSingleRead = (ops: SpyOp[]): boolean => ops.some((o) => o.op === "maybeSingle" || o.op === "single");

const WRITE_OPS = new Set(["insert", "update", "upsert", "delete"]);

/** Table writes and every RPC: the set that must stay empty after a mount. */
export const writeCalls = (): SpyCall[] =>
  spyCalls.filter((c) => (c.kind === "table" && WRITE_OPS.has(c.op)) || c.kind === "rpc");

/** Edge function invocations: the calls that can reach a paid provider or send mail. */
export const functionCalls = (): string[] => spyCalls.filter((c): c is Extract<SpyCall, { kind: "function" }> => c.kind === "function").map((c) => c.fn);

export const rpcCalls = (): string[] => spyCalls.filter((c): c is Extract<SpyCall, { kind: "rpc" }> => c.kind === "rpc").map((c) => c.fn);

const missingFunction = (fn: string): SpyResponse => ({ data: null, error: { code: "42883", message: `function public.${fn} does not exist` } });

const thenable = (resolveWith: () => SpyResponse, record: (op: string, args: unknown[]) => void): unknown => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, count: null, error: null, ...resolveWith() }).then(onFulfilled, onRejected);
      }
      if (typeof prop === "symbol") return undefined;
      return (...args: unknown[]) => {
        record(String(prop), args);
        return chain;
      };
    },
  };
  const chain: unknown = new Proxy(() => chain, handler);
  return chain;
};

export const supabaseSpy = {
  from: (table: string) => {
    const ops: SpyOp[] = [];
    return thenable(
      () => {
        const r = spyResponses.tables[table];
        if (typeof r === "function") return r(ops);
        return r ?? { data: null, error: null, count: null };
      },
      (op, args) => {
        ops.push({ op, args });
        spyCalls.push({ kind: "table", table, op, args });
      },
    );
  },
  rpc: (fn: string, args?: unknown) => {
    spyCalls.push({ kind: "rpc", fn, args });
    return thenable(() => spyResponses.rpcs[fn] ?? missingFunction(fn), () => undefined);
  },
  storage: {
    from: (bucket: string) => thenable(() => ({ data: null, error: null }), (op) => spyCalls.push({ kind: "storage", bucket, op })),
  },
  channel: () => thenable(() => ({ data: null, error: null }), () => undefined),
  removeChannel: () => undefined,
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  functions: {
    invoke: async (fn: string, args?: unknown) => {
      spyCalls.push({ kind: "function", fn, args });
      const r = spyResponses.functions[fn];
      return { data: r?.data ?? null, error: r?.error ?? null };
    },
  },
};
