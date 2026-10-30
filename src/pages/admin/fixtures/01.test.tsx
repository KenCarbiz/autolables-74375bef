import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import OverviewView, { type OverviewFixture } from "@/pages/admin/views/OverviewView";
import { fixture01 } from "./01";
import { ADMIN_FIXTURES } from "./index";

const spies = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => spies.from(...args) },
}));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "00000000-0000-4000-8000-000000000000" }, loading: false }),
}));
vi.mock("@/contexts/DealerSettingsContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/DealerSettingsContext")>("@/contexts/DealerSettingsContext");
  return { ...actual, useDealerSettings: () => ({ settings: actual.DEFAULT_SETTINGS }) };
});

const renderOverview = (fixture: AdminFixture) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminFixtureProvider fixture={fixture}>
          <OverviewView />
        </AdminFixtureProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const overviewOf = (f: AdminFixture) => f.views.overview as OverviewFixture;

describe("fixture 01 (Administration Overview)", () => {
  it("is registered for the overview tab with a frozen synthetic clock", () => {
    expect(ADMIN_FIXTURES["01"]).toBe(fixture01);
    expect(fixture01.tabId).toBe("overview");
    expect(fixture01.childPath).toBeUndefined();
    expect(new Date(fixture01.fixture.now).toISOString()).toBe("2026-10-19T23:30:00.000Z");
    expect(overviewOf(fixture01.fixture).attention.length).toBeGreaterThan(0);
  });

  it("holds synthetic data only", () => {
    const text = JSON.stringify(fixture01);
    expect(text).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const row of overviewOf(fixture01.fixture).activity) {
      if (row.detail.includes("@")) expect(row.detail).toMatch(/@example\.test/);
    }
  });

  it("renders every module from the fixture without reading the database", () => {
    spies.from.mockClear();
    renderOverview(fixture01.fixture);

    expect(spies.from).not.toHaveBeenCalled();
    expect(screen.getByText("128")).toBeTruthy();
    expect(screen.getByText("4 of 6")).toBeTruthy();
    expect(screen.getByText("1,012")).toBeTruthy();
    expect(screen.getByText("Review provider rate limit")).toBeTruthy();
    expect(screen.getByText("Inventory sync rate limited")).toBeTruthy();
    expect(screen.getByText("Open diagnostics").closest("a")?.getAttribute("href")).toBe(adminTabHref("inventory-feed"));
  });

  it("shows unknown counts as words, never as zero", () => {
    const overview = overviewOf(fixture01.fixture);
    const variant: AdminFixture = {
      ...fixture01.fixture,
      views: {
        overview: {
          ...overview,
          activeInventory: { kind: "failed" },
          openExceptions: { kind: "loading" },
          policyReviews: { kind: "known", value: 0, capped: false },
          setup: null,
        } satisfies OverviewFixture,
      },
    };
    renderOverview(variant);

    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getAllByText("0")).toHaveLength(1);
  });
});
