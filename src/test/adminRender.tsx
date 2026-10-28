import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";

// Mounts an Administration view or child page the way the app does: inside a
// router and a query client, optionally under a design fixture. Queries never
// retry so a configured failure surfaces as Unknown immediately.

export function renderAdmin(
  ui: ReactElement,
  opts: { route?: string; path?: string; fixture?: AdminFixture | null } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const routed = opts.path ? (
    <Routes>
      <Route path={opts.path} element={ui} />
    </Routes>
  ) : ui;
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? "/admin"]}>{routed}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(opts.fixture ? <AdminFixtureProvider fixture={opts.fixture}>{tree}</AdminFixtureProvider> : tree);
}
