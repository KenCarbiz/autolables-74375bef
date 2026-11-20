import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildStoresReport, defaultStore, isExtendedList, parseListParams, planList,
  resolveListingStore, resolveOwners, shapeFeedRow, storeBelongs,
  type FeedMeta, type FeedStore, type ListingMeta,
} from "./autofilmFeedStores";

const TENANT = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const OTHER_TENANT = "11111111-1111-4111-8111-111111111111";
const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const HARTE = sid(1);
const mk = (n: number, name: string, over: Partial<FeedStore> = {}): FeedStore => ({
  id: sid(n), display_name: name, legal_name: `${name} LLC`, city: "Hartford", state: "CT",
  status: "active", is_primary_inventory_store: false, inventory_feed_enabled: true, ...over,
});
const STORES: FeedStore[] = [
  mk(1, "Harte INFINITI", { is_primary_inventory_store: true }),
  mk(2, "GH INFINITI"), mk(3, "GH Nissan"), mk(4, "Hyundai OS"), mk(5, "Harte Nissan"), mk(6, "VW Meriden"),
];

let vinSeq = 0;
const vin = () => `1HGCM${String(100000 + vinSeq++).padStart(6, "0")}X`.slice(0, 17).replace(/[IOQ]/g, "1");
const feedRow = (store: string, v: string, seen = "2026-11-20T10:00:00Z"): FeedMeta => ({
  id: `f-${store}-${v}`, vin: v, store_id: store, last_seen_at: seen, updated_at: seen,
});
const listing = (v: string, over: Partial<ListingMeta> = {}): ListingMeta => ({
  id: `l-${v}`, vin: v, owning_store_id: null, store_id: TENANT, updated_at: "2026-11-19T10:00:00Z", ...over,
});

describe("store resolution (contract rule 2)", () => {
  it("legacy store_id = tenant id resolves to the primary store", () => {
    expect(resolveListingStore({ store_id: TENANT }, STORES)).toBe(HARTE);
    expect(resolveListingStore({ store_id: null }, STORES)).toBe(HARTE);
    expect(resolveListingStore({ store_id: "garbage" }, STORES)).toBe(HARTE);
  });
  it("owning_store_id and a text store_id naming a real store win over the primary", () => {
    expect(resolveListingStore({ owning_store_id: sid(3), store_id: TENANT }, STORES)).toBe(sid(3));
    expect(resolveListingStore({ store_id: sid(4) }, STORES)).toBe(sid(4));
  });
  it("an owning_store_id from outside the tenant is not honoured", () => {
    expect(resolveListingStore({ owning_store_id: sid(99) }, STORES)).toBe(HARTE);
  });
  it("no primary and several stores leaves legacy rows unresolved; one store is the default", () => {
    const noPrimary = STORES.map((s) => ({ ...s, is_primary_inventory_store: false }));
    expect(defaultStore(noPrimary)).toBeNull();
    expect(resolveListingStore({ store_id: TENANT }, noPrimary)).toBeNull();
    expect(defaultStore([noPrimary[0]])?.id).toBe(HARTE);
  });
});

describe("owner resolution and duplicates (contract rule 3)", () => {
  it("a VIN in two stores' feeds is served once; primary beats the other store", () => {
    const v = vin();
    const { owned, duplicates } = resolveOwners([], [feedRow(sid(2), v, "2026-11-20T12:00:00Z"), feedRow(HARTE, v, "2026-11-01T00:00:00Z")], STORES);
    expect(owned).toHaveLength(1);
    expect(owned[0].store_id).toBe(HARTE);
    expect(duplicates).toEqual([{ vin: v, owner: { store_id: HARTE, source: "feed" }, losers: [{ store_id: sid(2), source: "feed" }] }]);
  });
  it("without a primary appearance the most recent feed wins, ties by store id", () => {
    const v = vin();
    const recent = resolveOwners([], [feedRow(sid(3), v, "2026-11-20T01:00:00Z"), feedRow(sid(4), v, "2026-11-20T02:00:00Z")], STORES);
    expect(recent.owned[0].store_id).toBe(sid(4));
    const tie = resolveOwners([], [feedRow(sid(5), v), feedRow(sid(4), v)], STORES);
    expect(tie.owned[0].store_id).toBe(sid(4));
  });
  it("a live listing's resolved store beats the primary's feed row", () => {
    const v = vin();
    const { owned, duplicates } = resolveOwners(
      [listing(v, { owning_store_id: sid(3) })], [feedRow(HARTE, v)], STORES,
    );
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({ source: "listing", store_id: sid(3) });
    expect(duplicates[0].losers).toEqual([{ store_id: HARTE, source: "feed" }]);
  });
  it("a feed row in the same store as the winning listing is the same car, not a duplicate", () => {
    const v = vin();
    const { owned, duplicates } = resolveOwners([listing(v)], [feedRow(HARTE, v)], STORES);
    expect(owned).toHaveLength(1);
    expect(owned[0].source).toBe("listing");
    expect(duplicates).toEqual([]);
  });
});

