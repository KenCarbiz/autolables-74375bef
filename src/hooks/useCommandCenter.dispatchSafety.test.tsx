import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createCommandDb, type CommandDb, type MockRow } from "@/test/mocks/commandCenterDb";

// ──────────────────────────────────────────────────────────────────────
// BUCKET G — irreversible-action safety on Authorize & Dispatch.
//
// Authorization is one-shot: a second press emails every department and every
// vendor a second time and writes a second EVT_AUTHORIZED as if it were the
// first. So every question this button asks before sending has to be answered
// by the database, and "I could not read" must never be read as "it never
// happened".
// ──────────────────────────────────────────────────────────────────────

let db: CommandDb;
let role: string;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => db.from(table),
    rpc: (fn: string, args?: MockRow) => db.rpc(fn, args ?? {}),
    functions: { invoke: (fn: string, opts?: { body?: MockRow }) => db.invoke(fn, opts) },
  },
}));

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VEHICLE_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const VIN = "JN8AZ2NE0P9300001";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: TENANT }, loading: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isAdmin: false }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ member: { role }, loading: false }),
}));

const CHECKLIST_KEYS = [
  "work_items_reviewed", "costs_verified", "manager_notes_added",
  "vendor_assignments_confirmed", "delivery_target_confirmed",
];

const seed = (opts: {
  errors?: Record<string, string>;
  invokeResults?: Record<string, { data?: unknown; error?: unknown }>;
  rpcResults?: Record<string, { data?: unknown; error?: unknown }>;
  items?: MockRow[];
  extraTables?: Record<string, MockRow[]>;
} = {}) => {
  db = createCommandDb({
    errors: opts.errors,
    invokeResults: opts.invokeResults,
    rpcResults: opts.rpcResults,
    tables: {
      vehicle_listings: [{
        id: VEHICLE_ID, tenant_id: TENANT, vin: VIN, ymm: "2025 INFINITI QX80",
        trim: null, condition: "used", mileage: 12000, hero_image_url: null,
        mc_attributes: { stock_no: "H12345" }, created_at: "2026-07-01T10:00:00Z",
        slug: null, status: "draft",
      }],
      get_ready_records: [{
        id: "gr1", tenant_id: TENANT, vin: VIN, status: "pending",
        created_at: "2026-07-01T11:00:00Z",
        items: opts.items ?? [{ id: "g1", label: "Detail — interior", category: "detail", assignedTo: "", status: "pending" }],
      }],
      // A manager who has already ticked every box: the button is live.
      document_lifecycle_events: CHECKLIST_KEYS.map((key, i) => ({
        id: `ev${i}`, tenant_id: TENANT, vehicle_id: VEHICLE_ID,
        event_type: "get_ready_authorization_checklist",
        metadata: { key, done: true }, occurred_at: `2026-07-0${i + 2}T00:00:00Z`,
      })),
      addendums: [{
        id: "ad1", tenant_id: TENANT, vehicle_vin: VIN, lifecycle_status: "live",
        created_at: "2026-07-02T00:00:00Z", getready_dispatched_at: null,
      }],
      audit_log: [],
      detail_signoffs: [],
      pdi_signoffs: [],
      get_ready_invoices: [],
      ...opts.extraTables,
    },
  });
};

const mount = async () => {
  const { useGetReadyCommand } = await import("@/hooks/useCommandCenter");
  const view = renderHook(() => useGetReadyCommand(VEHICLE_ID));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
};

beforeEach(() => { role = "manager"; seed(); });

describe("G1 — the double-dispatch guard fails closed", () => {
  it("sends nothing when the authorization markers cannot be read", async () => {
    // A statement timeout or a post-migration schema-cache 500 on audit_log.
    // createSourceReader swallows it to [], which reads exactly like "this
    // vehicle was never authorized".
    seed({ errors: { audit_log: "canceling statement due to statement timeout" } });
    const view = await mount();
    expect(view.result.current.data?.canAuthorize).toBe(true);

    const res = await view.result.current.authorizeAndDispatch();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not confirm/i);
    expect(res.error).toMatch(/nothing was sent/i);
    expect(db.invokes).toEqual([]);
    expect(db.inserts.filter((i) => i.values.event_type === "get_ready_authorized")).toEqual([]);
  });

  it("still dispatches when the markers read cleanly and say it never happened", async () => {
    seed({ invokeResults: { "notify-getready": { data: { ok: true, dispatched: [{ dept: "detail", ok: true }] } } } });
    const view = await mount();
    const res = await view.result.current.authorizeAndDispatch();
    expect(res.ok).toBe(true);
    expect(db.invokes.map((i) => i.fn)).toEqual(["notify-getready"]);
  });

  it("refuses a second dispatch when the markers say it already happened", async () => {
    seed({
      extraTables: {
        audit_log: [{
          action: "getready_dispatched", entity_type: "vehicle", entity_id: VIN,
          store_id: TENANT, created_at: "2026-07-04T09:00:00Z", details: {},
        }],
      },
    });
    const view = await mount();
    const res = await view.result.current.authorizeAndDispatch();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already authorized/i);
    expect(db.invokes).toEqual([]);
  });
});

