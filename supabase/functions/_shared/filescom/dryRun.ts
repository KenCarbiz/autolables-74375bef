// Dry-run validation of one vAuto inventory CSV. Pure: it reads parsed rows
// and an existing-inventory snapshot and returns a report. It never writes.
// Vehicles absent from the file are "absence candidates" only, never sold.

export const VAUTO_HEADERS = [
  "DealerId", "Dealer Name", "VIN", "Stock #", "New/Used", "Year", "Make", "Model", "Model Number", "Body", "Transmission",
  "Series", "Body Door Ct", "Odometer", "Engine Cylinder Ct", "Engine Displacement", "Drivetrain Desc", "Colour",
  "Interior Color", "MSRP", "Price", "Inventory Date", "Certified", "Description", "Features", "Photo Url List",
  "City MPG", "Highway MPG", "Photos Last Modified Date", "Series Detail", "Engine", "Fuel", "Age", "Dealer Address",
  "Dealer City", "Dealer Postal Code", "Dealer Region",
] as const;

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const SAMPLE = 50;

export type Money = { kind: "missing" } | { kind: "zero" } | { kind: "amount"; value: number } | { kind: "invalid"; raw: string };

export function parseMoney(raw: string | undefined): Money {
  const s = (raw ?? "").trim();
  if (s === "") return { kind: "missing" };
  const cleaned = s.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { kind: "invalid", raw: s.slice(0, 40) };
  const value = Number(cleaned);
  return value === 0 ? { kind: "zero" } : { kind: "amount", value };
}

export type DealerIdentity = { dealerId: string; dealerName: string; address: string; city: string; postal: string; region: string };
export type ExistingListing = { vin: string; price: number | null };
export type Issue = { row: number; vin?: string; code: string; detail?: string };

export type DryRunReport = {
  outcome: "passed" | "rejected";
  rejectReasons: string[];
  headers: { missing: string[]; extra: string[] };
  identity: DealerIdentity | null;
  identities: number;
  counts: {
    rows: number; validRows: number; errors: number; warnings: number;
    additions: number; updates: number; unchanged: number; absenceCandidates: number | null;
    priceMissing: number; priceZero: number; duplicateIdentical: number; duplicateConflicts: number;
  };
  errors: Issue[];
  warnings: Issue[];
  additions: Array<{ vin: string; stock: string; price: number | null }>;
  updates: Array<{ vin: string; field: "price"; from: number | null; to: number | null }>;
  absenceCandidates: string[];
  comparedInventory: boolean;
};

