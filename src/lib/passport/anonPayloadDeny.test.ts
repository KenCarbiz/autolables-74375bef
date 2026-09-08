import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The REAL shared module, not a copy. It has no imports, so it loads under
// vitest unchanged and a rename in the denylist fails here rather than
// silently re-opening the hole.
import {
  LOT_FEED_DENY, PUBLIC_VIEW_DENY,
} from "../../../supabase/functions/_shared/lotFeedRow.ts";

// public-listing-view answers /v/:slug for anyone on the internet, and its RPC
// is `SELECT * FROM vehicle_listings`. It used to delete about fifteen fields
// it happened to think of. install_token was not one of them.
//
// install_token is not merchandising data. It is the sole credential for the
// `install_proofs_upload` storage policy (bucket install-proofs, granted to
// anon, WITH CHECK on the first path segment matching ANY listing's token) and
// for record_install_proof(), a SECURITY DEFINER function with EXECUTE granted
// to anon that trusts the token alone. install_proofs.is_verified is a
// generated column — photo + signature present — and public-listing-view reads
// verified rows back onto the passport as installed equipment.
//
// So a scraper who loaded one public passport could post forged, photographed
// "verified" installation evidence against that real vehicle. At the time of
// the fix all 284 published/archived listings carried a live token, and every
// one of them shipped it.

const ROOT = join(__dirname, "..", "..", "..");
const view = readFileSync(join(ROOT, "supabase/functions/public-listing-view/index.ts"), "utf8");

/** A row shaped like what the RPC hands back — every denied column present. */
const rawRow = (): Record<string, unknown> => ({
  id: "listing-uuid", tenant_id: "tenant-uuid", store_id: "store-1",
  vin: "1HGCM82633A004352", slug: "1HGCM82633A004352", ymm: "2019 Acura TLX",
  trim: "Technology", price: 24995, mileage: 41200, condition: "used",
  // The credential.
  install_token: "0f0e5b64-4c3a-4a2f-9a5e-1a2b3c4d5e6f",
  // Internal actors and operational notes.
  created_by: "staff-uuid", assigned_agent_id: "agent-7",
  recall_override_by: "manager-uuid", recall_override_at: "2026-05-01T00:00:00Z",
  recall_override_notes: "GM said ship it, campaign is parts-only",
  price_parse_notes: "selector .vdp-price missed; fell back to og:price",
  // The raw provider dump, incl. the competitor-facing `dealer` block.
  mc_raw: { dealer: { name: "Some Other Store" }, build: {} },
  // Everything the locked passport renders.
  photos: [], hero_image_url: "https://x/1.jpg", documents: [], videos: [],
  description: "One owner", features: {}, key_specs: {}, mc_attributes: {},
  recall_payload: {}, recall_status: "clear", warranty_info: {},
  service_records: [], available_accessories: [], epa_economy: {},
  history_payload: {}, market_meta: {}, market_payload: {}, comparables: [],
  blackbook: {}, group_similar: [], value_history: [],
  doc_fee: 599, advertised_price_before_doc: 24396, website_sale_price: 24995,
  dealer_discount: 1500, retail_cash: 0, dealer_snapshot: {},
  packet_modules: {}, value_props: [],
});

/** Exactly the sweep public-listing-view runs, pinned by the source assertion
 *  in "the sweep is wired into the function" below. */
const shipToShopper = (row: Record<string, unknown>) => {
  for (const k of PUBLIC_VIEW_DENY) delete row[k];
  return row;
};

describe("the credential never reaches an anonymous shopper", () => {
  it("denies install_token", () => {
    expect(PUBLIC_VIEW_DENY.has("install_token")).toBe(true);
    expect(shipToShopper(rawRow()).install_token).toBeUndefined();
  });

  it("denies every internal field on the shared list", () => {
    const shipped = shipToShopper(rawRow());
    for (const k of [
      "install_token", "created_by", "assigned_agent_id",
      "recall_override_by", "recall_override_at", "recall_override_notes",
      "price_parse_notes", "mc_raw",
    ]) {
      expect(shipped[k], `${k} leaked to anon`).toBeUndefined();
    }
  });

  it("leaves no denied key anywhere in the serialized response", () => {
    // Serialized, because a field surviving as an undefined property is not a
    // leak but a field nested under a key we forgot to check would be.
    const body = JSON.stringify({ listing: shipToShopper(rawRow()) });
    for (const k of PUBLIC_VIEW_DENY) {
      expect(body, `${k} leaked to anon`).not.toContain(`"${k}"`);
    }
  });

  it("withholds exactly what it means to, and nothing more", () => {
    // Asserted against the real exported Set, so widening or narrowing what an
    // anonymous caller sees is a deliberate act somebody has to change here.
    expect([...PUBLIC_VIEW_DENY].sort()).toEqual([
      "assigned_agent_id", "created_by", "install_token", "mc_raw",
      "price_parse_notes", "recall_override_at", "recall_override_by",
      "recall_override_notes",
    ].sort());
  });
});

