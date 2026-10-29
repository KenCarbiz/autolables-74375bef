// The order in which one crawler observation is made durable, and the only
// way derived prices reach a listing:
//
//   1. evidence: the screenshot is from the same render the price was read
//      from, or from a second render that independently shows the same
//      vehicle, address, figure and label; otherwise it is not evidence;
//   2. the observation row (raw figure, fee basis record, identity, evidence)
//      is stored, idempotently by a key over what was observed;
//   3. only then, and only when the fee basis is page-verified and the evidence
//      was accepted, are the derived values written to the listing, with a
//      guarded update that changes nothing if the listing moved meanwhile.
//
// Any failure leaves the listing as it was and names the outcome.

import type { VehiclePriceResult } from "./vdpPrice.ts";

export type EvidenceStatus = "same_render" | "revalidated_render" | "not_captured" | "rejected";

export interface EvidenceDecision {
  status: EvidenceStatus;
  reason: string | null;
}

const pathOf = (u: string | null | undefined): string | null => {
  try { return u ? new URL(u).pathname.replace(/\/+$/, "").toLowerCase() : null; } catch { return null; }
};

// A screenshot taken on a separate load is evidence for the observation only
// when that load shows the same vehicle at the same address with the same
// figure and label.
export function revalidateEvidence(first: VehiclePriceResult, firstFinalUrl: string | null, second: VehiclePriceResult | null, secondFinalUrl: string | null): EvidenceDecision {
  if (!second) return { status: "rejected", reason: "the evidence render returned no page to check" };
  if (second.identity.verdict !== "vehicle") return { status: "rejected", reason: `evidence page identity: ${second.identity.reason}` };
  const a = pathOf(firstFinalUrl), b = pathOf(secondFinalUrl);
  if (a && b && a !== b) return { status: "rejected", reason: `evidence page address ${b} differs from ${a}` };
  if (second.price == null) return { status: "rejected", reason: `no price on the evidence page (${second.reason})` };
  if (first.price == null || Math.abs(second.price - first.price) > 0.5) return { status: "rejected", reason: `evidence page shows ${second.price}, observation ${first.price}` };
  if ((second.matched_label ?? "") !== (first.matched_label ?? "")) return { status: "rejected", reason: `evidence page label "${second.matched_label}" differs from "${first.matched_label}"` };
  return { status: "revalidated_render", reason: null };
}

