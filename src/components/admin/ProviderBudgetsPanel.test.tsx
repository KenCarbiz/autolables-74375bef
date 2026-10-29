import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  missing: false,
  rpc: [] as Array<{ fn: string; args: unknown }>,
  invoke: [] as Array<{ fn: string; body: unknown }>,
  tables: {} as Record<string, unknown>,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: vi.fn(), error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const result = () => Promise.resolve({ data: state.tables[table] ?? null, error: null });
    Object.assign(chain, {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, is: () => chain,
      limit: () => result(),
      maybeSingle: () => result(),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej),
    });
    return chain;
  };
  return {
    supabase: {
      from,
      rpc: (fn: string, args: unknown) => {
        state.rpc.push({ fn, args });
        if (fn === "platform_provider_budget_overview") {
          return Promise.resolve(state.missing
            ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.platform_provider_budget_overview" } }
            : { data: state.tables.overview, error: null });
        }
        return Promise.resolve({ data: {}, error: null });
      },
      functions: {
        invoke: (fn: string, opts: { body: unknown }) => {
          state.invoke.push({ fn, body: opts.body });
          return Promise.resolve({ data: { ok: true, result: { email: "sent", sms: "sent" } }, error: null });
        },
      },
    },
  };
});

import ProviderBudgetsPanel from "./ProviderBudgetsPanel";

const T1 = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  state.missing = false;
  state.rpc = [];
  state.invoke = [];
  state.tables = {
    overview: [{
      tenant_id: T1, tenant_name: "Synthetic Motors", provider: "firecrawl", mode: "enforce", monthly_call_cap: 100,
      monthly_usd_cap: null, alert_thresholds: [80, 100], block_essential: false, notes: null, calls: 85, usd: 0, denied: 2,
    }],
    platform_alert_settings: { email_enabled: true, sms_enabled: false, email_recipients: ["ops@example.com"], sms_recipients: [] },
    provider_budget_alerts: [{
      id: 1, created_at: "2026-11-02T10:00:00Z", tenant_id: T1, provider: "firecrawl", kind: "threshold", threshold: 80,
      email_status: "sent", sms_status: "disabled", attempts: 1, delivered_at: "2026-11-02T10:05:00Z",
    }],
    provider_unit_prices: [],
    tenants: [{ id: T1, name: "Synthetic Motors" }],
  };
});

describe("ProviderBudgetsPanel", () => {
  it("says the migration is pending instead of showing empty tables", async () => {
    state.missing = true;
    render(<ProviderBudgetsPanel />);
    expect(await screen.findByTestId("budgets-migration-pending")).toHaveTextContent("20261103000000");
  });

  it("shows each dealership's use against its limit, refusals and recent alerts", async () => {
    render(<ProviderBudgetsPanel />);
    expect(await screen.findAllByText("Synthetic Motors")).not.toHaveLength(0);
    expect(screen.getByText("85 calls · $0.00")).toBeInTheDocument();
    expect(screen.getByLabelText("85% of the limit used")).toBeInTheDocument();
    expect(screen.getByText("100 calls")).toBeInTheDocument();
    expect(screen.getByText("Firecrawl (page renders, OEM searches): 80% used")).toBeInTheDocument();
    expect(screen.getByText("Alerts go out by email only.")).toBeInTheDocument();
  });

  it("saves email and text message together when both are switched on", async () => {
    render(<ProviderBudgetsPanel />);
    fireEvent.click(await screen.findByLabelText("Send alerts by text message"));
    expect(screen.getByText("Alerts go out by email and text message at the same time.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Text message recipients"), { target: { value: "(555) 010-0000" } });
    fireEvent.click(screen.getByText("Save alert delivery"));
    await waitFor(() => expect(state.rpc.find((r) => r.fn === "platform_set_alert_settings")?.args).toEqual({
      p_email_enabled: true, p_sms_enabled: true, p_email_recipients: ["ops@example.com"], p_sms_recipients: ["+15550100000"],
    }));
  });

  it("sends a test only on the channels switched on", async () => {
    render(<ProviderBudgetsPanel />);
    fireEvent.click(await screen.findByText("Send a test"));
    await waitFor(() => expect(state.invoke).toEqual([{ fn: "provider-budget-alerts", body: { action: "test", email: true, sms: false } }]));
  });

  it("adds a dealership budget through the audited function", async () => {
    render(<ProviderBudgetsPanel />);
    fireEvent.click(await screen.findByText("Add a budget"));
    fireEvent.change(screen.getByLabelText("Dealership"), { target: { value: T1 } });
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "blackbook" } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "enforce" } });
    fireEvent.change(screen.getByLabelText("Dollars per month"), { target: { value: "40" } });
    fireEvent.click(screen.getByText("Save budget"));
    await waitFor(() => expect(state.rpc.find((r) => r.fn === "platform_set_tenant_budget")?.args).toEqual({
      p_tenant_id: T1, p_provider: "blackbook", p_mode: "enforce", p_monthly_call_cap: null, p_monthly_usd_cap: 40,
      p_alert_thresholds: [80, 100], p_block_essential: false, p_notes: null,
    }));
  });
});
