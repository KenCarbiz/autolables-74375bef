// Phase 2: split one vAuto CSV into per-dealer partitions and validate each on
// its own. Pure and network-free. A partition is keyed by the explicit
// DealerId column; rows of one dealer are never weighed against another's.

import { VAUTO_HEADERS, compareIdentity, parseMoney, type DealerIdentity, type FieldMatch, type Issue } from "./dryRun.ts";

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const DEALER_ID = /^[A-Za-z0-9._-]{1,64}$/;
const SAMPLE = 50;
const MAX_PHOTOS = 60;

export type PriceStatus = "known" | "unknown" | "zero";

export type StagedVehicle = {
  vin: string; row_number: number; stock_number: string | null; condition: "new" | "used" | "cpo"; certified: boolean;
  year: number | null; make: string | null; model: string | null; trim: string | null; series_detail: string | null; body: string | null;
  drivetrain: string | null; engine: string | null; transmission: string | null; fuel: string | null;
  equipment: string[]; description: string | null; mileage: number | null; msrp: number | null;
  feed_price: number | null; feed_price_status: PriceStatus;
  exterior_color: string | null; interior_color: string | null; photos: string[]; photos_modified_at: string | null; inventory_date: string | null;
};

export type PartitionCounts = {
  rows: number; valid: number; invalid: number; duplicateIdentical: number; duplicateConflicts: number;
  priceMissing: number; priceZero: number; photoMissing: number;
};

export type Partition = {
  sourceDealerId: string;
  identity: DealerIdentity;
  identityVariants: number;
  counts: PartitionCounts;
  errors: Issue[];
  warnings: Issue[];
  vehicles: StagedVehicle[];
  // Rows that failed validation; their VINs (when readable) are excluded from
  // the snapshot, so the snapshot cannot be used as evidence of absence.
  droppedRows: number;
};

export type PartitionResult =
  | { ok: true; headers: { missing: string[]; extra: string[] }; partitions: Partition[]; rowsWithoutDealer: number }
  | { ok: false; reason: string; headers: { missing: string[]; extra: string[] } };

const clean = (s: string | undefined): string | null => {
  const v = (s ?? "").trim().replace(/\s+/g, " ");
  return v === "" ? null : v.slice(0, 500);
};

const intOrNull = (s: string | undefined, max: number): number | null => {
  const v = (s ?? "").trim().replace(/,/g, "");
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n <= max ? n : null;
};

export function parseCondition(newUsed: string | undefined, certified: string | undefined): { condition: "new" | "used" | "cpo"; certified: boolean } | null {
  const nu = (newUsed ?? "").trim().toLowerCase();
  const cert = /^(y|yes|true|1|certified|cpo)$/i.test((certified ?? "").trim());
  if (nu === "n" || nu === "new") return { condition: "new", certified: false };
  if (nu === "u" || nu === "used" || nu === "pre-owned" || nu === "preowned") return { condition: cert ? "cpo" : "used", certified: cert };
  if (nu === "c" || nu === "cpo" || nu === "certified") return { condition: "cpo", certified: true };
  return null;
}

export function parsePhotoList(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(/[\s|,;]+/)) {
    if (!/^https:\/\/[^\s"'<>]{4,1000}$/i.test(part)) continue;
    if (!out.includes(part)) out.push(part);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

export function parseFeedDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (us) {
    let h = Number(us[4] ?? 0);
    if (us[7]) h = (h % 12) + (us[7].toUpperCase() === "PM" ? 12 : 0);
    const d = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]), h, Number(us[5] ?? 0), Number(us[6] ?? 0)));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function parseEquipment(raw: string | undefined): string[] {
  const items = (raw ?? "").split(/[|;]+/).map((x) => x.trim().replace(/\s+/g, " ")).filter((x) => x.length > 1 && x.length <= 200);
  return [...new Set(items)].slice(0, 300);
}

const identityKey = (i: DealerIdentity) =>
  [i.dealerName, i.address, i.city, i.postal, i.region].map((v) => v.trim().replace(/\s+/g, " ").toUpperCase()).join("\u0000");