export async function sha256OfText(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The same page state observed twice is one observation: tenant, VIN, address,
// figure, label, the fee basis outcome and the evidence bytes.
export function observationKey(p: {
  tenantId: string; vin: string; url: string; amount: number; label: string | null;
  basisStatus: string; derived: unknown; screenshotSha256: string | null; pageSha256: string;
}): Promise<string> {
  return sha256OfText(JSON.stringify([p.tenantId, p.vin.toUpperCase(), p.url, p.amount, p.label ?? "", p.basisStatus, p.derived ?? null, p.screenshotSha256 ?? "", p.pageSha256]));
}

export type ListingPromotion =
  | "pending" | "promoted" | "not_required" | "promotion_failed" | "promotion_conflict"
  | "held_fee_basis" | "held_evidence" | "held_schema";

export type CommitOutcome =
  | "promoted"            // listing pricing fields now match the verified observation
  | "unchanged"           // verified, and the listing already matched
  | "held_fee_basis"      // observation stored; fee basis not page-verified; listing untouched
  | "held_evidence"       // observation stored; no acceptable evidence; listing untouched
  | "held_schema"         // stored without the structured record (columns absent); listing untouched
  | "duplicate"           // this exact observation was already stored and settled
  | "observation_failed"  // nothing stored; listing untouched
  | "promotion_failed"    // observation stored; the listing write failed; listing untouched
  | "promotion_conflict"; // observation stored; the listing changed meanwhile; listing untouched

export interface ListingPricing {
  id: string;
  advertised_price_before_doc: number | null;
  doc_fee: number | null;
  website_sale_price: number | null;
}

export interface CommitDb {
  /** Inserts; on a duplicate key returns the existing row's id and promotion. */
  insertObservation(row: Record<string, unknown>): Promise<
    | { kind: "inserted"; id: string }
    | { kind: "duplicate"; id: string; promotion: string | null }
    | { kind: "schema_missing" }
    | { kind: "error"; message: string }
  >;
  /** Inserts the observation without the structured columns (older schema). */
  insertLegacyObservation(row: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  readListingPricing(tenantId: string, vin: string): Promise<ListingPricing | null | { error: string }>;
  /** Updates only when the pricing fields still equal `expected`; returns rows changed. */
  updateListingIfUnchanged(expected: ListingPricing, patch: Record<string, unknown>): Promise<{ changed: number; error?: string }>;
  markObservation(id: string, promotion: ListingPromotion, detail: string | null): Promise<void>;
}

export interface CommitInput {
  tenantId: string;
  vin: string;
  key: string;
  /** The advertised_prices row, including observation and evidence fields. */
  row: Record<string, unknown>;
  /** The same row without observation, idempotency_key and listing_promotion. */
  legacyRow: Record<string, unknown>;
  promote: boolean;
  holdAs: "held_fee_basis" | "held_evidence" | null;
  holdDetail: string | null;
  /** Listing fields to write when promoting (derived values and provenance). */
  patch: Record<string, unknown>;
}

const PRICE_FIELDS = ["advertised_price_before_doc", "doc_fee", "website_sale_price"] as const;
const same = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005);

export async function commitObservation(db: CommitDb, c: CommitInput): Promise<{ outcome: CommitOutcome; observationId: string | null; detail: string | null }> {
  const initial: ListingPromotion = c.promote ? "pending" : (c.holdAs ?? "held_fee_basis");
  const ins = await db.insertObservation({ ...c.row, idempotency_key: c.key, listing_promotion: initial });
  if (ins.kind === "schema_missing") {
    const legacy = await db.insertLegacyObservation(c.legacyRow);
    return legacy.ok
      ? { outcome: "held_schema", observationId: null, detail: "stored without the fee basis record; listing not updated until the schema is migrated" }
      : { outcome: "observation_failed", observationId: null, detail: legacy.message ?? "insert failed" };
  }
  if (ins.kind === "error") return { outcome: "observation_failed", observationId: null, detail: ins.message };
  const id = ins.id;
  if (ins.kind === "duplicate" && ins.promotion && !["pending", "promotion_failed", "promotion_conflict"].includes(ins.promotion)) {
    return { outcome: "duplicate", observationId: id, detail: `already stored (${ins.promotion})` };
  }
  if (!c.promote) return { outcome: c.holdAs ?? "held_fee_basis", observationId: id, detail: c.holdDetail };

  const current = await db.readListingPricing(c.tenantId, c.vin);
  if (current == null || "error" in current) {
    const detail = current == null ? "no listing for this VIN" : current.error;
    await db.markObservation(id, "promotion_failed", detail).catch(() => undefined);
    return { outcome: "promotion_failed", observationId: id, detail };
  }
  if (PRICE_FIELDS.every((f) => same(current[f], c.patch[f]))) {
    await db.markObservation(id, "not_required", null).catch(() => undefined);
    return { outcome: "unchanged", observationId: id, detail: null };
  }
  const upd = await db.updateListingIfUnchanged(current, c.patch);
  if (upd.error) {
    await db.markObservation(id, "promotion_failed", upd.error).catch(() => undefined);
    return { outcome: "promotion_failed", observationId: id, detail: upd.error };
  }
  if (upd.changed === 0) {
    await db.markObservation(id, "promotion_conflict", "the listing's pricing changed between read and write").catch(() => undefined);
    return { outcome: "promotion_conflict", observationId: id, detail: "the listing's pricing changed between read and write" };
  }
  await db.markObservation(id, "promoted", null).catch(() => undefined);
  return { outcome: "promoted", observationId: id, detail: null };
}

// The CommitDb over a supabase-js client. Kept here so the crawler and the
// isolated tests use one implementation.
// deno-lint-ignore no-explicit-any
export function supabaseCommitDb(admin: any): CommitDb {
  const missing = (m: string) => /idempotency_key|listing_promotion|observation\b|column .* does not exist|schema cache/i.test(m);
  return {
    async insertObservation(row) {
      const { data, error } = await admin.from("advertised_prices").insert(row).select("id").maybeSingle();
      if (!error && data?.id) return { kind: "inserted", id: String(data.id) };
      const msg = String(error?.message ?? "insert returned no row");
      if (error?.code === "23505" || /duplicate key/i.test(msg)) {
        const { data: ex } = await admin.from("advertised_prices").select("id, listing_promotion")
          .eq("tenant_id", row.tenant_id).eq("idempotency_key", row.idempotency_key).maybeSingle();
        if (ex?.id) return { kind: "duplicate", id: String(ex.id), promotion: ex.listing_promotion ?? null };
      }
      if (missing(msg)) return { kind: "schema_missing" };
      return { kind: "error", message: msg };
    },
    async insertLegacyObservation(row) {
      let { error } = await admin.from("advertised_prices").insert(row);
      if (error && /screenshot_(url|sha256|bucket)|captured_method/i.test(error.message || "")) {
        const { screenshot_url: _u, screenshot_sha256: _s, screenshot_bucket: _b, captured_method: _m, ...rest } = row;
        ({ error } = await admin.from("advertised_prices").insert(rest));
      }
      return error ? { ok: false, message: error.message } : { ok: true };
    },
    async readListingPricing(tenantId, vin) {
      const { data, error } = await admin.from("vehicle_listings")
        .select("id, advertised_price_before_doc, doc_fee, website_sale_price")
        .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
      if (error) return { error: error.message };
      return data ? { id: String(data.id), advertised_price_before_doc: data.advertised_price_before_doc, doc_fee: data.doc_fee, website_sale_price: data.website_sale_price } : null;
    },
    async updateListingIfUnchanged(expected, patch) {
      let q = admin.from("vehicle_listings").update(patch).eq("id", expected.id);
      for (const f of PRICE_FIELDS) q = expected[f] == null ? q.is(f, null) : q.eq(f, expected[f]);
      const { data, error } = await q.select("id");
      return error ? { changed: 0, error: error.message } : { changed: (data ?? []).length };
    },
    async markObservation(id, promotion, detail) {
      await admin.from("advertised_prices").update({ listing_promotion: promotion, listing_promotion_detail: detail }).eq("id", id);
    },
  };
}
