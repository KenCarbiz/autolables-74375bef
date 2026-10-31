import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, rpcCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import InventoryNetworkPage from "../InventoryNetworkPage";
// Generated from the synthetic scratch database by supabase/tests/inventory_network/61_dedupe.sql.
import fx from "./__fixtures__/dedupe.json";

const mocks = vi.hoisted(() => ({ auth: { user: { id: "u1" }, isAdmin: true, loading: false } }));
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("@/test/mocks/supabaseSpy")).supabaseSpy }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

const group = { id: "00000000-0000-0000-0000-00000000dd01", tenant_id: "t1", name: "Dedupe Auto Group", legal_name: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const controls = { id: 1, ingestion_paused: true, emergency_stop: false, reconcile_enabled: false, reason: null, updated_at: "2026-10-01T00:00:00Z" };
const overview = { group, controls, stores: [], exceptions: { open_conflicts: 0, retirement_review: 0, quarantined_partitions_7d: 0, failed_jobs: 0, pending_mappings: 0 } };
const route = (q: string) => `/admin/integrations/inventory-network?view=duplicates${q}`;

// The fixture previews expire from 21:21 UTC on the day they were generated, so
// the clock is pinned before that; otherwise the approve button disappears.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T21:20:00Z"));
  resetSupabaseSpy();
  spyResponses.tables.dealer_groups = { data: [group] };
  spyResponses.rpcs.inv_admin_overview = { data: overview };
  spyResponses.rpcs.inv_dedupe_overview = { data: fx.overview };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Duplicate handling", () => {
  it("lists candidates by suffix only and reads without writing or calling functions", async () => {
    renderAdmin(<InventoryNetworkPage />, { route: route("") });
    expect(await screen.findByRole("heading", { name: "Candidates" })).toBeInTheDocument();
    expect(screen.getAllByText(/\.\.\.0000\d\d/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/DDV0000/)).not.toBeInTheDocument();
    expect(screen.getByText("Not yet approved by the owner.", { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(new Set(rpcCalls())).toEqual(new Set(["inv_admin_overview", "inv_dedupe_overview"])));
    expect(functionCalls()).toEqual([]);
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  });

  it("shows KEEP, ARCHIVE, LINK and PRESERVE for an eligible preview, with zero provider calls", async () => {
    spyResponses.rpcs.inv_dedupe_get_preview = { data: fx.eligible };
    renderAdmin(<InventoryNetworkPage />, { route: route(`&preview=${fx.eligibleId}`) });
    const list = await screen.findByRole("heading", { name: "What happens to each record" });
    const section = list.closest("section")!;
    for (const verb of ["KEEP", "ARCHIVE", "LINK", "PRESERVE"]) expect(within(section).getByText(verb)).toBeInTheDocument();
    expect(screen.getByText(/0 \(reconciliation never calls a paid provider\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve this exact preview" })).toBeInTheDocument();
  });

  it("shows BLOCKED and the reasons for a held set, and offers no approval", async () => {
    spyResponses.rpcs.inv_dedupe_get_preview = { data: fx.review };
    renderAdmin(<InventoryNetworkPage />, { route: route(`&dtab=review&preview=${fx.reviewId}`) });
    expect(await screen.findByText("Needs a person's review")).toBeInTheDocument();
    expect(screen.getAllByText("BLOCKED").length).toBeGreaterThan(0);
    expect(screen.queryByText("ARCHIVE")).not.toBeInTheDocument();
    expect(screen.getAllByText("Provider data exists only on the record that would be archived.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Approve this exact preview" })).not.toBeInTheDocument();
  });

  it("states that permanent purge is unavailable", async () => {
    renderAdmin(<InventoryNetworkPage />, { route: route("&dtab=purge") });
    expect(await screen.findByText("Permanent purge is off and cannot be turned on here")).toBeInTheDocument();
  });
});