export function partitionFeed(headers: string[], rows: string[][]): PartitionResult {
  const idx = new Map(headers.map((h, i) => [h, i] as const));
  const missing = VAUTO_HEADERS.filter((h) => !idx.has(h));
  const extra = headers.filter((h) => !(VAUTO_HEADERS as readonly string[]).includes(h));
  const hdr = { missing, extra };
  if (missing.length) return { ok: false, reason: "missing_required_headers", headers: hdr };
  if (new Set(headers).size !== headers.length) return { ok: false, reason: "duplicate_headers", headers: hdr };
  if (rows.length === 0) return { ok: false, reason: "no_rows", headers: hdr };

  const get = (r: string[], h: string) => (r[idx.get(h)!] ?? "").trim();
  type Acc = { p: Partition; identities: Map<string, number>; byVin: Map<string, { row: number; key: string; dropped: boolean }> };
  const parts = new Map<string, Acc>();
  let rowsWithoutDealer = 0;

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const dealerId = get(r, "DealerId");
    if (!dealerId || !DEALER_ID.test(dealerId)) { rowsWithoutDealer++; return; }
    const ident: DealerIdentity = {
      dealerId, dealerName: get(r, "Dealer Name"), address: get(r, "Dealer Address"), city: get(r, "Dealer City"),
      postal: get(r, "Dealer Postal Code"), region: get(r, "Dealer Region"),
    };
    let acc = parts.get(dealerId);
    if (!acc) {
      acc = {
        p: { sourceDealerId: dealerId, identity: ident, identityVariants: 0, counts: { rows: 0, valid: 0, invalid: 0, duplicateIdentical: 0, duplicateConflicts: 0, priceMissing: 0, priceZero: 0, photoMissing: 0 }, errors: [], warnings: [], vehicles: [], droppedRows: 0 },
        identities: new Map(), byVin: new Map(),
      };
      parts.set(dealerId, acc);
    }
    const p = acc.p;
    p.counts.rows++;
    const ik = identityKey(ident);
    acc.identities.set(ik, (acc.identities.get(ik) ?? 0) + 1);
    const err = (code: string, vin?: string, detail?: string) => { p.counts.invalid++; p.droppedRows++; if (p.errors.length < SAMPLE) p.errors.push({ row: rowNo, vin, code, detail }); };
    const warn = (code: string, vin?: string, detail?: string) => { if (p.warnings.length < SAMPLE) p.warnings.push({ row: rowNo, vin, code, detail }); };

    if (r.length !== headers.length) return err("column_count", undefined, `${r.length} of ${headers.length}`);
    const vin = get(r, "VIN").toUpperCase();
    if (!vin) return err("vin_missing");
    if (!VIN.test(vin)) return err("vin_malformed", vin);
    const key = r.join("\u0001");
    const prior = acc.byVin.get(vin);
    if (prior) {
      if (prior.key === key) { p.counts.duplicateIdentical++; warn("duplicate_vin_identical", vin); return; }
      p.counts.duplicateConflicts++;
      // Two different rows for one VIN: neither is trusted.
      if (!prior.dropped) {
        prior.dropped = true;
        p.vehicles = p.vehicles.filter((v) => v.vin !== vin);
        p.counts.valid--;
        p.counts.invalid++;
        p.droppedRows++;
      }
      return err("duplicate_vin_conflict", vin, `first at row ${prior.row}`);
    }
    const cond = parseCondition(get(r, "New/Used"), get(r, "Certified"));
    if (!cond) { acc.byVin.set(vin, { row: rowNo, key, dropped: true }); return err("condition_unrecognised", vin, get(r, "New/Used").slice(0, 20)); }
    const price = parseMoney(get(r, "Price"));
    const msrp = parseMoney(get(r, "MSRP"));
    if (price.kind === "invalid") { acc.byVin.set(vin, { row: rowNo, key, dropped: true }); return err("price_invalid", vin, price.raw); }
    if (msrp.kind === "invalid") { acc.byVin.set(vin, { row: rowNo, key, dropped: true }); return err("msrp_invalid", vin, msrp.raw); }
    if (price.kind === "missing") { p.counts.priceMissing++; warn("price_missing", vin); }
    if (price.kind === "zero") { p.counts.priceZero++; warn("price_zero", vin); }
    const photos = parsePhotoList(get(r, "Photo Url List"));
    if (photos.length === 0) { p.counts.photoMissing++; warn("photos_missing", vin); }
    const year = intOrNull(get(r, "Year"), 2100);
    const invDate = parseFeedDate(get(r, "Inventory Date"));
    acc.byVin.set(vin, { row: rowNo, key, dropped: false });
    p.counts.valid++;
    p.vehicles.push({
      vin, row_number: rowNo, stock_number: clean(get(r, "Stock #")), condition: cond.condition, certified: cond.certified,
      year: year !== null && year >= 1900 ? year : null, make: clean(get(r, "Make")), model: clean(get(r, "Model")), trim: clean(get(r, "Series")),
      series_detail: clean(get(r, "Series Detail")), body: clean(get(r, "Body")), drivetrain: clean(get(r, "Drivetrain Desc")),
      engine: clean(get(r, "Engine")), transmission: clean(get(r, "Transmission")), fuel: clean(get(r, "Fuel")),
      equipment: parseEquipment(get(r, "Features")), description: clean(get(r, "Description")),
      mileage: intOrNull(get(r, "Odometer"), 2_000_000),
      msrp: msrp.kind === "amount" ? msrp.value : null,
      feed_price: price.kind === "amount" ? price.value : null,
      feed_price_status: price.kind === "amount" ? "known" : price.kind === "zero" ? "zero" : "unknown",
      exterior_color: clean(get(r, "Colour")), interior_color: clean(get(r, "Interior Color")),
      photos, photos_modified_at: parseFeedDate(get(r, "Photos Last Modified Date")),
      inventory_date: invDate ? invDate.slice(0, 10) : null,
    });
  });

  const partitions = [...parts.values()].map(({ p, identities }) => {
    p.identityVariants = identities.size;
    return p;
  }).sort((a, b) => a.sourceDealerId.localeCompare(b.sourceDealerId));
  return { ok: true, headers: hdr, partitions, rowsWithoutDealer };
}

