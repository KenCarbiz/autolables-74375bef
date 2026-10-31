import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { VAUTO_HEADERS } from "./dryRun";
import { decidePartition, diffAgainstStore, shrinkGuard, parseCondition, parseFeedDate, parsePhotoList, partitionFeed, type MappingRef } from "./partition";
import { processImportJob, partitionDryRun, reconcile, type Db, type Query } from "./pipeline";
import { approvalDecision, assertConnectorWrite, FILESCOM_ORIGIN } from "./policy";
import { admitProviderCall } from "../providerBudget";

const H = [...VAUTO_HEADERS];
type Rec = Partial<Record<(typeof VAUTO_HEADERS)[number], string>>;
const DEALERS: Record<string, Rec> = {
  MP15397: { DealerId: "MP15397", "Dealer Name": "Harte Nissan", "Dealer Address": "150 Weston St", "Dealer City": "Hartford", "Dealer Postal Code": "06120", "Dealer Region": "CT" },
  MP25214: { DealerId: "MP25214", "Dealer Name": "Harte Hyundai of Old Saybrook", "Dealer Address": "1 Main St", "Dealer City": "Old Saybrook", "Dealer Postal Code": "06475", "Dealer Region": "CT" },
  MP99999: { DealerId: "MP99999", "Dealer Name": "Unknown Motors", "Dealer Address": "9 Elm", "Dealer City": "Nowhere", "Dealer Postal Code": "00000", "Dealer Region": "CT" },
};
let vinSeq = 0;
const vin = () => `1N4AZ1CP0LC${String(++vinSeq).padStart(6, "0")}`;
const row = (dealer: string, over: Rec = {}): string[] => {
  const r: Rec = { ...DEALERS[dealer], VIN: vin(), "Stock #": `S${vinSeq}`, "New/Used": "U", Year: "2023", Make: "Nissan", Model: "Rogue", Series: "SV",
    Odometer: "12,345", MSRP: "", Price: "$27,995", Certified: "", "Photo Url List": "https://img.example/a.jpg|https://img.example/b.jpg", ...over };
  return H.map((h) => r[h] ?? "");
};
const csvOf = (rows: string[][]) => [H, ...rows].map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n");

describe("partitioning a feed by explicit dealer identity", () => {
  it("splits a multi-dealer file and validates each partition independently", () => {
    const rows = [row("MP15397"), row("MP15397", { VIN: "BADVIN" }), row("MP25214"), row("MP25214", { Price: "" })];
    const r = partitionFeed(H, rows);
    if (!r.ok) throw new Error(r.reason);
    expect(r.partitions.map((p) => p.sourceDealerId)).toEqual(["MP15397", "MP25214"]);
    const [a, b] = r.partitions;
    expect(a.counts).toMatchObject({ rows: 2, valid: 1, invalid: 1 });
    expect(b.counts).toMatchObject({ rows: 2, valid: 2, invalid: 0, priceMissing: 1 });
    expect(b.vehicles[1]).toMatchObject({ feed_price: null, feed_price_status: "unknown" });
    expect(a.droppedRows).toBe(1);
  });

  it("keeps blank, zero and real prices distinct and never invents $0", () => {
    const r = partitionFeed(H, [row("MP15397", { Price: "" }), row("MP15397", { Price: "0" }), row("MP15397", { Price: "31,500.00" })]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.partitions[0].vehicles.map((v) => [v.feed_price, v.feed_price_status])).toEqual([[null, "unknown"], [null, "zero"], [31500, "known"]]);
  });

  it("drops both rows of a conflicting duplicate VIN and keeps an identical duplicate once", () => {
    const v = vin();
    const same = row("MP15397", { VIN: v });
    const r = partitionFeed(H, [same, same, row("MP15397", { VIN: vin() }), row("MP15397", { VIN: vinSeq.toString().padStart(17, "1"), Price: "1" })]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.partitions[0].counts.duplicateIdentical).toBe(1);
    const w = vin();
    const c = partitionFeed(H, [row("MP15397", { VIN: w, Price: "100" }), row("MP15397", { VIN: w, Price: "200" })]);
    if (!c.ok) throw new Error(c.reason);
    expect(c.partitions[0].vehicles).toHaveLength(0);
    expect(c.partitions[0].counts.duplicateConflicts).toBe(1);
  });

  it("reads condition, certification, photos and dates", () => {
    expect(parseCondition("U", "Yes")).toEqual({ condition: "cpo", certified: true });
    expect(parseCondition("N", "Yes")).toEqual({ condition: "new", certified: false });
    expect(parseCondition("Demo", "")).toBeNull();
    expect(parsePhotoList("https://a/1.jpg|http://insecure/2.jpg, https://a/1.jpg https://a/3.jpg")).toEqual(["https://a/1.jpg", "https://a/3.jpg"]);
    expect(parseFeedDate("10/30/2026 9:05:00 PM")).toBe("2026-10-30T21:05:00.000Z");
    expect(parseFeedDate("garbage")).toBeNull();
  });

  it("rejects a file without the required headers", () => {
    expect(partitionFeed(["VIN"], [["x"]])).toMatchObject({ ok: false, reason: "missing_required_headers" });
  });
});

