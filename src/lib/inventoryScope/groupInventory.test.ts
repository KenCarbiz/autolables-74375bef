import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSupabaseSpy, spyCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { accessPayload, feedRow, feedRowsFor, resetSerial, rowsResponder, SIX_STORES, TENANT } from "@/test/fixtures/groupInventory";
import {
  GroupInventoryError, countByStore, countDisplayRows, fetchGroupAccess, loadFeedRows, mergeGroupRows, parseGroupAccess, readStoredSelection,
  resolveSelection, selectionKey, verifyAccessStores, writeStoredSelection, type FeedRow, type GroupStore, type ListingInput,
} from "./groupInventory";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});

const stores: GroupStore[] = parseGroupAccess(TENANT, accessPayload(feedRowsFor(SIX_STORES))).status === "allowed"
  ? (parseGroupAccess(TENANT, accessPayload(feedRowsFor(SIX_STORES))) as { stores: GroupStore[] }).stores
  : [];
const PRIMARY = "st-infiniti", NISSAN = "st-harte-nissan", HYUNDAI = "st-hyundai";

const listing = (id: string, vin: string, over: Partial<ListingInput> = {}): ListingInput => ({
  id, vin, ymm: "2026 INFINITI QX60", trim: "Luxe", mileage: 10, condition: "new", price: 61000, status: "published", stock_number: "I1", hero_image_url: null, ...over,
});

beforeEach(() => { resetSupabaseSpy(); resetSerial(); });

