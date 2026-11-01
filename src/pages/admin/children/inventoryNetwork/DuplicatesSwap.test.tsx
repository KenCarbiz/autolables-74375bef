import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, rpcCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import InventoryNetworkPage from "../InventoryNetworkPage";
import fx from "./__fixtures__/dedupe.json";

// The duplicates route renders the AL97 summary (13) or exact review (14) on
// top of the unchanged Duplicate handling section.

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T21:20:00Z"));
  resetSupabaseSpy();
  spyResponses.tables.dealer_groups = { data: [group] };
  spyResponses.rpcs.inv_admin_overview = { data: overview };
  spyResponses.rpcs.inv_dedupe_overview = { data: fx.overview };
});
afterEach(() => { vi.useRealTimers(); });

describe("Duplicate handling route (AL97 13 and 14)", () => {
  it("shows the AL97 summary above the approved section and scans only on click", async () => {
    renderAdmin(<InventoryNetworkPage />, { route: route("") });
    expect(await screen.findByRole("heading", { level: 1, name: "Duplicate handling" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Candidates" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Duplicate handling summary" })).toBeInTheDocument();
    await waitFor(() => expect(new Set(rpcCalls())).toEqual(new Set(["inv_admin_overview", "inv_dedupe_overview"])));
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
    const scan = screen.getAllByRole("button", { name: "Run detection" })[0];
    fireEvent.click(scan);
    await waitFor(() => expect(rpcCalls()).toContain("inv_dedupe_scan"));
    expect(functionCalls()).toEqual([]);
  });

  it("shows the exact review above the approved preview for the same preview id", async () => {
    spyResponses.rpcs.inv_dedupe_get_preview = { data: fx.eligible };
    renderAdmin(<InventoryNetworkPage />, { route: route(`&preview=${fx.eligibleId}`) });
    expect(await screen.findByRole("heading", { level: 1, name: "Review exact reconciliation" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "What happens to each record" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve exact preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve this exact preview" })).toBeInTheDocument();
    expect(new Set(rpcCalls())).toEqual(new Set(["inv_admin_overview", "inv_dedupe_overview", "inv_dedupe_get_preview"]));
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  });
});
