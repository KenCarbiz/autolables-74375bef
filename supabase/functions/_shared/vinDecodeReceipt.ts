// The VIN decode receipts public-listing-view ships to the Passport. Pure and
// import-free so the anon-payload tests load this exact module.
//
// A receipt is the stored decoder answer for ONE VIN, reduced to what the
// identity check needs: the VIN the provider decoded, which provider, the
// HTTP outcome, when, the decoded year/make/model/trim and the payload hash.
// The request endpoint (it carries the masked API key) and the raw payload
// never leave the server. A snapshot whose own payload names a different VIN,
// or that failed, is dropped rather than shipped.

/** Exactly the columns read from neovin_snapshots: never the whole payload. */
export const VIN_DECODE_RECEIPT_SELECT =
  "vin, endpoint, http_status, fetched_at, payload_hash, dvin:payload->>vin, year:payload->>year, make:payload->>make, model:payload->>model, trim:payload->>trim";

export const VIN_DECODE_RECEIPT_LIMIT = 5;

export interface VinDecodeReceiptOut {
  vin: string;
  provider: "neovin" | "marketcheck";
  http_status: number;
  fetched_at: string;
  year: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  payload_hash: string | null;
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function normalizeReceiptVin(vin: unknown): string | null {
  const v = String(vin ?? "").trim().toUpperCase();
  return VIN_RE.test(v) ? v : null;
}

export function projectVinDecodeReceipts(rows: unknown, listingVin: unknown): VinDecodeReceiptOut[] {
  const vin = normalizeReceiptVin(listingVin);
  if (!vin || !Array.isArray(rows)) return [];
  const out: VinDecodeReceiptOut[] = [];
  for (const r0 of rows) {
    if (!r0 || typeof r0 !== "object") continue;
    const r = r0 as Record<string, unknown>;
    const decodedVin = normalizeReceiptVin(r.dvin);
    const status = Number(r.http_status);
    const fetchedAt = text(r.fetched_at);
    if (decodedVin !== vin || normalizeReceiptVin(r.vin) !== vin) continue;
    if (!(status >= 200 && status < 300) || !fetchedAt) continue;
    out.push({
      vin,
      provider: String(r.endpoint ?? "").includes("/neovin/") ? "neovin" : "marketcheck",
      http_status: status,
      fetched_at: fetchedAt,
      year: text(r.year), make: text(r.make), model: text(r.model), trim: text(r.trim),
      payload_hash: text(r.payload_hash),
    });
  }
  return out.slice(0, VIN_DECODE_RECEIPT_LIMIT);
}
