// A recording Supabase stand-in for component tests. Every table operation,
// RPC and storage call is appended to `spyCalls`, so a test can prove that
// mounting a view issued reads only. Responses are configured per table and
// per RPC; an RPC with no configured response answers with Postgres 42883
// (undefined function), the honest state before a migration is applied.

export type SpyCall =
  | { kind: "table"; table: string; op: string; args: unknown[] }
  | { kind: "rpc"; fn: string; args: unknown }
  | { kind: "storage"; bucket: string; op: string };

export interface SpyResponse {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}

export const spyCalls: SpyCall[] = [];
export const spyResponses: { tables: Record<string, SpyResponse>; rpcs: Record<string, SpyResponse> } = { tables: {}, rpcs: {} };

export const resetSupabaseSpy = (): void => {
  spyCalls.length = 0;
  spyResponses.tables = {};
  spyResponses.rpcs = {};
};

const WRITE_OPS = new Set(["insert", "update", "upsert", "delete"]);

/** Table writes and every RPC: the set that must stay empty after a mount. */
export const writeCalls = (): SpyCall[] =>
  spyCalls.filter((c) => (c.kind === "table" && WRITE_OPS.has(c.op)) || c.kind === "rpc");

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
  from: (table: string) =>
    thenable(
      () => spyResponses.tables[table] ?? { data: null, error: null, count: null },
      (op, args) => spyCalls.push({ kind: "table", table, op, args }),
    ),
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
  functions: { invoke: async () => ({ data: null, error: null }) },
};