describe("planList filters", () => {
  const v1 = vin(); const v2 = vin();
  const feed = [feedRow(sid(2), v1), feedRow(sid(3), v2)];
  it("feed rows are admitted only with include_feed and only from feed-enabled stores", () => {
    const stores = STORES.map((s) => (s.id === sid(3) ? { ...s, inventory_feed_enabled: false } : s));
    expect(planList({ listings: [], feed, stores, params: { storeId: null, includeFeed: false } }).owned).toHaveLength(0);
    expect(planList({ listings: [], feed, stores, params: { storeId: null, includeFeed: true } }).owned.map((o) => o.vin)).toEqual([v1]);
  });
  it("store_id narrows to the owning store, including legacy listings on the primary", () => {
    const lv = vin();
    const p = planList({ listings: [listing(lv)], feed, stores: STORES, params: { storeId: HARTE, includeFeed: true } });
    expect(p.owned.map((o) => o.vin)).toEqual([lv]);
    const q = planList({ listings: [listing(lv)], feed, stores: STORES, params: { storeId: sid(2), includeFeed: true } });
    expect(q.owned.map((o) => o.vin)).toEqual([v1]);
  });
  it("store_id belonging check rejects another tenant's store", () => {
    expect(storeBelongs(sid(2), STORES)).toBe(true);
    expect(storeBelongs(sid(77), STORES)).toBe(false);
  });
});

describe("params", () => {
  it("absent store_id and include_feed is the legacy path", () => {
    const r = parseListParams(new URLSearchParams("tenant_id=" + TENANT));
    expect(r.ok && isExtendedList(r.value)).toBe(false);
  });
  it("store_id or include_feed turns the extended path on; bad store_id is rejected", () => {
    const a = parseListParams(new URLSearchParams("include_feed=1"));
    expect(a.ok && isExtendedList(a.value)).toBe(true);
    const b = parseListParams(new URLSearchParams(`store_id=${HARTE}`));
    expect(b.ok && isExtendedList(b.value)).toBe(true);
    expect(parseListParams(new URLSearchParams("store_id=nope")).ok).toBe(false);
  });
});

describe("feed-only rows never claim a sticker or passport", () => {
  it("carries only store_inventory facts and null artifact links", () => {
    const row = shapeFeedRow({
      id: "x", store_id: sid(2), vin: vin(), year: 2024, make: "Nissan", model: "Rogue", condition: "used",
      feed_price: 25000, feed_price_status: "unknown", photos: ["https://a/1.jpg", { url: "https://a/2.jpg" }],
      msrp: "31000.00",
    }, { id: sid(2), display_name: "GH INFINITI", city: "Hartford", state: "CT" });
    expect(row.availability_source).toBe("feed");
    expect(row.window_sticker_url).toBeNull();
    expect(row.window_sticker_kind).toBeNull();
    expect(row.passport_url).toBeNull();
    expect(row.documents_url).toBeNull();
    expect(row.detail_version).toBeNull();
    expect(row.price).toBeNull();
    expect(row.msrp).toBe(31000);
    expect(row.photos).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
    expect(row.store).toMatchObject({ id: sid(2), city: "Hartford", state: "CT" });
  });
  it("a known feed price is a price", () => {
    expect(shapeFeedRow({ id: "x", store_id: HARTE, vin: vin(), feed_price: "19999.00", feed_price_status: "known" }, null).price).toBe(19999);
  });
});