const ident = (d: string) => ({ dealerId: d, dealerName: DEALERS[d]["Dealer Name"]!, address: DEALERS[d]["Dealer Address"]!, city: DEALERS[d]["Dealer City"]!, postal: DEALERS[d]["Dealer Postal Code"]!, region: DEALERS[d]["Dealer Region"]! });
const mapping = (d: string, status: "approved" | "pending" = "approved", group = "g1"): MappingRef => ({ id: `m-${d}`, status, store_id: `s-${d}`, group_id: group, observed_identity: ident(d) });

describe("deciding whether a partition may be imported", () => {
  const part = () => { const r = partitionFeed(H, [row("MP15397"), row("MP15397")]); if (!r.ok) throw new Error(); return r.partitions[0]; };
  it("quarantines unmapped and pending identities", () => {
    expect(decidePartition(part(), null, "g1", 0).outcome).toBe("unmapped");
    expect(decidePartition(part(), mapping("MP15397", "pending"), "g1", 0).outcome).toBe("mapping_pending");
  });
  it("refuses a mapping into another group and an identity that changed after approval", () => {
    expect(decidePartition(part(), mapping("MP15397", "approved", "other"), "g1", 0).outcome).toBe("conflict");
    const m = { ...mapping("MP15397"), observed_identity: { ...ident("MP15397"), address: "999 Different Rd" } };
    expect(decidePartition(part(), m, "g1", 0)).toMatchObject({ outcome: "conflict", reasons: ["dealer_identity_changed_since_approval"] });
  });
  it("accepts a clean partition and marks a tolerated dirty one as not clean", () => {
    expect(decidePartition(part(), mapping("MP15397"), "g1", 0)).toMatchObject({ outcome: "ready", clean: true });
    const r = partitionFeed(H, [row("MP15397"), row("MP15397", { VIN: "nope" })]);
    if (!r.ok) throw new Error();
    expect(decidePartition(r.partitions[0], mapping("MP15397"), "g1", 0).outcome).toBe("rejected");
    expect(decidePartition(r.partitions[0], mapping("MP15397"), "g1", 1)).toMatchObject({ outcome: "ready", clean: false });
  });
  it("never counts absences from a partition that dropped rows", () => {
    const r = partitionFeed(H, [row("MP15397"), row("MP15397", { VIN: "nope" })]);
    if (!r.ok) throw new Error();
    expect(diffAgainstStore(r.partitions[0], [{ vin: "1N4AZ1CP0LZ999999", feed_price: 1, mileage: 1, presence: "present" }])?.absenceCandidates).toBe(0);
  });
  it("holds absence when a clean snapshot shrinks past the store guard", () => {
    expect(shrinkGuard(40, 25)).toEqual({ held: true, live: 40, absent: 25, allowed: 8 });
    expect(shrinkGuard(40, 6).held).toBe(false);
    expect(shrinkGuard(10, 5).held).toBe(false);
    expect(shrinkGuard(40, 25, 90).held).toBe(false);
    const r = partitionFeed(H, [row("MP15397")]);
    if (!r.ok) throw new Error();
    const stock = Array.from({ length: 40 }, (_, i) => ({ vin: `5NMJ${String(i).padStart(13, "0")}`, feed_price: 1, mileage: 1, presence: "present" }));
    const d = diffAgainstStore(r.partitions[0], stock);
    expect(d?.shrinkGuard.held).toBe(true);
    expect(d?.absenceCandidates).toBe(0);
  });
});