export type StoreIdentity = { id: string; display_name: string; legal_name: string | null; street: string | null; city: string | null; state: string | null; zip: string | null };
export type MappingRef = { id: string; status: "pending" | "approved"; store_id: string; group_id: string; observed_identity: unknown };

export type PartitionOutcome = "ready" | "unmapped" | "mapping_pending" | "conflict" | "rejected";

export function compareToStore(identity: DealerIdentity, store: StoreIdentity | null): { verdict: "match" | "mismatch" | "incomplete"; fields: Record<string, FieldMatch> } | null {
  if (!store) return null;
  return compareIdentity(identity, { name: store.display_name, rooftopName: store.legal_name, street: store.street, city: store.city, postal: store.zip, region: store.state });
}

const normIdentity = (o: unknown): string => {
  const i = (o ?? {}) as Partial<DealerIdentity>;
  return identityKey({ dealerId: "", dealerName: i.dealerName ?? "", address: i.address ?? "", city: i.city ?? "", postal: i.postal ?? "", region: i.region ?? "" });
};

// Decides whether one partition may be staged for its store. The binding (the
// file approved for this group) and the mapping (this DealerId approved for
// this store) must both hold, and the dealer identity in the file must still be
// the one that was approved.
export function decidePartition(p: Partition, mapping: MappingRef | null, bindingGroupId: string | null, maxInvalidRows: number): { outcome: PartitionOutcome; reasons: string[]; clean: boolean } {
  const reasons: string[] = [];
  if (p.identityVariants > 1) reasons.push("dealer_identity_varies_within_partition");
  if (!mapping) return { outcome: "unmapped", reasons: [...reasons, "no_mapping_for_dealer_id"], clean: false };
  if (bindingGroupId && mapping.group_id !== bindingGroupId) return { outcome: "conflict", reasons: [...reasons, "mapping_outside_file_group"], clean: false };
  if (mapping.status === "pending") return { outcome: "mapping_pending", reasons: [...reasons, "mapping_not_approved"], clean: false };
  if (normIdentity(mapping.observed_identity) !== identityKey(p.identity)) reasons.push("dealer_identity_changed_since_approval");
  if (reasons.length) return { outcome: "conflict", reasons, clean: false };
  if (p.counts.valid === 0) return { outcome: "rejected", reasons: ["no_valid_rows"], clean: false };
  if (p.counts.invalid > maxInvalidRows) return { outcome: "rejected", reasons: ["too_many_invalid_rows"], clean: false };
  return { outcome: "ready", reasons: [], clean: p.droppedRows === 0 };
}

export type ShrinkGuard = { held: boolean; live: number; absent: number; allowed: number };
export type InventoryDiff = { compared: boolean; additions: number; updates: number; unchanged: number; absenceCandidates: number; shrinkGuard: ShrinkGuard };

// Mirrors the absent-vs-live rule of inventory_apply_store_snapshot: a full
// snapshot is held when more of the store's live cars are missing than
// max(minAbsent - 1, pct of live). minAbsent null keeps the 0012 floor (6).
export const DEFAULT_MAX_SHRINK_PCT = 20;
export function shrinkGuard(live: number, absent: number, maxShrinkPct = DEFAULT_MAX_SHRINK_PCT, minAbsent: number | null = null): ShrinkGuard {
  const allowed = Math.max((minAbsent ?? 6) - 1, Math.ceil((live * maxShrinkPct) / 100));
  return { held: absent > allowed, live, absent, allowed };
}

export function diffAgainstStore(p: Partition, existing: Array<{ vin: string; feed_price: number | null; mileage: number | null; presence: string }> | null, maxShrinkPct = DEFAULT_MAX_SHRINK_PCT): InventoryDiff | null {
  if (!existing) return null;
  const cur = new Map(existing.filter((e) => e.presence !== "retired" && e.presence !== "transferred").map((e) => [e.vin, e] as const));
  let additions = 0, updates = 0, unchanged = 0;
  const seen = new Set<string>();
  for (const v of p.vehicles) {
    seen.add(v.vin);
    const e = cur.get(v.vin);
    if (!e) additions++;
    else if (e.feed_price !== v.feed_price || e.mileage !== v.mileage) updates++;
    else unchanged++;
  }
  const absent = [...cur.keys()].filter((v) => !seen.has(v)).length;
  const guard = shrinkGuard(cur.size, absent, maxShrinkPct);
  const absence = p.droppedRows === 0 && !guard.held ? absent : 0;
  return { compared: true, additions, updates, unchanged, absenceCandidates: absence, shrinkGuard: guard };
}
