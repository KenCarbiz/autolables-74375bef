import { describe, it, expect } from "vitest";
import { DEFAULT_HUB_FILTERS } from "@/lib/admin/documentsHubModel";
import { HubReadError, loadHubPage, loadRangePage, type HubDb } from "./hubData";

interface Call { table: string; select: string; options?: { count?: string }; ops: Array<[string, unknown[]]> }

function mockDb(handler: (c: Call) => { data: unknown; count?: number | null; error?: unknown }) {
  const calls: Call[] = [];
  const db = {
    from: (table: string) => ({
      select: (select: string, options?: { count?: string }) => {
        const call: Call = { table, select, options, ops: [] };
        calls.push(call);
        const q: Record<string, unknown> = {};
        for (const op of ["eq", "in", "is", "or", "order", "ilike", "range", "limit"]) q[op] = (...args: unknown[]) => { call.ops.push([op, args]); return q; };
        q.then = (resolve: (v: unknown) => unknown) => resolve({ error: null, count: null, ...handler(call) });
        return q;
      },
    }),
  };
  return { db: db as unknown as HubDb, calls };
}

const listing = (n: number) => ({ id: `v${n}`, vin: `VIN${n}`, ymm: "Example", condition: "used", status: "published", open_recall_count: 0, vehicle_file_id: null, updated_at: null });

describe("hub data layer", () => {
  it("reads one server page with an exact count and a bounded range", async () => {
    const { db, calls } = mockDb((c) => (c.table === "vehicle_listings" ? { data: [listing(1), listing(2)], count: 130 } : { data: [] }));
    const page = await loadRangePage(db, "t1", { ...DEFAULT_HUB_FILTERS, page: 2, size: 50 });
    const l = calls.find((c) => c.table === "vehicle_listings") as Call;
    expect(l.options).toEqual({ count: "exact" });
    expect(l.ops.find(([op]) => op === "range")?.[1]).toEqual([50, 99]);
    expect(page.total).toBe(130);
    expect(page.mode).toBe("range");
    for (const c of calls.filter((x) => x.table !== "vehicle_listings" && x.table !== "vehicle_files")) expect(c.ops.some(([op]) => op === "in")).toBe(true);
  });

  it("strips PostgREST filter syntax from the search text", async () => {
    const { db, calls } = mockDb((c) => (c.table === "vehicle_listings" ? { data: [], count: 0 } : { data: [] }));
    await loadRangePage(db, "t1", { ...DEFAULT_HUB_FILTERS, q: "a,b)(%" });
    const or = calls.flatMap((c) => c.ops).find(([op]) => op === "or");
    expect(String(or?.[1][0])).not.toMatch(/[()]\s*$|,b\)/);
  });

  it("refuses to resolve a derived filter from a capped read", async () => {
    const { db } = mockDb((c) => (c.table === "vehicle_listings" ? { data: [listing(1)], count: 5000 } : { data: [], count: 0 }));
    await expect(loadHubPage(db, "t1", { ...DEFAULT_HUB_FILTERS, blocker: "missing_document" })).rejects.toBeInstanceOf(HubReadError);
  });

  it("raises a read error instead of an empty list when the query fails", async () => {
    const { db } = mockDb(() => ({ data: null, error: { message: "boom" } }));
    await expect(loadRangePage(db, "t1", DEFAULT_HUB_FILTERS)).rejects.toMatchObject({ reason: "failed" });
  });
});
