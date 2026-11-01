import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, writeCalls } from "@/test/mocks/supabaseSpy";
import { AL97_02, AL97_03, AL97_04, AL97_22, AL97_23 } from "@/pages/admin/fixtures/al97-batch2";
import { storeReadiness } from "./inventoryNetwork/StoresBoard";
import type { InventoryNetworkFixture } from "./inventoryNetwork/overviewModel";
import InventoryNetworkPage from "./InventoryNetworkPage";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: true, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

const FILE = encodeURIComponent("/inbound/MP15397_inventory.csv");
const data = (f: typeof AL97_02) => f.fixture.views["inventory-network"] as InventoryNetworkFixture;
const noWrites = () => {
  expect(functionCalls()).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "rpc" && /save|set_|approve|decide|retry|enqueue|resolve|review|revoke/.test(c.fn))).toEqual([]);
};

beforeEach(() => resetSupabaseSpy());

describe("AL97 stores readiness", () => {
  it("lists every remaining blocker for a store, not just the first", () => {
    const s = data(AL97_02).overview.stores[1];
    const r = storeReadiness({ ...s, mappings: [] }, "t-al97", "/inbound/x.csv", []);
    expect(r.blockers).toEqual(["dealer mapping missing", "file binding missing", "store import paused"]);
    expect(storeReadiness(s, "t-al97", null, null).binding.label).toBe("No file");
    expect(storeReadiness(s, "t-al97", "/inbound/x.csv", null).binding.label).toBe("Unknown");
  });

  it("shows mapping, binding, feed and inventory as separate columns and links each row to its store", () => {
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=stores", fixture: AL97_02.fixture });
    expect(screen.getByText("5 stores are not ready to import")).toBeInTheDocument();
    const row = screen.getByText("George Harte Nissan", { selector: "b" }).closest("tr")!;
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    expect(within(row).getByText("Paused")).toBeInTheDocument();
    expect(within(row).getByRole("link")).toHaveAttribute("href", expect.stringContaining("store=s4"));
    expect(within(row).getByRole("link")).toHaveAccessibleName(/file binding pending, store import paused/);
    noWrites();
  });
});

describe("AL97 feed mapping review", () => {
  it("keeps Approve binding disabled until the account check is ticked and never enables Import now while blocked", () => {
    renderAdmin(<InventoryNetworkPage />, { route: `/admin/integrations/inventory-network?view=mapping&file=${FILE}`, fixture: AL97_03.fixture });
    expect(screen.getByRole("heading", { level: 1, name: "Feed mapping review" })).toBeInTheDocument();
    const approve = screen.getAllByRole("button", { name: "Approve binding" })[0];
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I checked this file belongs to this account/));
    expect(approve).toBeEnabled();
    const importNow = screen.getAllByRole("button", { name: "Import now" })[0];
    expect(importNow).toBeDisabled();
    expect(importNow).toHaveAttribute("title", expect.stringContaining("approve the file binding"));
    expect(screen.getByText("Approve the file binding and verify the worker. Resume is a separate reviewed change.")).toBeInTheDocument();
    noWrites();
  });

  it("shows the ready state only when every condition holds, and opens the reviewed import instead of writing", () => {
    renderAdmin(<InventoryNetworkPage />, { route: `/admin/integrations/inventory-network?view=mapping&file=${FILE}`, fixture: AL97_23.fixture });
    expect(screen.getByRole("heading", { level: 1, name: "Feed mapping / ready" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review initial import" })).toHaveAttribute("href", "#inv-file-import");
    noWrites();
  });
});

describe("AL97 import job", () => {
  it("treats an overdue unattempted job as queued, not failed, and keeps retry disabled with a reason", () => {
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=runs&job=1042", fixture: AL97_04.fixture });
    expect(screen.getByText("Queued beyond the processing target")).toBeInTheDocument();
    expect(screen.getByText("None · not attempted")).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry job" });
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute("title", "Only failed, dead or cancelled jobs can be retried.");
    noWrites();
  });

  it("offers a confirmed retry only for a failed job", () => {
    const fx = data(AL97_04);
    const failed = { ...AL97_04.fixture, views: { "inventory-network": { ...fx, jobs: fx.jobs!.map((j) => (j.id === "1042" ? { ...j, status: "failed" as const, attempts: 5, last_error: "parse_error", started_at: "2026-10-31T21:01:00Z", finished_at: "2026-10-31T21:02:00Z" } : j)) } } };
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=runs&job=1042", fixture: failed });
    expect(screen.getByText("Import failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry job" }));
    expect(screen.getByRole("button", { name: "Confirm retry" })).toBeEnabled();
    noWrites();
  });

  it("separates validated, applied and customer-visible counts for a completed job", () => {
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=runs&job=DEMO-1043", fixture: AL97_22.fixture });
    expect(screen.getByRole("heading", { level: 1, name: "Import job / completed" })).toBeInTheDocument();
    expect(screen.getByText("Rows validated").parentElement).toHaveTextContent("100");
    expect(screen.getByText("Customer visible").parentElement).toHaveTextContent("60");
    expect(screen.getByText("IMP-DEMO-1043 / SNAP-DEMO-001")).toBeInTheDocument();
    noWrites();
  });
});