describe("G2 — may view Get Ready, may not dispatch it", () => {
  for (const denied of ["service_manager", "service_advisor", "detail"]) {
    it(`names the real reason for ${denied}, who holds can_view_get_ready but not the dispatch role`, async () => {
      role = denied;
      const view = await mount();
      expect(view.result.current.data?.canDispatch).toBe(false);
      expect(view.result.current.data?.canAuthorize).toBe(false);
      expect(view.result.current.data?.authorizeBlockedReason).toMatch(/only a manager/i);

      const res = await view.result.current.authorizeAndDispatch();
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/only a manager/i);
      expect(db.invokes).toEqual([]);
    });
  }

  it("leaves a manager's own blocking reason alone", async () => {
    role = "used_car_manager";
    const view = await mount();
    expect(view.result.current.data?.canDispatch).toBe(true);
    expect(view.result.current.data?.canAuthorize).toBe(true);
  });
});

describe("G3 — a run that misses a recipient AND fails the stamp reports both", () => {
  it("names the unreached department and the un-stamped Ready Board", async () => {
    seed({
      invokeResults: {
        "notify-getready": { data: { ok: true, dispatched: [{ dept: "detail", ok: false }] } },
      },
      rpcResults: {
        mark_addendum_getready_dispatched: { error: { message: "accepted_at is null" } },
      },
    });
    const view = await mount();
    const res = await view.result.current.authorizeAndDispatch();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/detail/);
    expect(res.error).toMatch(/Accept & Dispatch/);
  });

  // G4: Ready Board's sendGetReady posts { tenant_id, vin } only, which
  // notify-getready defaults to ["detail"] with no vendors, so it cannot re-send
  // a single vendor work order. The remediation sentence must not send anyone
  // there for one.
  it("does not send the manager to a surface that cannot re-send a vendor", async () => {
    seed({
      items: [{ id: "g1", label: "Install: Window tint", category: "accessory", assignedTo: "", status: "pending", vendorEmail: "shop@tintpros.test" }],
      invokeResults: {
        "notify-getready": { data: { ok: true, dispatched: [{ dept: "vendor", ok: false }] } },
      },
    });
    const view = await mount();
    const res = await view.result.current.authorizeAndDispatch();
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(/send those work orders from the Ready Board/i);
    expect(res.error).toMatch(/contact them directly/i);
  });
});

describe("M6 — a failed mutation carries the driver message", () => {
  it("reports errorDetail beside the sentence the dealer reads", async () => {
    seed({ errors: { document_lifecycle_events: "permission denied for table document_lifecycle_events" } });
    const view = await mount();
    const res = await view.result.current.saveManagerNote("service", "Check the belt");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not save/i);
    expect(res.errorDetail).toMatch(/permission denied/);
  });
});

describe("M7 — a signed PDI is reported at every count, not only at zero", () => {
  it("keeps the PDI note on a service column that is partly done", async () => {
    seed({
      items: [
        { id: "s1", label: "Oil service", category: "service", assignedTo: "", status: "complete" },
        { id: "s2", label: "Brakes", category: "service", assignedTo: "", status: "pending" },
      ],
      extraTables: {
        pdi_signoffs: [{ id: "p1", tenant_id: TENANT, vin: VIN, status: "signed", result: "pass", signed_at: "2026-07-03T00:00:00Z", created_at: "2026-07-03T00:00:00Z" }],
      },
    });
    const view = await mount();
    const svc = view.result.current.data?.columns.find((c) => c.key === "service");
    expect(svc?.headline).toBe("1 of 2 Completed · PDI signed");
  });
});
