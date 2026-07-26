import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createCommandDb, type CommandDb, type MockRow } from "@/test/mocks/commandCenterDb";

// ──────────────────────────────────────────────────────────────────────
// B4 — authorization effects (INTAKE_SPEC S6).
//
// Authorization is ONE atomic command with visible parts: freeze the
// instruction snapshot, dispatch the work, release the eligible documents to
// the Print Center, and record a print bundle. The release must move ONLY the
// documents "approve" is legal and safe for: a draft with a printable file.
// The K-208 is never released by authorization — pre-execution it prints only
// as a working copy — and a draft with no file stays exactly where it was,
// with its blocked reason intact for the Print Center to state.
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
  useAuth: () => ({ user: { id: "user-1", email: "manager@dealer.test" }, isAdmin: false }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ member: { role }, loading: false }),
}));

const CHECKLIST_KEYS = [
  "work_items_reviewed", "costs_verified", "manager_notes_added",
  "vendor_assignments_confirmed", "delivery_target_confirmed",
];

const gdoc = (over: MockRow): MockRow => ({
  tenant_id: TENANT, vehicle_id: VEHICLE_ID, template_id: "t",
  version: 1, pdf_url: null, png_url: null, online_url: null,
  print_count: 0, printed_at: null, published_at: null,
  created_at: "2026-07-02T00:00:00Z",
  ...over,
});

const seed = (opts: { docs?: MockRow[]; errors?: Record<string, string> } = {}) => {
  db = createCommandDb({
    errors: opts.errors,
    invokeResults: {
      "notify-getready": { data: { ok: true, dispatched: [{ dept: "detail", ok: true }] } },
    },
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
        delivery_target: "2026-07-30T12:00:00Z", priority: "high",
        items: [{ id: "g1", label: "Detail — interior", category: "detail", assignedTo: "", status: "pending" }],
      }],
      document_lifecycle_events: CHECKLIST_KEYS.map((key, i) => ({
        id: `ev${i}`, tenant_id: TENANT, vehicle_id: VEHICLE_ID,
        event_type: "get_ready_authorization_checklist",
        metadata: { key, done: true }, occurred_at: `2026-07-0${i + 2}T00:00:00Z`,
      })),
      generated_documents: opts.docs ?? [
        gdoc({ id: "bg", document_type: "buyers_guide", document_status: "draft", pdf_url: "https://files.test/bg.pdf" }),
        gdoc({ id: "win", document_type: "window", document_status: "pending_approval", version: 2, pdf_url: "https://files.test/win.pdf" }),
        gdoc({ id: "add-nofile", document_type: "addendum", document_status: "draft" }),
        gdoc({ id: "k208-draft", document_type: "k208", document_status: "draft", pdf_url: "https://files.test/k208.pdf" }),
        gdoc({ id: "pass", document_type: "passport", document_status: "published", online_url: "https://dealer.test/v/x" }),
      ],
      addendums: [{
        id: "ad1", tenant_id: TENANT, vehicle_vin: VIN, lifecycle_status: "live",
        created_at: "2026-07-02T00:00:00Z", getready_dispatched_at: null,
      }],
      audit_log: [],
      detail_signoffs: [],
      pdi_signoffs: [],
      get_ready_invoices: [],
      service_requests: [],
    },
  });
};

const mount = async () => {
  const { useGetReadyCommand } = await import("@/hooks/useCommandCenter");
  const view = renderHook(() => useGetReadyCommand(VEHICLE_ID));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
};

const approvals = () =>
  db.updates
    .filter((u) => u.table === "generated_documents" && u.patch.document_status === "approved")
    .map((u) => String(u.filters.find((f) => f.column === "id")?.value ?? ""));

beforeEach(() => { role = "manager"; seed(); });

