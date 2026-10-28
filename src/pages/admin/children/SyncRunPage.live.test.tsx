import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, spyCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { RUN_RATE_LIMITED, RUN_SUCCESS } from "@/pages/admin/fixtures/integrationsData";
import type { SyncRunRow } from "@/lib/admin/integrations/runs";
import SyncRunPage from "./SyncRunPage";

// Screen 13 against a live (spied) ledger read: the run renders from its row,
// the back link returns to the feed, and opening the full payload shows the
// redacted evidence and never a credential.

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1", name: "Example Motors" }, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC", feature_blackbook: false }, loading: false }) }));

const SECRET = "example-secret-value-0001";
const RUN: SyncRunRow = {
  ...RUN_RATE_LIMITED,
  raw: { ...(RUN_RATE_LIMITED.raw ?? {}), api_key: SECRET, headers: { Authorization: `Bearer ${SECRET}`, "x-api-token": SECRET }, request: { client_secret: SECRET, page: 1 } },
};

const renderRun = () =>
  renderAdmin(
    <Routes>
      <Route path="/admin/integrations/runs/:runId" element={<SyncRunPage />} />
      <Route path="/admin" element={<p>feed tab</p>} />
    </Routes>,
    { route: `/admin/integrations/runs/${RUN.id}` },
  );

beforeEach(() => {
  resetSupabaseSpy();
  spyResponses.tables.inventory_sync_runs = { data: RUN, error: null };
  spyResponses.tables.inventory_sync_errors = { data: [], error: null };
  spyResponses.rpcs.admin_feed_last_success = { data: RUN_SUCCESS.started_at, error: null };
});

describe("SyncRunPage against a live ledger read (screen 13)", () => {
  it("renders the run read by its id and starts nothing", async () => {
    renderRun();
    expect(await screen.findByText("Provider rate limited")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Inventory sync run" })).toBeInTheDocument();
    expect(screen.getByText("429")).toBeInTheDocument();
    expect(screen.getByText("The provider declined this request")).toBeInTheDocument();
    const runRead = spyCalls.find((c) => c.kind === "table" && c.table === "inventory_sync_runs" && c.op === "eq");
    expect(runRead && runRead.kind === "table" ? runRead.args : null).toEqual(["id", RUN.id]);
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
    expect(functionCalls()).toEqual([]);
  });

  it("returns to the inventory feed from the back link", async () => {
    renderRun();
    await screen.findByText("Provider rate limited");
    const links = screen.getAllByRole("link", { name: "Back to feed" });
    for (const link of links) expect(link).toHaveAttribute("href", "/admin?tab=inventory-feed");
    fireEvent.click(links[0]);
    expect(screen.getByText("feed tab")).toBeInTheDocument();
  });

  it("opens the full redacted payload on request and shows no credential in it or anywhere on the page", async () => {
    renderRun();
    await screen.findByText("Provider rate limited");
    const summary = screen.getByText("Full redacted payload");
    const disclosure = summary.closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);

    fireEvent.click(summary);
    expect(disclosure.open).toBe(true);
    const payload = within(disclosure).getByText((_, el) => el?.tagName === "PRE");
    const text = payload.textContent ?? "";
    expect(text).toContain(`"run_id": "${RUN.id}"`);
    expect(text).toContain('"api_key": "[redacted]"');
    expect(text).toContain('"Authorization": "[redacted]"');
    expect(text).toContain('"x-api-token": "[redacted]"');
    expect(text).toContain('"client_secret": "[redacted]"');
    expect(text).toContain('"page": 1');
    expect(text).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(within(disclosure).getByText(/Credential-like fields are removed before display/)).toBeInTheDocument();
  });
});
