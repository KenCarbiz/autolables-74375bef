// Test stub for "@supabase/supabase-js".
//
// The unit suite exercises pure logic; no test hits a real Supabase client.
// Several pure modules nonetheless sit behind a transitive import of
// src/integrations/supabase/client.ts, which imports this package — absent in
// the test sandbox. Aliasing the package to this stub (see vitest.config.ts)
// lets those modules load. A test that genuinely needs Supabase behavior should
// vi.mock("@/integrations/supabase/client") with its own fixtures on top.

// A chainable no-op: every property access returns a function that returns the
// same chain, and the chain resolves to an empty { data, error } result when
// awaited — so an accidental call doesn't throw, it just returns nothing.
const makeChain = (): any => {
  const result = { data: null, error: null, count: null };
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown) => resolve(result);
      }
      return (..._args: unknown[]) => chain;
    },
  };
  const chain: any = new Proxy(() => chain, handler);
  return chain;
};

export const createClient = (..._args: unknown[]): any => makeChain();

// Type-only re-exports so `import type { ... }` sites resolve against the stub.
export type User = any;
export type Session = any;
export type AuthChangeEvent = any;
export type SupabaseClient = any;