// ── In-memory database standing in for Supabase in the pipeline tests ──────
type Tables = Record<string, Array<Record<string, unknown>>>;
function fakeDb(seed: Tables, rpcs: Record<string, (args: Record<string, unknown>) => unknown>) {
  const tables: Tables = { ...seed };
  const writes: string[] = [];
  let id = 0;
  const from = (table: string): Query => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: unknown = null;
    let single = false;
    const q: Query = {
      select: () => q, order: () => q, limit: () => q,
      insert: (v) => { op = "insert"; payload = v; writes.push(table); return q; },
      update: (v) => { op = "update"; payload = v; writes.push(table); return q; },
      upsert: (v) => { op = "insert"; payload = v; writes.push(table); return q; },
      eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
      in: (c, v) => { filters.push((r) => v.includes(r[c])); return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res, rej) => {
        const t = (tables[table] ??= []);
        let data: unknown;
        if (op === "insert") {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `${table}-${++id}`, ...(r as object) }));
          t.push(...rows);
          data = single ? rows[0] : rows;
        } else if (op === "update") {
          const hit = t.filter((r) => filters.every((f) => f(r)));
          hit.forEach((r) => Object.assign(r, payload));
          data = hit;
        } else {
          const hit = t.filter((r) => filters.every((f) => f(r)));
          data = single ? hit[0] ?? null : hit;
        }
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return q;
  };
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => ({ data: rpcs[fn] ? rpcs[fn](args) : null, error: null }));
  return { db: { from, rpc } as Db, tables, writes, rpc };
}

function fakeFiles(body: string, mtime = "2026-10-31T13:45:06Z") {
  const bytes = new TextEncoder().encode(body);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const meta = { path: "MP_inventory.csv", type: "file", size: bytes.byteLength, mtime, sha256: sha };
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    calls.push(url);
    if (!url.startsWith(FILESCOM_ORIGIN)) throw new Error(`unexpected host ${url}`);
    if (url.includes("/file_contents/")) return new Response(bytes, { status: 200 });
    if (url.includes("/folders/")) return new Response(JSON.stringify([meta]), { status: 200 });
    return new Response(JSON.stringify(meta), { status: 200 });
  });
  return { fetchFn, calls, sha };
}

const PATH = "prod/inventory/vauto/inbound/MP_inventory.csv";
function seed(): Tables {
  return {
    inventory_feed_bindings: [{ id: "b1", provider: "filescom", path: PATH, status: "approved", tenant_id: "t1", proposed_at: "p" }],
    inventory_feed_files: [{ id: "f1", provider: "filescom", path: PATH }],
    dealer_groups: [{ id: "g1", tenant_id: "t1" }],
    inventory_source_mappings: [
      { ...mapping("MP15397"), provider: "vauto", source_dealer_id: "MP15397" },
      { ...mapping("MP25214", "pending"), provider: "vauto", source_dealer_id: "MP25214" },
    ],
    dealer_stores: [
      { id: "s-MP15397", group_id: "g1", display_name: "Harte Nissan", legal_name: null, street: "150 Weston St", city: "Hartford", state: "CT", zip: "06120", status: "active", inventory_feed_enabled: true, feed_import_paused: false, max_invalid_rows: 0 },
      { id: "s-MP25214", group_id: "g1", display_name: "Harte Hyundai of Old Saybrook", legal_name: null, street: "1 Main St", city: "Old Saybrook", state: "CT", zip: "06475", status: "active", inventory_feed_enabled: true, feed_import_paused: false, max_invalid_rows: 0 },
    ],
    store_inventory: [],
  };
}