describe("B4 — authorization releases only the approvable documents", () => {
  it("approves the drafts with files, and nothing else", async () => {
    const view = await mount();
    const res = await view.result.current.authorizeAndDispatch();
    expect(res.ok).toBe(true);
    expect(approvals().sort()).toEqual(["bg", "win"]);
  });

  it("never releases the pre-execution K-208 or a draft with no file", async () => {
    const view = await mount();
    await view.result.current.authorizeAndDispatch();
    expect(approvals()).not.toContain("k208-draft");
    expect(approvals()).not.toContain("add-nofile");
    // The blocked rows are untouched: their status is exactly what it was, so
    // printBlockedReason / the bundle note still state their exact reason.
    const k208 = db.rows("generated_documents").find((d) => d.id === "k208-draft");
    const noFile = db.rows("generated_documents").find((d) => d.id === "add-nofile");
    expect(k208?.document_status).toBe("draft");
    expect(noFile?.document_status).toBe("draft");
  });

  it("writes one print_bundle_created event carrying the released ids", async () => {
    const view = await mount();
    await view.result.current.authorizeAndDispatch();
    const bundles = db.inserts.filter((i) =>
      i.table === "document_lifecycle_events" && i.values.event_type === "print_bundle_created");
    expect(bundles).toHaveLength(1);
    const meta = bundles[0].values.metadata as MockRow;
    expect((meta.document_ids as string[]).sort()).toEqual(["bg", "win"]);
    expect(meta.released).toBe(2);
    expect(meta.blocked).toBe(2);
  });

  it("reports the release in the outcome the page renders as the four lines", async () => {
    const view = await mount();
    const res = await view.result.current.authorizeAndDispatch();
    expect(res.outcome?.documents).toEqual({ released: 2, blocked: 2 });
    expect(res.outcome?.targets).toEqual([{ name: "detail", ok: true }]);
    expect(res.outcome?.failures).toEqual([]);
    // Line 1 renders these, not a hardcoded yes.
    expect(res.outcome?.recorded).toBe(true);
    expect(res.outcome?.snapshotFrozen).toBe(true);
  });

  it("aborts the freeze — never an empty snapshot — when the record read fails at dispatch time", async () => {
    const view = await mount();
    // The work-item read fails only now, after load: the authorization has
    // already gone out, so the freeze must be aborted and said so, not frozen
    // as items:[] pretending the shop was told to do nothing.
    db.errors.get_ready_records = "statement timeout";
    const res = await view.result.current.authorizeAndDispatch();
    const authorized = db.inserts.find((i) =>
      i.table === "document_lifecycle_events" && i.values.event_type === "get_ready_authorized");
    const meta = authorized?.values.metadata as MockRow;
    expect(meta.snapshot).toBeNull();
    expect(String(meta.snapshot_error)).toContain("statement timeout");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/instruction snapshot could not be recorded/i);
    expect(res.error).toMatch(/do not authorize again/i);
    // The authorization itself still stands and is reported as recorded.
    expect(res.outcome?.recorded).toBe(true);
    expect(res.outcome?.snapshotFrozen).toBe(false);
  });

  it("carries a failed authorization record into the outcome instead of claiming ok", async () => {
    const view = await mount();
    // Fail ONLY lifecycle-event inserts: reads (the pre-dispatch re-check, the
    // freeze) still work, so the run reaches the EVT_AUTHORIZED write and that
    // write alone is refused. A table-wide error would instead trip the
    // fail-closed degraded check before anything was sent.
    const realFrom = db.from.bind(db);
    (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const chain = realFrom(table) as Record<string, unknown>;
      if (table === "document_lifecycle_events") {
        chain.insert = () => ({
          then: (f: (v: { data: null; error: { message: string } }) => unknown) =>
            Promise.resolve({ data: null, error: { message: "insert denied" } }).then(f),
        });
      }
      return chain;
    };
    const res = await view.result.current.authorizeAndDispatch();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be recorded/i);
    expect(res.outcome?.recorded).toBe(false);
    expect(res.outcome?.snapshotFrozen).toBe(false);
  });

  it("freezes items, notes, and checklist into the EVT_AUTHORIZED metadata", async () => {
    const view = await mount();
    await view.result.current.saveManagerNote("service", "Check the belt");
    await waitFor(() => expect(
      view.result.current.data?.columns.find((c) => c.key === "service")?.managerNote,
    ).toBe("Check the belt"));
    await view.result.current.authorizeAndDispatch();
    const authorized = db.inserts.find((i) =>
      i.table === "document_lifecycle_events" && i.values.event_type === "get_ready_authorized");
    const meta = authorized?.values.metadata as MockRow;
    const snapshot = meta.snapshot as MockRow;
    expect((snapshot.items as MockRow[]).map((i) => i.id)).toEqual(["g1"]);
    expect((snapshot.notes as MockRow).service).toBe("Check the belt");
    expect((snapshot.checklist as MockRow[]).every((c) => c.done === true)).toBe(true);
    expect(snapshot.delivery_target).toBe("2026-07-30T12:00:00Z");
    expect(snapshot.priority).toBe("high");
    expect(meta.authorized_by_email).toBe("manager@dealer.test");
  });

  it("a release failure does not reverse or hide the authorization", async () => {
    seed({ errors: { generated_documents: "" } });
    // generated_documents readable at load time, failing only at release time is
    // hard to stage table-wide; instead make every transition fail by seeding
    // docs whose status moves under the release's compare-and-set.
    seed({
      docs: [gdoc({ id: "bg", document_type: "buyers_guide", document_status: "draft", pdf_url: "https://files.test/bg.pdf" })],
    });
    const view = await mount();
    // Another tab approves the draft between the dispatch and the release read:
    // the compare-and-set finds pending work gone and releases nothing.
    db.rows("generated_documents")[0].document_status = "archived";
    const res = await view.result.current.authorizeAndDispatch();
    // The authorization itself is recorded exactly once either way.
    const authorized = db.inserts.filter((i) =>
      i.table === "document_lifecycle_events" && i.values.event_type === "get_ready_authorized");
    expect(authorized).toHaveLength(1);
    expect(res.outcome?.documents.released).toBe(0);
  });
});