describe("location truth for legacy listings (contract rule 2)", () => {
  it("a legacy listing in exactly one sister store's present feed resolves to that sister", () => {
    const v = vin();
    const { owned, duplicates } = resolveOwners([listing(v)], [feedRow(sid(2), v)], STORES);
    expect(owned[0]).toMatchObject({ source: "listing", store_id: sid(2) });
    expect(duplicates).toEqual([]);
  });
  it("owning_store_id wins over where the feed has the car", () => {
    const v = vin();
    const { owned, duplicates } = resolveOwners([listing(v, { owning_store_id: HARTE })], [feedRow(sid(2), v)], STORES);
    expect(owned[0]).toMatchObject({ source: "listing", store_id: HARTE });
    expect(duplicates[0].losers).toEqual([{ store_id: sid(2), source: "feed" }]);
  });
  it("a retirement_review or missing row never resolves ownership and is never served", () => {
    const v = vin();
    const rr: FeedMeta = { ...feedRow(sid(2), v), presence: "retirement_review" };
    const ms: FeedMeta = { ...feedRow(sid(3), v), presence: "missing" };
    const a = resolveOwners([listing(v)], [rr, ms], STORES);
    expect(a.owned[0].store_id).toBe(HARTE);
    const b = resolveOwners([], [rr, ms], STORES);
    expect(b.owned).toHaveLength(0);
    const c = planList({ listings: [], feed: [rr], stores: STORES, params: { storeId: null, includeFeed: true } });
    expect(c.owned).toHaveLength(0);
    expect(buildStoresReport({ stores: STORES, feed: [rr, ms], listings: [] }).every((r) => r.feed_count === 0)).toBe(true);
  });
  it("present in several stores falls through to the text store_id, then the primary", () => {
    const v = vin();
    const two = [feedRow(sid(2), v), feedRow(sid(3), v)];
    expect(resolveOwners([listing(v, { store_id: sid(4) })], two, STORES).owned[0].store_id).toBe(sid(4));
    expect(resolveOwners([listing(v)], two, STORES).owned[0].store_id).toBe(HARTE);
  });
  it("ownership uses the feed even when include_feed is off, but serves no feed rows", () => {
    const v = vin(); const fo = vin();
    const p = planList({ listings: [listing(v)], feed: [feedRow(sid(2), v), feedRow(sid(2), fo)], stores: STORES, params: { storeId: sid(2), includeFeed: false } });
    expect(p.owned.map((o) => o.vin)).toEqual([v]);
  });
});

