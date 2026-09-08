import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// createGetReady is the SECOND writer of get_ready_records; ingest
// (create_draft_get_ready) is the first and now seeds a record for every
// vehicle, new stock included. uniq_get_ready_tenant_store_vin allows exactly
// one row per (tenant, store, VIN), so an unconditional insert here failed
// against every seeded vehicle: InventoryModern reported "it may already be in
// the pipeline" and the accessories the caller asked for were dropped on the
// floor. These pin the merge.

type Row = Record<string, unknown>;

let rows: Row[] = [];
let inserts: Row[] = [];
let updates: { id: unknown; patch: Row }[] = [];
let orFilters: string[] = [];

const STORE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VIN = "JN8AZ2NE0P9300001";

function builder() {
  const state: {
    op: "select" | "insert" | "update";
    payload: Row | null;
    filters: Record<string, unknown>;
    vinIn: string[] | null;
    limit: number | null;
  } = { op: "select", payload: null, filters: {}, vinIn: null, limit: null };

  const list = (): Row[] => {
    let out = rows;
    if (state.vinIn) out = out.filter((r) => state.vinIn!.includes(String(r.vin)));
    if (state.filters.id !== undefined) out = out.filter((r) => r.id === state.filters.id);
    return state.limit ? out.slice(0, state.limit) : out;
  };

  const run = (): Row | null => {
    if (state.op === "insert") {
      const row: Row = {
        id: `rec-${rows.length + 1}`,
        items: [],
        accessories_to_install: [],
        ...(state.payload || {}),
      };
      rows = [...rows, row];
      inserts.push(state.payload || {});
      return row;
    }
    if (state.op === "update") {
      const target = rows.find((r) => r.id === state.filters.id);
      if (!target) return null;
      updates.push({ id: state.filters.id, patch: state.payload || {} });
      Object.assign(target, state.payload || {});
      return target;
    }
    return list()[0] ?? null;
  };

  const chain = {
    select: () => chain,
    or: (expr: string) => { orFilters.push(expr); return chain; },
    order: () => chain,
    limit: (n: number) => { state.limit = n; return chain; },
    in: (col: string, values: string[]) => { if (col === "vin") state.vinIn = values; return chain; },
    eq: (col: string, value: unknown) => { state.filters[col] = value; return chain; },
    insert: (payload: Row) => { state.op = "insert"; state.payload = payload; return chain; },
    update: (payload: Row) => { state.op = "update"; state.payload = payload; return chain; },
    single: async () => ({ data: run(), error: null }),
    maybeSingle: async () => ({ data: run(), error: null }),
    // deno-lint-ignore no-explicit-any
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: list(), error: null }),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => builder(),
    rpc: async () => ({ data: null, error: null }),
  },
}));

const seeded = (over: Row = {}): Row => ({
  id: "rec-seed",
  store_id: STORE,
  vin: VIN,
  stock_number: "S1234",
  ymm: "2021 Honda Accord",
  condition: "used",
  items: [
    { id: "i1", label: "CT K-208 safety inspection", category: "inspection", department: "service", status: "pending" },
    { id: "i2", label: "Interior detail", category: "detail", department: "detail", status: "pending" },
  ],
  accessories_to_install: [],
  inspection_required: true,
  inspection_form_type: "CT-K208",
  assigned_technician: "",
  service_advisor: "",
  ro_number: "",
  status: "pending",
  created_at: "2026-09-01T00:00:00.000Z",
  created_by: "ingest_autogen",
  updated_at: "2026-09-01T00:00:00.000Z",
  reconciliation_state: "current",
  ...over,
});

const call = async (result: { current: ReturnType<typeof import("./useGetReady").useGetReady> }, over: Record<string, unknown> = {}) => {
  let record: unknown = null;
  await act(async () => {
    record = await result.current.createGetReady({
      vin: VIN.toLowerCase(),
      stockNumber: "S1234",
      ymm: "2021 Honda Accord",
      condition: "used",
      acquiredDate: "2026-09-01",
      accessoriesToInstall: [{ productId: "p1", productName: "Window tint" }],
      inspectionRequired: true,
      inspectionFormType: "CT-K208",
      createdBy: "user-1",
      ...over,
    });
  });
  return record;
};

const mount = async () => {
  const { useGetReady } = await import("./useGetReady");
  const { result } = renderHook(() => useGetReady(STORE));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

beforeEach(() => { rows = []; inserts = []; updates = []; orFilters = []; });

describe("createGetReady — one record per (tenant, VIN)", () => {
  it("inserts when the vehicle has no record yet", async () => {
    const result = await mount();
    await call(result);
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(String(inserts[0].vin)).toBe(VIN);
  });

  it("adds to the ingest-seeded record instead of inserting a second one", async () => {
    rows = [seeded()];
    const result = await mount();
    const record = await call(result);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(record).not.toBeNull();
    const items = (updates[0].patch.items as { label: string }[]);
    expect(items.map((i) => i.label)).toContain("CT K-208 safety inspection");
    expect(items.map((i) => i.label)).toContain("Install: Window tint");
  });

  it("matches the record whatever spelling its VIN was stored in", async () => {
    rows = [seeded({ vin: VIN.toLowerCase() })];
    const result = await mount();
    await call(result);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
  });

  it("does not re-add a line the record already carries, or a second copy of the accessory", async () => {
    rows = [seeded()];
    const result = await mount();
    await call(result);
    await call(result);
    const items = (updates[1].patch.items as { label: string }[]);
    expect(items.filter((i) => i.label === "Install: Window tint")).toHaveLength(1);
    const accessories = (updates[1].patch.accessories_to_install as { productId: string }[]);
    expect(accessories.filter((a) => a.productId === "p1")).toHaveLength(1);
  });

  it("does not seed a second safety inspection line onto a record that has one", async () => {
    rows = [seeded()];
    const result = await mount();
    await call(result, { inspectionFormType: "CT-K208 (2026)" });
    const items = (updates[0].patch.items as { category: string }[]);
    expect(items.filter((i) => i.category === "inspection")).toHaveLength(1);
  });

  it("never downgrades what the seeded record already recorded", async () => {
    rows = [seeded({ assigned_technician: "Ana", ro_number: "RO-9" })];
    const result = await mount();
    await call(result, { assignedTechnician: "", roNumber: "" });
    expect(updates[0].patch.assigned_technician).toBe("Ana");
    expect(updates[0].patch.ro_number).toBe("RO-9");
    expect(updates[0].patch.inspection_required).toBe(true);
  });
});

describe("useGetReady load — the queue people work from", () => {
  it("asks the server for current records only, so the tracker is not 196 rows of history", async () => {
    rows = [seeded()];
    await mount();
    expect(orFilters).toContain("reconciliation_state.is.null,reconciliation_state.eq.current");
  });
});
