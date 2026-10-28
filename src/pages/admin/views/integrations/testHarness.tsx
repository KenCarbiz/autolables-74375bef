import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";

// Render helper for the Integrations view tests: a fixture provider, a memory
// router and a query client with retries off. Each test file still declares
// its own module mocks, which vitest hoists per file.

export const FIXTURE_NOW = Date.parse("2026-10-24T14:30:00Z");

export function renderInFixture(ui: ReactElement, views: Record<string, unknown>, options: { route?: string; path?: string; now?: number } = {}) {
  const fixture: AdminFixture = { label: "test", now: options.now ?? FIXTURE_NOW, views };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const route = options.route ?? "/admin";
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AdminFixtureProvider fixture={fixture}>
          {options.path ? (
            <Routes>
              <Route path={options.path} element={ui} />
            </Routes>
          ) : (
            ui
          )}
        </AdminFixtureProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
