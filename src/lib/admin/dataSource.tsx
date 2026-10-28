import { createContext, useContext, type ReactNode } from "react";

// Administration views read their data through hooks that consult this
// context. In production the context is absent and every hook queries live,
// tenant-scoped data. The design fixture route, which exists only in
// development builds, provides a fixture so the parity harness can render
// each reference screen deterministically. Fixture data never reaches a
// production bundle path: the provider is only mounted by the fixture route.

export interface AdminFixture {
  /** Keyed by view id; each view declares its own slice type. */
  views: Record<string, unknown>;
  /** Frozen clock so relative times are stable. */
  now: number;
  label: string;
}

const AdminDataSourceContext = createContext<AdminFixture | null>(null);

export const AdminFixtureProvider = ({ fixture, children }: { fixture: AdminFixture; children: ReactNode }) => (
  <AdminDataSourceContext.Provider value={fixture}>{children}</AdminDataSourceContext.Provider>
);

export const useAdminFixture = (): AdminFixture | null => useContext(AdminDataSourceContext);

/** The slice a view reads when a fixture is active, or null for live data. */
export function useViewFixture<T>(viewId: string): T | null {
  const fixture = useContext(AdminDataSourceContext);
  if (!fixture) return null;
  return (fixture.views[viewId] as T | undefined) ?? null;
}

/** The clock every view should use for relative times, so fixtures stay stable. */
export function useAdminNow(): number {
  const fixture = useContext(AdminDataSourceContext);
  return fixture?.now ?? Date.now();
}
