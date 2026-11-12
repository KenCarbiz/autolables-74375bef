import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The REAL shared module, not a copy. It has no imports, so it loads under
// vitest unchanged and a rename in the denylist fails here rather than
// silently re-opening the hole.
import {
  LOT_FEED_DENY, PUBLIC_VIEW_DENY, scrubTitleVerification,
} from "../../../supabase/functions/_shared/lotFeedRow.ts";
import {
  PUBLIC_LISTING_FIELDS, projectPublicListing,
} from "../../../supabase/functions/_shared/publicListingProjection.ts";

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
const shipToShopper = (row: Record<string, unknown>) => projectPublicListing(row);

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

  it("keeps the exported backstop list stable", () => {
    expect([...PUBLIC_VIEW_DENY].sort()).toEqual([
      "assigned_agent_id", "created_by", "install_token", "mc_raw",
      "price_parse_notes", "recall_override_at", "recall_override_by",
      "recall_override_notes",
    ].sort());
  });
});

describe("the public view is an allowlist, with the denylist as a backstop", () => {
  it("never names a denied key as a public field", () => {
    for (const k of PUBLIC_VIEW_DENY) {
      expect(PUBLIC_LISTING_FIELDS.has(k), `${k} is both denied and allowed`).toBe(false);
    }
    expect(PUBLIC_LISTING_FIELDS.has("install_token")).toBe(false);
  });

  it("is wired into the function through the projection, not a deny sweep", () => {
    expect(view).toMatch(/import \{ projectPublicListing \} from "\.\.\/_shared\/publicListingProjection\.ts";/);
    expect(view).toMatch(/shipped = projectPublicListing\(row\);/);
    expect(view).not.toMatch(/for \(const k of PUBLIC_VIEW_DENY\)/);
  });

  it("applies recall and title shaping to the projected row, after projection", () => {
    const proj = view.indexOf("projectPublicListing(row)");
    const recall = view.indexOf("applyRecallProjection(shipped)");
    const ret = view.indexOf("return json(200, { listing: shipped });");
    expect(proj).toBeGreaterThan(-1);
    expect(recall).toBeGreaterThan(proj);
    expect(ret).toBeGreaterThan(recall);
    expect(view.slice(recall, ret)).not.toMatch(/\bshipped\.\w+ =/);
  });
});

describe("the locked passport still gets everything it renders", () => {
  it("keeps the market modules, projected key by key", () => {
    const shipped = shipToShopper({ ...rawRow(), blackbook: { retail: 1, wholesale: 2 } });
    expect(shipped.blackbook).toBeUndefined();
    expect(JSON.stringify(shipped)).not.toContain("wholesale");
    expect(shipped.market_payload).toBeDefined();
    expect(shipped.comparables).toBeDefined();
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
      "retail_cash", "dealer_snapshot", "packet_modules",
    ]) {
      expect(shipped[k], `${k} was stripped from the locked passport`).toBeDefined();
    }
  });

  it("keeps the fee-inclusive price derivation intact", () => {
    for (const k of [
      "advertised_price_before_doc", "doc_fee", "website_sale_price", "dealer_discount",
    ]) {
      expect(PUBLIC_LISTING_FIELDS.has(k), k).toBe(true);
    }
  });
});

describe("the title attestation reaches the shopper without the employee who signed it", () => {
  // vehicle_listings.title_verification is a dealership business record and the
  // passport's title check renders it. Its verified_by is an internal
  // auth.users id, and both sister-app feeds are allow-by-default, so the id
  // would have shipped to anonymous consumers the moment a dealer attested.
  const attestation = {
    status: "clean",
    verified_at: "2026-09-09T12:00:00Z",
    verified_by: "8f14e45f-ceea-467a-9d1a-0b1cbb9f6d4e",
    source: "nmvtis_vindata",
    report_generated_at: "2026-09-09T11:59:00Z",
    report_expires_at: "2026-12-08T11:59:00Z",
    brand_note: null,
  };

  it("keeps what the passport renders", () => {
    const out = scrubTitleVerification(attestation) as Record<string, unknown>;
    expect(out.status).toBe("clean");
    expect(out.verified_at).toBe("2026-09-09T12:00:00Z");
    expect(out.source).toBe("nmvtis_vindata");
    expect(out.report_generated_at).toBe("2026-09-09T11:59:00Z");
    expect(out.report_expires_at).toBe("2026-12-08T11:59:00Z");
  });

  it("drops the internal user id", () => {
    const out = scrubTitleVerification(attestation) as Record<string, unknown>;
    expect(out.verified_by).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("8f14e45f");
  });

  it("allows by name, so a key nobody thought about does not ship", () => {
    const out = scrubTitleVerification({
      ...attestation,
      internal_notes: "called the auction",
      dealer_cost: 41200,
    }) as Record<string, unknown>;
    expect(out.internal_notes).toBeUndefined();
    expect(out.dealer_cost).toBeUndefined();
  });

  it("returns null rather than an empty husk", () => {
    expect(scrubTitleVerification(null)).toBeNull();
    expect(scrubTitleVerification({ verified_by: "x" })).toBeNull();
    expect(scrubTitleVerification("clean")).toBeNull();
  });

  it("is wired into both surfaces", () => {
    expect(view).toContain("scrubTitleVerification(shipped.title_verification)");
    const shaper = readFileSync(
      join(__dirname, "../../../supabase/functions/_shared/lotFeedRow.ts"),
      "utf8",
    );
    expect(shaper).toContain("out.title_verification = scrubTitleVerification(row.title_verification)");
  });
});