describe("mergeGroupRows", () => {
  it("keeps each rooftop's records separate and never labels a feed-only vehicle Published", () => {
    const feed = feedRowsFor(SIX_STORES);
    const rows = mergeGroupRows({ stores, selectedStoreIds: [PRIMARY, NISSAN], primaryStoreId: PRIMARY, listings: [listing("L1", "JN8AZ3CC0T9000001")], feed });
    const feedOnly = rows.filter((r) => r.source === "feed");
    expect(rows.filter((r) => r.source === "listing")).toHaveLength(1);
    expect(feedOnly.length).toBe(6 + 7);
    expect(feedOnly.every((r) => r.status === "feed_only" && r.listingId === null && r.inventoryId)).toBe(true);
    expect(rows.every((r) => r.storeId === PRIMARY || r.storeId === NISSAN)).toBe(true);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("collapses a VIN that is both the same store's feed row and its working listing, keeping the listing", () => {
    const f = feedRow(PRIMARY, 1, { vin: "JN8AZ3CC0T9000001", stock_number: "FEED1", photos: ["https://img.example/a.jpg"] });
    const rows = mergeGroupRows({ stores, selectedStoreIds: [PRIMARY], primaryStoreId: PRIMARY, listings: [listing("L1", "jn8az3cc0t9000001 ", { stock_number: null })], feed: [f] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "listing", status: "published", listingId: "L1", inventoryId: f.id, stock: "FEED1", thumbnail: "https://img.example/a.jpg" });
  });

  it("does not merge a VIN across different stores: it shows on both and both are marked for review", () => {
    const f = feedRow(NISSAN, 2, { vin: "JN8AZ3CC0T9000001" });
    const rows = mergeGroupRows({ stores, selectedStoreIds: [PRIMARY, NISSAN], primaryStoreId: PRIMARY, listings: [listing("L1", "JN8AZ3CC0T9000001")], feed: [f] });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.storeId).sort()).toEqual([NISSAN, PRIMARY]);
    expect(rows.every((r) => r.status === "review" && r.conflict)).toBe(true);
    expect(rows.find((r) => r.source === "listing")?.listing?.status).toBe("published");
  });

  it("marks a row for review when the server reports an open VIN conflict", () => {
    const rows = mergeGroupRows({ stores, selectedStoreIds: [HYUNDAI], primaryStoreId: PRIMARY, listings: [], feed: [feedRow(HYUNDAI, 1, { has_open_conflict: true })] });
    expect(rows[0].status).toBe("review");
  });

  it("does not hide a VIN claimed by an unselected store", () => {
    const rows = mergeGroupRows({ stores, selectedStoreIds: [NISSAN], primaryStoreId: PRIMARY, listings: [], feed: [feedRow(NISSAN, 1, { vin: "JN8AZ3CC0T9000001" }), feedRow(HYUNDAI, 1, { vin: "JN8AZ3CC0T9000001" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("feed_only");
  });

  it("never turns a missing price into 0", () => {
    const rows = mergeGroupRows({
      stores, selectedStoreIds: [PRIMARY, NISSAN], primaryStoreId: PRIMARY,
      listings: [listing("L1", "JN8AZ3CC0T9000001", { price: null }), listing("L2", "JN8AZ3CC0T9000002", { price: 0 })],
      feed: [
        feedRow(NISSAN, 1, { feed_price: null, feed_price_status: "unknown" }),
        feedRow(NISSAN, 2, { feed_price: 0, feed_price_status: "zero" }),
        feedRow(NISSAN, 3, { feed_price: 28500, feed_price_status: "known" }),
      ],
    });
    expect(rows.filter((r) => r.price === null)).toHaveLength(4);
    expect(rows.some((r) => r.price === 0)).toBe(false);
    expect(rows.find((r) => r.price === 28500)).toBeTruthy();
  });

  it("labels a feed row absent from the latest feed as missing_from_feed", () => {
    const rows = mergeGroupRows({ stores, selectedStoreIds: [NISSAN], primaryStoreId: PRIMARY, listings: [], feed: [feedRow(NISSAN, 1, { presence: "missing" }), feedRow(NISSAN, 2, { presence: "retirement_review" })] });
    expect(rows.map((r) => r.status)).toEqual(["missing_from_feed", "missing_from_feed"]);
  });

  it("returns nothing for a store with no feed", () => {
    expect(mergeGroupRows({ stores, selectedStoreIds: [HYUNDAI], primaryStoreId: PRIMARY, listings: [listing("L1", "JN8AZ3CC0T9000001")], feed: [] })).toEqual([]);
  });

  it("keeps two listings of one VIN in the same store as separate records", () => {
    const rows = mergeGroupRows({ stores, selectedStoreIds: [PRIMARY], primaryStoreId: PRIMARY, listings: [listing("L1", "JN8AZ3CC0T9000001"), listing("L2", "JN8AZ3CC0T9000001", { status: "draft" })], feed: [] });
    expect(rows.map((r) => r.status)).toEqual(["published", "draft"]);
  });

  it("orders rows by dealership then VIN and counts by condition and store", () => {
    const feed = feedRowsFor(SIX_STORES);
    const rows = mergeGroupRows({ stores, selectedStoreIds: SIX_STORES.map((s) => s.id), primaryStoreId: PRIMARY, listings: [listing("L1", "ZZZ")], feed });
    const counts = countDisplayRows(rows);
    expect(counts.total).toBe(1 + feed.length);
    expect(counts.new + counts.used + counts.cpo + counts.unknown).toBe(counts.total);
    expect(countByStore(rows).get(PRIMARY)).toBe(1 + 6);
    expect(rows[0].storeId).toBe(PRIMARY);
  });

  it.each([1, 2, 3, 6])("merges a selection of %i dealerships", (n) => {
    const chosen = SIX_STORES.slice(0, n).map((s) => s.id);
    const feed = feedRowsFor(SIX_STORES);
    const rows = mergeGroupRows({ stores, selectedStoreIds: chosen, primaryStoreId: PRIMARY, listings: [], feed });
    expect(new Set(rows.map((r) => r.storeId))).toEqual(new Set(chosen));
    expect(rows).toHaveLength(SIX_STORES.slice(0, n).reduce((a, s) => a + s.feed, 0));
  });

  it("handles 2,000 rows", () => {
    const big = Array.from({ length: 2000 }, (_, i) => feedRow(i % 2 ? NISSAN : HYUNDAI, i + 1));
    const t0 = Date.now();
    const rows = mergeGroupRows({ stores, selectedStoreIds: [NISSAN, HYUNDAI], primaryStoreId: PRIMARY, listings: [], feed: big });
    expect(rows).toHaveLength(2000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("selection", () => {
  it("defaults to the primary dealership only", () => {
    expect(resolveSelection(null, stores)).toEqual({ ids: [PRIMARY], primaryOnly: true });
    expect(resolveSelection([], stores)).toEqual({ ids: [PRIMARY], primaryOnly: true });
  });

  it("drops stored stores that no longer exist and falls back to primary when none remain", () => {
    expect(resolveSelection([NISSAN, "gone"], stores)).toEqual({ ids: [NISSAN], primaryOnly: false });
    expect(resolveSelection(["gone"], stores)).toEqual({ ids: [PRIMARY], primaryOnly: true });
  });

  it("persists per user and tenant", () => {
    const a = selectionKey("u1", "t1"), b = selectionKey("u2", "t1"), c = selectionKey("u1", "t2");
    writeStoredSelection(a, [PRIMARY, NISSAN]);
    expect(readStoredSelection(a)).toEqual([PRIMARY, NISSAN]);
    expect(readStoredSelection(b)).toBeNull();
    expect(readStoredSelection(c)).toBeNull();
    writeStoredSelection(a, null);
    expect(readStoredSelection(a)).toBeNull();
  });

  it("survives storage that throws or holds junk", () => {
    const key = selectionKey("u1", "t1");
    window.localStorage.setItem(key, "{not json");
    expect(readStoredSelection(key)).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ a: 1 }));
    expect(readStoredSelection(key)).toBeNull();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readStoredSelection(key)).toBeNull();
    expect(() => writeStoredSelection(key, [PRIMARY])).not.toThrow();
    get.mockRestore(); set.mockRestore();
    window.localStorage.removeItem(key);
  });
});

describe("group access", () => {
  it("parses an allowed report and a denied one", () => {
    expect(parseGroupAccess(TENANT, accessPayload([], SIX_STORES)).status).toBe("allowed");
    expect(parseGroupAccess(TENANT, accessPayload([], SIX_STORES, { allowed: false }))).toEqual({ status: "denied", reason: "not_permitted" });
  });

  it("refuses a report for another account or with a malformed store", () => {
    expect(() => parseGroupAccess("other", accessPayload([]))).toThrow(GroupInventoryError);
    const bad = accessPayload([]);
    (bad.stores[0] as { feed_present: unknown }).feed_present = null;
    expect(() => parseGroupAccess(TENANT, bad)).toThrow(/access_unverified/);
  });

  it("treats a missing function as unavailable and 42501 as denied", async () => {
    expect(await fetchGroupAccess(TENANT)).toEqual({ status: "unavailable" });
    spyResponses.rpcs.inventory_group_view_access = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    expect(await fetchGroupAccess(TENANT)).toEqual({ status: "unavailable" });
    spyResponses.rpcs.inventory_group_view_access = { data: null, error: { code: "42501", message: "not permitted" } };
    expect((await fetchGroupAccess(TENANT)).status).toBe("denied");
    spyResponses.rpcs.inventory_group_view_access = { data: null, error: { code: "57014", message: "timeout" } };
    await expect(fetchGroupAccess(TENANT)).rejects.toMatchObject({ code: "access_unverified" });
  });

  it("requires the offered stores to equal the verified registry", () => {
    const access = parseGroupAccess(TENANT, accessPayload([])) as Extract<ReturnType<typeof parseGroupAccess>, { status: "allowed" }>;
    const ids = SIX_STORES.map((s) => s.id);
    expect(() => verifyAccessStores(access, ids, PRIMARY)).not.toThrow();
    expect(() => verifyAccessStores(access, ids.slice(1), PRIMARY)).toThrow(/registry_mismatch/);
    expect(() => verifyAccessStores(access, ids, NISSAN)).toThrow(/registry_mismatch/);
  });
});

describe("loadFeedRows", () => {
  const setup = (rows: FeedRow[]) => {
    const access = parseGroupAccess(TENANT, accessPayload(rows)) as Extract<ReturnType<typeof parseGroupAccess>, { status: "allowed" }>;
    spyResponses.rpcs.inventory_group_view_rows = rowsResponder(rows);
    return access;
  };

  it("reads every page and verifies the per-store counts", async () => {
    const all = feedRowsFor(SIX_STORES);
    const access = setup(all);
    const got = await loadFeedRows(TENANT, access, [NISSAN, HYUNDAI], 5);
    expect(got).toHaveLength(7 + 7);
    const calls = spyCalls.filter((c) => c.kind === "rpc" && c.fn === "inventory_group_view_rows") as Array<{ args: { p_offset: number; p_store_ids: string[] } }>;
    expect(calls.map((c) => c.args.p_offset)).toEqual([0, 5, 10]);
    expect(calls[0].args.p_store_ids).toEqual([NISSAN, HYUNDAI]);
    expect(writeCalls()).toEqual([]);
  });

  it("reads 2,000 rows in 500-row pages", async () => {
    const stores2 = [{ id: NISSAN, name: "Harte Nissan", primary: false, feed: 0 }, { id: PRIMARY, name: "Harte INFINITI", primary: true, feed: 0 }];
    const big = Array.from({ length: 2000 }, (_, i) => feedRow(NISSAN, i + 1));
    const access = parseGroupAccess(TENANT, accessPayload(big, stores2)) as Extract<ReturnType<typeof parseGroupAccess>, { status: "allowed" }>;
    spyResponses.rpcs.inventory_group_view_rows = rowsResponder(big);
    const got = await loadFeedRows(TENANT, access, [NISSAN]);
    expect(got).toHaveLength(2000);
    expect(spyCalls.filter((c) => c.kind === "rpc" && c.fn === "inventory_group_view_rows")).toHaveLength(4);
  });

  it("refuses a store the server did not offer", async () => {
    const access = setup(feedRowsFor(SIX_STORES));
    await expect(loadFeedRows(TENANT, access, ["elsewhere"])).rejects.toMatchObject({ code: "unexpected_store" });
    await expect(loadFeedRows(TENANT, access, [])).rejects.toMatchObject({ code: "unexpected_store" });
  });

  it("fails closed when rows do not match the server's counts", async () => {
    const all = feedRowsFor(SIX_STORES);
    const access = setup(all);
    spyResponses.rpcs.inventory_group_view_rows = rowsResponder(all.filter((r) => r.id !== `${NISSAN}-inv-1`));
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "count_unverified" });
  });

  it("fails closed when the total changes while reading", async () => {
    const all = feedRowsFor(SIX_STORES);
    const access = setup(all);
    const base = rowsResponder(all);
    let n = 0;
    spyResponses.rpcs.inventory_group_view_rows = (a) => {
      const r = base(a);
      return n++ === 0 ? r : { ...r, data: { ...r.data, total: r.data.total + 1 } };
    };
    await expect(loadFeedRows(TENANT, access, [NISSAN], 3)).rejects.toMatchObject({ code: "count_unverified" });
  });

  it("fails closed on a short read, a repeated row, a foreign tenant and a foreign store", async () => {
    const all = feedRowsFor(SIX_STORES);
    const access = setup(all);
    const base = rowsResponder(all);

    spyResponses.rpcs.inventory_group_view_rows = (a) => { const r = base(a); return { ...r, data: { ...r.data, rows: [] } }; };
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "count_unverified" });

    spyResponses.rpcs.inventory_group_view_rows = (a) => { const r = base(a); return { ...r, data: { ...r.data, rows: [r.data.rows[0], ...r.data.rows.slice(0, -1)] } }; };
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "count_unverified" });

    spyResponses.rpcs.inventory_group_view_rows = (a) => { const r = base(a); return { ...r, data: { ...r.data, rows: [{ ...r.data.rows[0], tenant_id: "t2" }, ...r.data.rows.slice(1)] } }; };
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "wrong_tenant" });

    spyResponses.rpcs.inventory_group_view_rows = (a) => { const r = base(a); return { ...r, data: { ...r.data, rows: [{ ...r.data.rows[0], store_id: HYUNDAI }, ...r.data.rows.slice(1)] } }; };
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "unexpected_store" });

    spyResponses.rpcs.inventory_group_view_rows = (a) => { const r = base(a); return { ...r, data: { ...r.data, rows: [{ ...r.data.rows[0], presence: "bogus" }, ...r.data.rows.slice(1)] } }; };
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "malformed_row" });
  });

  it("maps a permission error to access_denied and other errors to rows_unreadable", async () => {
    const access = setup(feedRowsFor(SIX_STORES));
    spyResponses.rpcs.inventory_group_view_rows = { data: null, error: { code: "42501", message: "group inventory view not permitted" } };
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "access_denied" });
    spyResponses.rpcs.inventory_group_view_rows = { data: null, error: { code: "57014", message: "timeout" } };
    await expect(loadFeedRows(TENANT, access, [NISSAN])).rejects.toMatchObject({ code: "rows_unreadable" });
  });
});