describe("import pipeline", () => {
  const job = { id: "j1", path: PATH, lock_token: "lt", attempts: 1, max_attempts: 5 };

  it("stages and applies only the approved store partition; others are quarantined", async () => {
    const body = csvOf([row("MP15397"), row("MP15397"), row("MP25214"), row("MP99999")]);
    const files = fakeFiles(body);
    const applied: string[] = [];
    const f = fakeDb(seed(), {
      inventory_feed_claim_version: () => ({ claimed: true, version_id: "v1" }),
      inventory_apply_store_snapshot: (a) => { applied.push(String(a.p_snapshot_id)); return { applied: true, added: 2 }; },
      inventory_feed_finish_job: (a) => a.p_status,
    });
    f.tables.inventory_feed_versions = [{ id: "v1" }];
    const out = await processImportJob({ db: f.db, key: "k", fetchFn: files.fetchFn }, job);
    expect(out.status).toBe("partial");
    const parts = (out.result as { partitions: Array<{ sourceDealerId: string; status: string }> }).partitions;
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceDealerId: "MP15397", status: "applied" }),
      expect.objectContaining({ sourceDealerId: "MP25214", status: "quarantined" }),
      expect.objectContaining({ sourceDealerId: "MP99999", status: "quarantined" }),
    ]));
    expect(applied).toHaveLength(1);
    const staged = f.tables.inventory_snapshot_vehicles ?? [];
    expect(staged).toHaveLength(2);
    expect(f.tables.inventory_store_snapshots?.find((s) => s.source_dealer_id === "MP15397")).toMatchObject({ store_id: "s-MP15397", clean: true, valid_count: 2 });
    expect(f.writes.every((t) => { assertConnectorWrite(t); return true; })).toBe(true);
    expect(f.writes).not.toContain("store_inventory");
    expect(f.writes).not.toContain("vehicle_listings");
    expect(files.calls.every((u) => u.startsWith(FILESCOM_ORIGIN))).toBe(true);
  });

  it("a Files.com-only refresh makes zero MarketCheck calls and reserves no provider quota", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const body = csvOf([row("MP15397"), row("MP15397")]);
    const files = fakeFiles(body);
    const f = fakeDb(seed(), {
      inventory_feed_claim_version: () => ({ claimed: true, version_id: "v1" }),
      inventory_apply_store_snapshot: () => ({ applied: true, added: 2 }),
      inventory_feed_finish_job: (a) => a.p_status,
      inventory_feed_enqueue: () => ({ enqueued: true }),
    });
    f.tables.inventory_feed_versions = [{ id: "v1" }];
    await processImportJob({ db: f.db, key: "k", fetchFn: files.fetchFn }, job);
    await reconcile({ db: f.db, key: "k", fetchFn: files.fetchFn });
    expect(files.calls.some((u) => /marketcheck/i.test(u))).toBe(false);
    expect(globalFetch).not.toHaveBeenCalled();
    const rpcNames = f.rpc.mock.calls.map((c) => String(c[0]));
    expect(rpcNames.filter((n) => /^provider_|store_enrichment|marketcheck/.test(n))).toEqual([]);
    globalFetch.mockRestore();
  });

  it("does not process a file version that was already claimed or applied", async () => {
    const files = fakeFiles(csvOf([row("MP15397")]));
    const f = fakeDb(seed(), {
      inventory_feed_claim_version: () => ({ claimed: false, version_id: "v1", status: "applied" }),
      inventory_feed_finish_job: (a) => a.p_status,
    });
    const out = await processImportJob({ db: f.db, key: "k", fetchFn: files.fetchFn }, job);
    expect(out).toMatchObject({ status: "skipped", error: "version_applied" });
    expect(files.calls.some((u) => u.includes("/file_contents/"))).toBe(false);
    expect(f.tables.inventory_store_snapshots).toBeUndefined();
  });

  it("retries a file that changed during download and stages nothing", async () => {
    const bytes = new TextEncoder().encode(csvOf([row("MP15397")]));
    let n = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("/file_contents/")) return new Response(bytes, { status: 200 });
      n++;
      return new Response(JSON.stringify({ size: bytes.byteLength, mtime: n === 1 ? "2026-10-31T13:00:00Z" : "2026-10-31T13:00:09Z" }), { status: 200 });
    });
    const finish = vi.fn((a: Record<string, unknown>) => (a.p_retryable ? "queued" : a.p_status));
    const f = fakeDb(seed(), { inventory_feed_claim_version: () => ({ claimed: true, version_id: "v1" }), inventory_feed_finish_job: finish });
    f.tables.inventory_feed_versions = [{ id: "v1" }];
    const out = await processImportJob({ db: f.db, key: "k", fetchFn }, job);
    expect(out).toMatchObject({ status: "queued", error: "file_changed_during_download" });
    expect(f.tables.inventory_store_snapshots).toBeUndefined();
    expect(f.tables.inventory_feed_versions?.[0]).toMatchObject({ status: "failed" });
  });

  it("skips a job whose binding is no longer approved", async () => {
    const s = seed();
    s.inventory_feed_bindings[0].status = "disabled";
    const files = fakeFiles(csvOf([row("MP15397")]));
    const f = fakeDb(s, { inventory_feed_finish_job: (a) => a.p_status });
    expect(await processImportJob({ db: f.db, key: "k", fetchFn: files.fetchFn }, job)).toMatchObject({ status: "skipped", error: "binding_not_approved" });
    expect(files.calls).toHaveLength(0);
  });

  it("dry run reports every partition with identity comparison and writes no inventory", async () => {
    const files = fakeFiles(csvOf([row("MP15397"), row("MP25214", { Price: "" }), row("MP99999")]));
    const f = fakeDb(seed(), {});
    const out = await partitionDryRun({ db: f.db, key: "k", fetchFn: files.fetchFn }, PATH, "admin");
    expect(out.status).toBe("passed");
    const rep = out.report as unknown as { identities: number; partitions: Array<{ sourceDealerId: string; outcome: string; comparison: { verdict: string } | null; counts: { priceMissing: number } }>; inventoryWrites: number; providerCalls: number };
    expect(rep.identities).toBe(3);
    expect(rep.partitions.map((p) => [p.sourceDealerId, p.outcome])).toEqual([["MP15397", "ready"], ["MP25214", "mapping_pending"], ["MP99999", "unmapped"]]);
    expect(rep.partitions[0].comparison?.verdict).toBe("match");
    expect(rep.partitions[1].counts.priceMissing).toBe(1);
    expect(rep).toMatchObject({ inventoryWrites: 0, providerCalls: 0 });
    expect(f.writes.filter((t) => t !== "inventory_feed_runs" && t !== "inventory_feed_files")).toEqual([]);
  });

  it("reconciliation enqueues an approved file whose current version was never processed", async () => {
    const files = fakeFiles(csvOf([row("MP15397")]));
    const enqueue = vi.fn(() => ({ enqueued: true }));
    const f = fakeDb(seed(), { inventory_feed_enqueue: enqueue });
    expect(await reconcile({ db: f.db, key: "k", fetchFn: files.fetchFn })).toMatchObject({ checked: 1, enqueued: 1 });
    f.tables.inventory_feed_versions = [{ provider: "filescom", path: PATH, version_key: `${new TextEncoder().encode(csvOf([])).byteLength}`, status: "applied" }];
    const meta = JSON.parse(await (await files.fetchFn(`${FILESCOM_ORIGIN}/api/rest/v1/folders/`)).text())[0];
    f.tables.inventory_feed_versions = [{ provider: "filescom", path: PATH, version_key: `${meta.size}|${meta.mtime}|sha256:${meta.sha256}`, status: "applied" }];
    expect(await reconcile({ db: f.db, key: "k", fetchFn: files.fetchFn })).toMatchObject({ checked: 1, enqueued: 0 });
  });
});

