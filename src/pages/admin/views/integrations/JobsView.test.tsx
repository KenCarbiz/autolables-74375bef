import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import JobsView, { type JobsViewFixture } from "./JobsView";
import { JOB_CATALOG } from "@/lib/admin/integrations/jobs";
import { renderInFixture, FIXTURE_NOW } from "./testHarness";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "", feature_blackbook: false }, loading: false }) }));

const hoursAgo = (h: number) => new Date(FIXTURE_NOW - h * 3_600_000).toISOString();
const cronNames = Array.from(new Set(JOB_CATALOG.map((j) => j.cronName)));

describe("JobsView", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
  });

  it("shows every job as unknown when the scheduler is unreadable and no ledger exists", () => {
    const fixture: JobsViewFixture = { status: { cron: Object.fromEntries(cronNames.map((n) => [n, "unavailable" as const])), serverLedger: {}, source: "unavailable" }, ledgers: {} };
    renderInFixture(<JobsView />, { jobs: fixture });
    expect(screen.getByText(/not readable for this role/)).toBeInTheDocument();
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(JOB_CATALOG.length);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("is healthy only where a rooftop ledger proves a recent success", () => {
    const fixture: JobsViewFixture = {
      status: {
        cron: Object.fromEntries(cronNames.map((n) => [n, n === "marketcheck-sync" ? { jobname: n, schedule: "7 * * * *", active: true, last_status: "succeeded", last_message: null, last_start: hoursAgo(1), last_end: hoursAgo(1) } : null])),
        serverLedger: {},
        source: "get_cron_job_status",
      },
      ledgers: { inventory_sync: { lastAttemptAt: hoursAgo(8), lastSuccessAt: hoursAgo(8), lastOutcome: "succeeded" } },
    };
    renderInFixture(<JobsView />, { jobs: fixture });
    expect(screen.getAllByText("Healthy")).toHaveLength(1);
    expect(screen.getByText("Hourly at :07")).toBeInTheDocument();
    expect(screen.getAllByText(/Not scheduled/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open feed" })).toHaveAttribute("href", "/admin?tab=inventory-feed");
  });
});