describe("one denylist, not two", () => {
  it("derives the public denylist from the feed denylist", () => {
    // A field added to LOT_FEED_DENY is denied to the shopper too, with no
    // second list to remember. That is the whole reason install_token — which
    // has been on the feed list since it was written — was still shipping.
    for (const k of PUBLIC_VIEW_DENY) {
      expect(LOT_FEED_DENY.has(k), `${k} is not on the shared list`).toBe(true);
    }
    expect(view).toMatch(/import \{ PUBLIC_VIEW_DENY \} from "\.\.\/_shared\/lotFeedRow\.ts";/);
  });

  it("the sweep is wired into the function, over the whole row", () => {
    expect(view).toMatch(/for \(const k of PUBLIC_VIEW_DENY\) delete \(row as Record<string, unknown>\)\[k\];/);
    // Not a hand-listed delete standing in for the sweep.
    expect(view).not.toMatch(/delete \(row as Record<string, unknown>\)\.mc_raw;/);
  });

  it("runs last, after curation and sanitation have finished shaping the row", () => {
    const sweep = view.indexOf("for (const k of PUBLIC_VIEW_DENY)");
    const ret = view.indexOf("return json(200, { listing: row });");
    expect(sweep).toBeGreaterThan(view.indexOf("Packet curation enforcement"));
    expect(sweep).toBeGreaterThan(view.indexOf("Anonymous payload whitelist"));
    expect(sweep).toBeLessThan(ret);
    // Nothing writes to the row between the sweep and the response.
    expect(view.slice(sweep, ret)).not.toMatch(/\brow\.\w+ =/);
  });
});

describe("the locked passport still gets everything it renders", () => {
  it("keeps the market modules, which are sanitized rather than denied", () => {
    // blackbook, market_payload and comparables ARE on the feed denylist —
    // redistributing a paid valuation feed to a sister app is a licensing
    // question. They are not secrets, and Market Intelligence / Market
    // Comparison are part of the owner-approved /v/:slug spec, so the shopper
    // gets the shopper-safe projections public-listing-view already builds.
    for (const k of ["blackbook", "market_payload", "comparables"]) {
      expect(LOT_FEED_DENY.has(k)).toBe(true);
      expect(PUBLIC_VIEW_DENY.has(k), `${k} would blank a locked module`).toBe(false);
    }
    const shipped = shipToShopper(rawRow());
    expect(shipped.blackbook).toBeDefined();
    expect(shipped.market_payload).toBeDefined();
    expect(shipped.comparables).toBeDefined();
  });

  it("still strips competitor identity and wholesale numbers from them", () => {
    // The sanitation the exemption depends on. If these projections go, the
    // exemption is no longer safe.
    expect(view).toMatch(/row\.blackbook = \{ available: bb\.available === true, retail:/);
    expect(view).not.toMatch(/wholesale: bb\./);
    expect(view).toMatch(/delete mm\.cheaper_count;/);
    expect(view).toMatch(/row\.market_payload = \{/);
  });

  it("keeps every field the passport reads off the listing", () => {
    const shipped = shipToShopper(rawRow());
    for (const k of [
      "id", "tenant_id", "store_id", "vin", "slug", "ymm", "trim", "price",
      "mileage", "condition", "photos", "hero_image_url", "documents", "videos",
      "description", "features", "key_specs", "mc_attributes", "recall_payload",
      "recall_status", "warranty_info", "service_records",
      "available_accessories", "epa_economy", "history_payload", "market_meta",
      "group_similar", "value_history", "doc_fee",
      "advertised_price_before_doc", "website_sale_price", "dealer_discount",
      "retail_cash", "dealer_snapshot", "packet_modules", "value_props",
    ]) {
      expect(shipped[k], `${k} was stripped from the locked passport`).toBeDefined();
    }
  });

  it("keeps the fee-inclusive price derivation intact", () => {
    // buildSalePriceCard reads these four off the listing. A denylist that ate
    // any of them would silently change the price the passport prints.
    for (const k of [
      "advertised_price_before_doc", "doc_fee", "website_sale_price", "dealer_discount",
    ]) {
      expect(PUBLIC_VIEW_DENY.has(k)).toBe(false);
    }
  });
});
