import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import IntegrationHealthPanel from "./IntegrationHealthPanel";
import { functionCalls, resetSupabaseSpy, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: true, user: { id: "u1" }, loading: false }) }));

const counts = (over: Record<string, { total: number; last24h: number }> = {}) => ({
  received: { total: 0, last24h: 0 }, unmatched: { total: 0, last24h: 0 }, dead: { total: 0, last24h: 0 }, ...over,
});

const health = (over: Record<string, unknown> = {}) => ({
  ok: true,
  state: "not_configured",
  generated_at: "2026-10-30T00:00:00Z",
  apps: { autofilm: { state: "not_configured", connections: [] }, autocurb: { state: "not_configured", connections: [] } },
  inbox: { by_status: counts(), oldest_received_age_seconds: null, unmatched: 0, dead: 0 },
  outbox: { by_status: { pending: { total: 0, last24h: 0 }, dead: { total: 0, last24h: 0 } }, oldest_pending_age_seconds: null, pending: 0, dead: 0 },
  flags: [{ direction: "film_to_labels", enabled_tenants: 0, configured_tenants: 0 }],
  ...over,
});

beforeEach(() => resetSupabaseSpy());

describe("IntegrationHealthPanel", () => {
  it("OPS-01 shows Not configured, never healthy, when there is no data", async () => {
    spyResponses.functions["integration-health"] = { data: health() };
    const { container } = render(<IntegrationHealthPanel />);
    await waitFor(() => expect(screen.getAllByText(/Not configured/).length).toBeGreaterThan(0));
    expect(container.textContent?.toLowerCase()).not.toMatch(/healthy|all good|operational/);
    expect(screen.getByText("AutoFilm")).toBeTruthy();
    expect(screen.getByText("AutoCurb")).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
  });

  it("reads only: one integration-health call and no table or RPC writes", async () => {
    spyResponses.functions["integration-health"] = { data: health() };
    render(<IntegrationHealthPanel />);
    await waitFor(() => expect(screen.getAllByText(/Not configured/).length).toBeGreaterThan(0));
    expect(functionCalls()).toEqual(["integration-health"]);
    expect(writeCalls()).toEqual([]);
    expect(screen.queryAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Refresh"]);
  });

  it("shows connection facts and unmatched and dead counts when configured", async () => {
    spyResponses.functions["integration-health"] = {
      data: health({
        state: "configured",
        apps: {
          autofilm: { state: "configured", connections: [{ id: "c1", tenant_id: "t1", tenant_name: "Example Motors", display_name: "Film", status: "active", last_success_at: null, last_error_at: null, last_error_code: "http_503" }] },
          autocurb: { state: "not_configured", connections: [] },
        },
        inbox: { by_status: counts({ unmatched: { total: 3, last24h: 1 } }), oldest_received_age_seconds: 600, unmatched: 3, dead: 2 },
        flags: [{ direction: "film_to_labels", enabled_tenants: 1, configured_tenants: 2 }],
      }),
    };
    render(<IntegrationHealthPanel />);
    await waitFor(() => expect(screen.getByText("Example Motors")).toBeTruthy());
    expect(screen.getByText("Unmatched: 3")).toBeTruthy();
    expect(screen.getByText("Dead: 2")).toBeTruthy();
    expect(screen.getByText("On for 1 of 2")).toBeTruthy();
    expect(screen.getByText(/http_503/)).toBeTruthy();
    expect(screen.getByText(/Oldest waiting: 10m/)).toBeTruthy();
  });

  it("reports a deployment with integrations switched off as Not configured", async () => {
    spyResponses.functions["integration-health"] = {
      error: { message: "503", context: new Response(JSON.stringify({ error: "integrations_disabled" }), { status: 503 }) } as unknown as { message: string },
    };
    render(<IntegrationHealthPanel />);
    await waitFor(() => expect(screen.getByText(/switched off for this deployment/)).toBeTruthy());
  });
});