describe("fixture shaped like the live 20 Nov reconciliation", () => {
  // order: Harte INFINITI (primary), GH INFINITI, GH Nissan, Hyundai, Harte Nissan, VW
  const present = [104, 96, 202, 141, 142, 132];
  const feed: FeedMeta[] = [];
  const pv: string[][] = [];
  present.forEach((n, i) => {
    const mine: string[] = [];
    for (let k = 0; k < n; k++) { const v = vin(); mine.push(v); feed.push(feedRow(STORES[i].id, v)); }
    pv.push(mine);
  });
  // 174 retirement_review + 9 missing: never served, never ownership.
  const rrVins: string[] = [];
  for (let k = 0; k < 183; k++) {
    const v = vin(); rrVins.push(v);
    feed.push({ ...feedRow(STORES[k % 6].id, v), presence: k < 174 ? "retirement_review" : "missing" });
  }
  // 124 owned by Harte INFINITI (103 in its present feed, 21 in none), 54 legacy
  // (36 in GH INFINITI's present feed, 18 in none, 9 of those only in a sister's retirement_review).
  const listings: ListingMeta[] = [
    ...pv[0].slice(0, 103).map((v) => listing(v, { owning_store_id: HARTE })),
    ...Array.from({ length: 21 }, () => listing(vin(), { owning_store_id: HARTE })),
    ...pv[1].slice(0, 36).map((v) => listing(v)),
    ...Array.from({ length: 9 }, () => listing(vin())),
    ...rrVins.slice(0, 9).map((v) => listing(v)),
  ];
  const expectedServed = [143, 96, 202, 141, 142, 132];

  it("fixture has the live counts", () => {
    expect(feed.filter(isP).length).toBe(817);
    expect(feed.filter((f) => f.presence === "retirement_review")).toHaveLength(174);
    expect(listings).toHaveLength(178);
  });
  it("stores report: present feed_count per store, no duplicates", () => {
    const rep = buildStoresReport({ stores: STORES, feed, listings });
    present.forEach((n, i) => expect(rep.find((r) => r.id === STORES[i].id)?.feed_count).toBe(n));
    expect(rep.reduce((a, r) => a + r.feed_count, 0)).toBe(817);
    expect(rep.every((r) => r.duplicate_vins === 0)).toBe(true);
  });
  it("the 36 legacy listings land at GH INFINITI, none at Harte INFINITI", () => {
    const all = planList({ listings, feed, stores: STORES, params: { storeId: null, includeFeed: true } });
    const legacyInGh = pv[1].slice(0, 36);
    for (const v of legacyInGh) expect(all.owned.find((o) => o.vin === v)).toMatchObject({ source: "listing", store_id: sid(2) });
    const harte = all.owned.filter((o) => o.store_id === HARTE);
    expect(harte.some((o) => legacyInGh.includes(o.vin))).toBe(false);
  });
  it("served per store reconciles: 817 present + 39 listing-only = 856, Harte keeps its 104 present", () => {
    for (let i = 0; i < 6; i++) {
      const p = planList({ listings, feed, stores: STORES, params: { storeId: STORES[i].id, includeFeed: true } });
      expect(p.owned).toHaveLength(expectedServed[i]);
    }
    const all = planList({ listings, feed, stores: STORES, params: { storeId: null, includeFeed: true } });
    expect(all.owned).toHaveLength(856);
    expect(all.duplicates).toEqual([]);
    expect(all.owned.filter((o) => o.source === "listing")).toHaveLength(178);
    expect(all.owned.filter((o) => o.source === "feed")).toHaveLength(678);
    const harte = planList({ listings, feed, stores: STORES, params: { storeId: HARTE, includeFeed: true } });
    expect(pv[0].every((v) => harte.owned.some((o) => o.vin === v))).toBe(true);
    // retirement_review VINs are never served as feed rows; the 9 listing-backed ones stay with the primary.
    expect(all.owned.some((o) => o.source === "feed" && rrVins.includes(o.vin))).toBe(false);
    expect(rrVins.slice(0, 9).every((v) => all.owned.find((o) => o.vin === v)?.store_id === HARTE)).toBe(true);
  });
  it("a planted cross-store duplicate is served once, to the primary", () => {
    const stolen = pv[0][103];
    const dup = [...feed, feedRow(sid(2), stolen, "2026-11-20T23:00:00Z")];
    const all = planList({ listings, feed: dup, stores: STORES, params: { storeId: null, includeFeed: true } });
    expect(all.owned).toHaveLength(856);
    expect(all.owned.find((o) => o.vin === stolen)?.store_id).toBe(HARTE);
    expect(all.duplicates).toHaveLength(1);
    expect(buildStoresReport({ stores: STORES, feed: dup, listings }).find((r) => r.id === sid(2))?.duplicate_vins).toBe(1);
  });
});
const isP = (f: FeedMeta) => f.presence === undefined || f.presence === "present";

// ── Handler level: the real index.ts against an in-memory client ──────────────

type Row = Record<string, any>;
const DB: Record<string, Row[]> = {};
const applyOps = (table: string, ops: Array<[string, ...any[]]>, head: boolean) => {
  let rows = [...(DB[table] ?? [])];
  let lim: number | null = null; let rng: [number, number] | null = null;
  let order: { col: string; asc: boolean } | null = null;
  for (const [op, a, b] of ops) {
    if (op === "eq") rows = rows.filter((r) => r[a] === b);
    else if (op === "is") rows = rows.filter((r) => (r[a] ?? null) === b);
    else if (op === "in") rows = rows.filter((r) => (b as any[]).includes(r[a]));
    else if (op === "gt") rows = rows.filter((r) => r[a] > b);
    else if (op === "gte") rows = rows.filter((r) => r[a] >= b);
    else if (op === "order") order = { col: a, asc: b?.ascending !== false };
    else if (op === "limit") lim = a;
    else if (op === "range") rng = [a, b];
  }
  if (order) rows.sort((x, y) => (x[order!.col] < y[order!.col] ? -1 : x[order!.col] > y[order!.col] ? 1 : 0) * (order!.asc ? 1 : -1));
  const total = rows.length;
  if (rng) rows = rows.slice(rng[0], rng[1] + 1);
  if (lim !== null) rows = rows.slice(0, lim);
  return { data: head ? null : rows, error: null, count: total };
};
const fakeClient = () => ({
  from(table: string) {
    const ops: Array<[string, ...any[]]> = []; let head = false;
    const b: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (res: any) => res(applyOps(table, ops, head));
        if (prop === "select") return (_c: string, o?: any) => { head = !!o?.head; return b; };
        if (prop === "maybeSingle") return () => Promise.resolve({ ...applyOps(table, ops, false), data: applyOps(table, ops, false).data![0] ?? null });
        return (...args: any[]) => { ops.push([prop, ...args] as any); return b; };
      },
    });
    return b;
  },
});

vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({ createClient: () => fakeClient() }));
let handler: (req: Request) => Promise<Response>;
vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (h: (req: Request) => Promise<Response>) => { handler = h; },
}));

const call = async (qs: string, secret = "s3cret") => {
  const res = await handler(new Request(`https://x.test/functions/v1/autofilm-feed?${qs}`, { headers: { "x-lookup-secret": secret } }));
  return { status: res.status, body: await res.json() as any };
};

describe("autofilm-feed handler", () => {
  const LV_PRIMARY = "1HGCM00000000PRM1";
  const LV_GH = "1HGCM00000000GHN1";
  const FV_ONLY = "1HGCM00000000FEED";
  const DUP = "1HGCM00000000DUPX";
  const DUP2 = "1HGCM0000000DUP2X";

  beforeAll(async () => {
    (globalThis as any).Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", AUTOLABELS_LOOKUP_SECRET: "s3cret" } as Record<string, string>)[k] } };
    DB.dealer_stores = [
      ...STORES.slice(0, 3).map((s) => ({ ...s, tenant_id: TENANT })),
      { ...mk(50, "Elsewhere"), tenant_id: OTHER_TENANT },
    ];
    const base = { tenant_id: TENANT, archived_at: null, status: "published", mc_attributes: { year: 2024, make: "Nissan", model: "Rogue" }, photos: [], updated_at: "2026-11-19T10:00:00Z" };
    DB.vehicle_listings = [
      { ...base, id: "l1", vin: LV_PRIMARY, slug: "s1", store_id: TENANT, owning_store_id: null, price: 30000 },
      { ...base, id: "l2", vin: LV_GH, slug: "s2", store_id: TENANT, owning_store_id: sid(2), price: 28000 },
      { ...base, id: "l3", vin: DUP, slug: "s3", store_id: TENANT, owning_store_id: null, price: 27000 },
      { ...base, id: "l4", vin: DUP2, slug: "s4", store_id: TENANT, owning_store_id: sid(2), price: 26000 },
    ];
    DB.store_inventory = [
      { id: "i1", store_id: sid(3), vin: FV_ONLY, presence: "present", condition: "used", make: "Nissan", model: "Altima", year: 2023, feed_price: 20000, feed_price_status: "known", photos: ["https://a/1.jpg"], last_seen_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-20T00:00:00Z" },
      { id: "i2", store_id: sid(3), vin: DUP, presence: "present", condition: "used", make: "Nissan", model: "Rogue", year: 2024, feed_price_status: "unknown", last_seen_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-20T00:00:00Z" },
      { id: "i4", store_id: sid(3), vin: DUP2, presence: "present", condition: "used", make: "Nissan", model: "Rogue", year: 2024, feed_price_status: "unknown", last_seen_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-20T00:00:00Z" },
      { id: "i5", store_id: sid(2), vin: FV_ONLY, presence: "retirement_review", feed_price_status: "unknown", last_seen_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-20T00:00:00Z" },
      { id: "i3", store_id: sid(3), vin: "1HGCM00000000GONE", presence: "missing", feed_price_status: "unknown" },
    ];
    DB.vehicle_files = []; DB.generated_documents = []; DB.vehicle_snapshots = [];
    await import("../autofilm-feed/index");
  });

  it("rejects a bad secret", async () => {
    expect((await call(`tenant_id=${TENANT}`, "nope")).status).toBe(401);
  });

  it("without store_id/include_feed the response is the legacy shape: no new keys anywhere", async () => {
    const { status, body } = await call(`tenant_id=${TENANT}`);
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["total", "limit", "has_more", "next_cursor", "identity_incomplete", "vehicles"]);
    expect(body.total).toBe(4);
    expect(body.vehicles.map((v: Row) => v.vin)).toEqual([DUP, DUP2, LV_GH, LV_PRIMARY].sort());
    for (const v of body.vehicles) {
      expect(v).not.toHaveProperty("store");
      expect(v).not.toHaveProperty("availability_source");
    }
  });

  it("include_feed: legacy listings resolve to the primary, feed-only rows are served, duplicate served once", async () => {
    const legacy = await call(`tenant_id=${TENANT}`);
    const { status, body } = await call(`tenant_id=${TENANT}&include_feed=1`);
    expect(status).toBe(200);
    expect(body.total).toBe(5);
    expect(body.vehicles.map((v: Row) => v.vin).sort()).toEqual([DUP, DUP2, FV_ONLY, LV_GH, LV_PRIMARY].sort());
    const by = (v: string) => body.vehicles.find((r: Row) => r.vin === v);
    expect(by(LV_PRIMARY)).toMatchObject({ availability_source: "listing", store: { id: HARTE } });
    expect(by(LV_GH)).toMatchObject({ availability_source: "listing", store: { id: sid(2) } });
    expect(by(DUP)).toMatchObject({ availability_source: "listing", store: { id: sid(3) } });
    expect(by(DUP2)).toMatchObject({ availability_source: "listing", store: { id: sid(2) } });
    expect(by(FV_ONLY)).toMatchObject({ availability_source: "feed", store: { id: sid(3) }, window_sticker_url: null, passport_url: null });
    expect(body.vehicles.filter((v: Row) => v.vin === DUP2)).toHaveLength(1);
    expect(body.duplicate_count).toBe(1);
    expect(body.duplicates[0]).toMatchObject({ vin: DUP2, owner: { store_id: sid(2), source: "listing" }, losers: [{ store_id: sid(3), source: "feed" }] });
    // Listing rows are the legacy rows plus exactly the two additive keys.
    for (const lr of legacy.body.vehicles) {
      const ext = { ...by(lr.vin) }; delete ext.store; delete ext.availability_source;
      expect(ext).toEqual(lr);
    }
  });

  it("store_id of another tenant's store is a 400; non-uuid is a 400; unknown uuid is a 400", async () => {
    expect((await call(`tenant_id=${TENANT}&store_id=${sid(50)}`)).status).toBe(400);
    expect((await call(`tenant_id=${TENANT}&store_id=${sid(98)}&include_feed=1`)).status).toBe(400);
    expect((await call(`tenant_id=${TENANT}&store_id=not-a-uuid`)).status).toBe(400);
  });

  it("store_id filters to the owning store and total follows the filter", async () => {
    const gh3 = await call(`tenant_id=${TENANT}&store_id=${sid(3)}&include_feed=1`);
    expect(gh3.body.vehicles.map((v: Row) => v.vin).sort()).toEqual([DUP, FV_ONLY].sort());
    expect(gh3.body.total).toBe(2);
    const primary = await call(`tenant_id=${TENANT}&store_id=${HARTE}`);
    expect(primary.body.vehicles.map((v: Row) => v.vin)).toEqual([LV_PRIMARY]);
    expect(primary.body.vehicles.every((v: Row) => v.availability_source === "listing")).toBe(true);
  });

  it("paginates by VIN cursor in extended mode", async () => {
    const p1 = await call(`tenant_id=${TENANT}&include_feed=1&limit=2`);
    expect(p1.body.has_more).toBe(true);
    expect(p1.body.vehicles).toHaveLength(2);
    const p2 = await call(`tenant_id=${TENANT}&include_feed=1&limit=2&cursor=${p1.body.next_cursor}`);
    expect(p2.body.vehicles).toHaveLength(2);
    expect(p2.body.has_more).toBe(true);
    const p3 = await call(`tenant_id=${TENANT}&include_feed=1&limit=2&cursor=${p2.body.next_cursor}`);
    expect(p3.body.vehicles).toHaveLength(1);
    expect(p3.body.has_more).toBe(false);
  });

  it("stores mode returns the bare array per contract and is tenant scoped", async () => {
    const { status, body } = await call(`tenant_id=${TENANT}&stores=1`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
    expect(body[0]).toMatchObject({ id: HARTE, is_primary: true });
    expect(body.find((r: Row) => r.id === sid(3))).toMatchObject({ feed_count: 3, duplicate_vins: 1, inventory_feed_enabled: true });
    expect(body.find((r: Row) => r.id === sid(50))).toBeUndefined();
    expect(Object.keys(body[0]).sort()).toEqual(["city", "display_name", "duplicate_vins", "feed_count", "feed_last_seen_at", "id", "inventory_feed_enabled", "is_primary", "legal_name", "state"].sort());
  });
});