describe("binding approval with a partition dry run", () => {
  const b = { id: "b1", status: "pending" as const, tenant_id: "t1", proposed_at: "p1" };
  const run = { id: "r1", status: "passed", binding_id: "b1", tenant_id: "t1", content_sha256: "h", remote_size: 1, remote_mtime: "m", report: { kind: "partition_dry_run", outcome: "passed", identities: 3, identity: null, bindingProposedAt: "p1" } };
  const file = { last_run_id: "r1", last_content_sha256: "h", remote_size: 1, remote_mtime: "m" };
  it("admits a multi-dealer file only with explicit group confirmation", () => {
    expect(approvalDecision(b, run, file, false)).toEqual({ ok: false, error: "group_membership_not_confirmed" });
    expect(approvalDecision(b, run, file, true)).toMatchObject({ ok: true, acknowledged: true });
  });
  it("still requires the dry run to match the current file and proposal", () => {
    expect(approvalDecision(b, run, { ...file, last_content_sha256: "other" }, true)).toEqual({ ok: false, error: "file_changed_since_dry_run" });
    expect(approvalDecision({ ...b, proposed_at: "p2" }, run, file, true)).toEqual({ ok: false, error: "proposal_changed_since_dry_run" });
  });
});

describe("MarketCheck store policy in the shared provider gate", () => {
  const URL = "https://api.marketcheck.com/v2/decode/car/neovin/1N4AZ1CP0LC000001/specs?api_key=K";
  const gate = (store: unknown) => {
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "provider_reserve") return { data: { reserved: true, request_id: "r1" }, error: null };
      if (fn === "store_enrichment_admit") return store instanceof Error ? { data: null, error: { message: store.message, code: "XX000" } } : { data: store, error: null };
      return { data: [{ admitted: true, event_id: 1, month_calls: 0, monthly_call_cap: 100, reason: "admitted" }], error: null };
    });
    return { rpc };
  };
  it("a feed-only store VIN is refused before the platform budget is touched", async () => {
    const admin = gate({ admitted: false, reason: "feed_only" });
    const r = await admitProviderCall(admin, { url: URL, caller: "vehicle-enrich", tenantId: "t1", vin: "1N4AZ1CP0LC000001" });
    expect(r).toMatchObject({ admitted: false, reason: "store_policy" });
    expect(admin.rpc).not.toHaveBeenCalledWith("provider_call_admit", expect.anything());
  });
  it("an approved store product proceeds to the platform budget", async () => {
    const admin = gate({ admitted: true, scope: "store" });
    expect((await admitProviderCall(admin, { url: URL, caller: "vehicle-enrich", tenantId: "t1", vin: "1N4AZ1CP0LC000001" })).admitted).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith("store_enrichment_admit", expect.objectContaining({ p_product: "neovin" }));
  });
  it("a gate error refuses the call", async () => {
    const r = await admitProviderCall(gate(new Error("boom")), { url: URL, caller: "x", tenantId: "t1", vin: "1N4AZ1CP0LC000001" });
    expect(r.admitted).toBe(false);
  });
  it("calls without a VIN (the tenant syndication feed) are not store-gated", async () => {
    const admin = gate({ admitted: false, reason: "feed_only" });
    expect((await admitProviderCall(admin, { url: URL, caller: "marketcheck-sync", tenantId: "t1", essential: true })).admitted).toBe(true);
    expect(admin.rpc).not.toHaveBeenCalledWith("store_enrichment_admit", expect.anything());
  });
});