export function runDryRun(headers: string[], rows: string[][], existing: ExistingListing[] | null): DryRunReport {
  const idx = new Map(headers.map((h, i) => [h, i] as const));
  const missing = VAUTO_HEADERS.filter((h) => !idx.has(h));
  const extra = headers.filter((h) => !(VAUTO_HEADERS as readonly string[]).includes(h));
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const rejectReasons: string[] = [];
  if (missing.length) rejectReasons.push("missing_required_headers");
  if (new Set(headers).size !== headers.length) rejectReasons.push("duplicate_headers");

  const get = (r: string[], h: string) => (idx.has(h) ? (r[idx.get(h)!] ?? "").trim() : "");
  const identities = new Map<string, DealerIdentity>();
  const byVin = new Map<string, { row: number; key: string; price: Money; stock: string }>();
  let priceMissing = 0, priceZero = 0, dupIdentical = 0, dupConflict = 0;

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    if (r.length !== headers.length) errors.push({ row: rowNo, code: "column_count", detail: `${r.length} of ${headers.length}` });
    const ident: DealerIdentity = {
      dealerId: get(r, "DealerId"), dealerName: get(r, "Dealer Name"), address: get(r, "Dealer Address"),
      city: get(r, "Dealer City"), postal: get(r, "Dealer Postal Code"), region: get(r, "Dealer Region"),
    };
    identities.set(`${ident.dealerId}\u0000${ident.dealerName}`, ident);
    const vin = get(r, "VIN").toUpperCase();
    if (!vin) return void errors.push({ row: rowNo, code: "vin_missing" });
    if (!VIN.test(vin)) return void errors.push({ row: rowNo, vin, code: "vin_malformed" });
    const price = parseMoney(get(r, "Price"));
    if (price.kind === "invalid") errors.push({ row: rowNo, vin, code: "price_invalid", detail: price.raw });
    if (price.kind === "missing") { priceMissing++; warnings.push({ row: rowNo, vin, code: "price_missing" }); }
    if (price.kind === "zero") { priceZero++; warnings.push({ row: rowNo, vin, code: "price_zero" }); }
    const msrp = parseMoney(get(r, "MSRP"));
    if (msrp.kind === "invalid") errors.push({ row: rowNo, vin, code: "msrp_invalid", detail: msrp.raw });
    const key = r.join("\u0001");
    const prior = byVin.get(vin);
    if (prior) {
      if (prior.key === key) { dupIdentical++; warnings.push({ row: rowNo, vin, code: "duplicate_vin_identical" }); }
      else { dupConflict++; errors.push({ row: rowNo, vin, code: "duplicate_vin_conflict", detail: `first at row ${prior.row}` }); }
      return;
    }
    byVin.set(vin, { row: rowNo, key, price, stock: get(r, "Stock #") });
  });

  if (identities.size > 1) rejectReasons.push("mixed_dealer_identity");
  const identity = identities.size === 1 ? [...identities.values()][0] : null;
  if (identity && (!identity.dealerId || !identity.dealerName)) rejectReasons.push("dealer_identity_missing");
  if (rows.length === 0) rejectReasons.push("no_rows");
  if (errors.length) rejectReasons.push("row_errors");

  const priceOf = (m: Money) => (m.kind === "amount" ? m.value : m.kind === "zero" ? 0 : null);
  const additions: DryRunReport["additions"] = [];
  const updates: DryRunReport["updates"] = [];
  let unchanged = 0;
  let absence: string[] = [];
  const comparedInventory = existing !== null;
  if (existing) {
    const current = new Map(existing.map((e) => [e.vin.toUpperCase(), e] as const));
    for (const [vin, v] of byVin) {
      const cur = current.get(vin);
      const next = priceOf(v.price);
      if (!cur) additions.push({ vin, stock: v.stock, price: next });
      else if (v.price.kind !== "missing" && v.price.kind !== "invalid" && cur.price !== next) updates.push({ vin, field: "price", from: cur.price, to: next });
      else unchanged++;
    }
    absence = rejectReasons.length ? [] : [...current.keys()].filter((v) => !byVin.has(v));
  }

  return {
    outcome: rejectReasons.length ? "rejected" : "passed",
    rejectReasons,
    headers: { missing, extra },
    identity,
    identities: identities.size,
    counts: {
      rows: rows.length, validRows: byVin.size, errors: errors.length, warnings: warnings.length,
      additions: additions.length, updates: updates.length, unchanged,
      absenceCandidates: comparedInventory && !rejectReasons.length ? absence.length : null,
      priceMissing, priceZero, duplicateIdentical: dupIdentical, duplicateConflicts: dupConflict,
    },
    errors: errors.slice(0, SAMPLE),
    warnings: warnings.slice(0, SAMPLE),
    additions: additions.slice(0, SAMPLE),
    updates: updates.slice(0, SAMPLE),
    absenceCandidates: absence.slice(0, SAMPLE),
    comparedInventory,
  };
}

export type TenantProfile = { name: string | null; street: string | null; city: string | null; postal: string | null; region: string | null; rooftopName: string | null };
export type FieldMatch = "match" | "mismatch" | "unknown";

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const zip5 = (s: string | null | undefined) => ((s ?? "").match(/\d{5}/)?.[0] ?? "");

export function compareIdentity(csv: DealerIdentity | null, t: TenantProfile | null) {
  const cmp = (a: string, b: string): FieldMatch => (!a || !b ? "unknown" : a === b ? "match" : "mismatch");
  const nameCmp = (): FieldMatch => {
    const a = norm(csv?.dealerName);
    const cands = [norm(t?.name), norm(t?.rooftopName)].filter(Boolean);
    if (!a || cands.length === 0) return "unknown";
    return cands.some((b) => a === b || a.includes(b) || b.includes(a)) ? "match" : "mismatch";
  };
  const fields = {
    name: nameCmp(),
    address: cmp(norm(csv?.address), norm(t?.street)),
    city: cmp(norm(csv?.city), norm(t?.city)),
    postal: cmp(zip5(csv?.postal), zip5(t?.postal)),
    region: cmp(norm(csv?.region), norm(t?.region)),
  };
  const values = Object.values(fields);
  const verdict = values.includes("mismatch") ? "mismatch" : values.every((v) => v === "match") ? "match" : "incomplete";
  return { fields, verdict } as const;
}