describe("B4 — delivery target and priority are loaded and editable", () => {
  it("loads the real columns instead of the deliberate nulls", async () => {
    const view = await mount();
    expect(view.result.current.data?.deliveryTarget).toBe("2026-07-30T12:00:00Z");
    expect(view.result.current.data?.priority).toBe("high");
  });

  it("writes the delivery target to get_ready_records", async () => {
    const view = await mount();
    const res = await view.result.current.setDeliveryTarget("2026-08-01T12:00:00.000Z");
    expect(res.ok).toBe(true);
    const upd = db.updates.find((u) => u.table === "get_ready_records" && "delivery_target" in u.patch);
    expect(upd?.patch.delivery_target).toBe("2026-08-01T12:00:00.000Z");
    expect(upd?.filters.some((f) => f.column === "tenant_id" && f.value === TENANT)).toBe(true);
  });

  it("writes the priority and refuses a value outside the CHECK", async () => {
    const view = await mount();
    expect((await view.result.current.setPriority("low")).ok).toBe(true);
    const upd = db.updates.find((u) => u.table === "get_ready_records" && "priority" in u.patch);
    expect(upd?.patch.priority).toBe("low");
    const bad = await view.result.current.setPriority("urgent" as never);
    expect(bad.ok).toBe(false);
  });

  it("refuses both edits for a role without dispatch authority", async () => {
    role = "service_advisor";
    const view = await mount();
    expect((await view.result.current.setDeliveryTarget(null)).ok).toBe(false);
    expect((await view.result.current.setPriority("high")).ok).toBe(false);
    expect(db.updates.filter((u) => u.table === "get_ready_records")).toEqual([]);
  });
});
