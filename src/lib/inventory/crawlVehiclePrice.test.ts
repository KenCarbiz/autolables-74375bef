import { describe, expect, it } from "vitest";
import { documentTitles, pageIdentity, scopeToVehicle, vinCheckDigitOk } from "../../../supabase/functions/_shared/vdpIdentity";
import { extractVehiclePrice } from "../../../supabase/functions/_shared/vdpPrice";
import { decideFeeBasis, dealerInterpretation, sectionAround } from "../../../supabase/functions/_shared/feeBasis";
import { readPriceStack } from "../../../supabase/functions/_shared/priceStack";
import {
  commitObservation, revalidateEvidence, type CommitDb, type CommitInput, type ListingPricing,
} from "../../../supabase/functions/_shared/crawlCommit";

// Synthetic VINs with valid check digits; no hosted VIN, price or dealer.
const VIN = "1EXMP0005S9000001";
const OTHER = "1EXMP0007S9000002";
const THIRD = "1EXMP0009S9000003";
const URL = `https://dealer.example.test/viewdetails/used/${VIN.toLowerCase()}/2023-example-suv`;
const page = (body: string, head = "<title>2023 Example SUV | Example Motors</title>") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const main = (price = "$24,500", extra = "") =>
  `<main><section class="vdp-hero"><h1>2023 Example SUV</h1><div class="specs">VIN: ${VIN}</div>${extra}<div class="price">Selling Price ${price}</div></section></main>`;
const read = (html: string, opts: { finalUrl?: string | null; ymm?: string | null } = {}) =>
  extractVehiclePrice(html, { targetVin: VIN, requestedUrl: URL, finalUrl: opts.finalUrl ?? URL, labels: [], ymm: opts.ymm ?? "2023 Example SUV" });

describe("vehicle identity on every extraction path", () => {
  it("synthetic VINs carry valid check digits", () => {
    expect([VIN, OTHER, THIRD].every(vinCheckDigitOk)).toBe(true);
    expect(vinCheckDigitOk("1EXMP0000S9000001")).toBe(false);
  });

  it("refuses a page that names no vehicle (before: the price was accepted)", () => {
    const r = read(page(`<div>Selling Price $24,500</div>`));
    expect(r.price).toBeNull();
    expect(r.reason).toBe("identity_unverified");
    expect(r.identity.verdict).toBe("no_vehicle");
  });

  it("accepts the VIN in any letter case, including a lowercase data attribute", () => {
    const r = read(page(`<div data-vin="${VIN.toLowerCase()}"><div>Selling Price $24,500</div></div>`));
    expect(r.identity.verdict).toBe("vehicle");
    expect(r.price).toBe(24500);
  });

  it("refuses a redirect to another vehicle's address", () => {
    const r = read(page(main()), { finalUrl: `https://dealer.example.test/viewdetails/used/${OTHER.toLowerCase()}/x` });
    expect(r.reason).toBe("vin_mismatch");
    expect(r.identity.reason).toMatch(/final address names another vehicle/);
  });

  it("refuses a redirect to an address that does not name this vehicle", () => {
    const r = read(page(main()), { finalUrl: "https://dealer.example.test/used-inventory" });
    expect(r.price).toBeNull();
    expect(r.identity.reason).toMatch(/redirected to an address that does not name this vehicle/);
  });

  it("refuses a page whose canonical address names another vehicle", () => {
    const html = page(main(), `<title>x</title><link rel="canonical" href="https://dealer.example.test/viewdetails/used/${OTHER.toLowerCase()}">`);
    expect(read(html).reason).toBe("vin_mismatch");
  });

  it("refuses when this VIN appears only inside a related-vehicles section", () => {
    const html = page(`<main><h1>Another car</h1><div>Selling Price $31,000</div></main>
      <section class="similar-vehicles"><a href="/viewdetails/used/${VIN.toLowerCase()}">Selling Price $24,500</a></section>`);
    const r = read(html);
    expect(r.price).toBeNull();
    expect(r.identity.reason).toMatch(/only inside another vehicle's card or a related-vehicles section/);
  });
});

describe("price scoped to the vehicle's own section", () => {
  it("a similar-vehicle card earlier on the page no longer sets the price (before: the card's $19,900 won)", () => {
    const card = `<div class="card"><a href="/viewdetails/used/${OTHER.toLowerCase()}/x">2022 Other</a><span>Selling Price $19,900</span></div>`;
    const r = read(page(`${card}${main()}`));
    expect(r.price).toBe(24500);
    expect(r.identity.removedSections).toBe(1);
  });

  it("removes a marked related-vehicles strip even when its cards carry no VIN", () => {
    const strip = `<div class="vdp-similar"><div>Selling Price $19,900</div><div>Selling Price $21,000</div></div>`;
    expect(read(page(`${main()}${strip}`)).price).toBe(24500);
  });

  it("refuses conflicting prices it cannot attribute instead of taking the first or the lowest", () => {
    const unmarked = `<div><span>Selling Price $19,900</span></div>`;
    const r = read(page(`${unmarked}${main()}`));
    expect(r.price).toBeNull();
    expect(r.reason).toBe("ambiguous_price");
    expect(r.candidates.map((c) => c.value).sort()).toEqual([19900, 24500]);
  });

  it("accepts the same price printed twice (sticky header and price block)", () => {
    const r = read(page(`<header>Selling Price $24,500</header>${main()}`));
    expect(r.price).toBe(24500);
  });

  it("ignores another vehicle's JSON-LD offer and an offer without a VIN beside it", () => {
    const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
    const html = page(`${ld({ "@type": "Car", offers: { price: 19900 } })}${ld({ "@type": "Car", vehicleIdentificationNumber: OTHER, offers: { price: 21000 } })}${main()}`);
    const r = read(html);
    expect(r.source).toBe("dom_label");
    expect(r.price).toBe(24500);
  });

  it("reads inside the vehicle's own price widget first", () => {
    const widget = `<div class="pricing" data-vin="${VIN}"><ul><li>MSRP $52,000</li><li>Dealer Discount -$2,000</li><li>Selling Price $50,000</li><li>Conveyance Fee +$900</li><li>Your Price $50,900</li></ul></div>`;
    const html = page(`<main><h1>2023 Example SUV</h1>${widget}<p>Selling Price $49,000 with financing</p></main>`);
    const scope = scopeToVehicle(html, VIN);
    const stack = readPriceStack(scope.html, VIN, { configuredFee: 900, pageUrl: URL });
    const r = extractVehiclePrice(html, { targetVin: VIN, requestedUrl: URL, finalUrl: URL, scope, widgetRange: stack.widgetRange });
    expect(stack.status).toBe("reconciled");
    // Configured and default labels run in order; "Your Price" (the customer
    // total) comes before "Selling Price".
    expect(r.section).toBe("widget");
    expect(r.price).toBe(50900);
    expect(r.matched_label).toBe("your price");
  });
});

describe("page title: recorded as a finding, never decisive", () => {
  it("reads the document title from <head>; an embedded widget title is recorded separately", () => {
    const html = page(`${main()}<div class="history-panel"><svg><title>ExamplePanel</title></svg></div>`);
    expect(documentTitles(html)).toEqual({ document: "2023 Example SUV | Example Motors", embedded: ["ExamplePanel"] });
    const r = read(html);
    expect(r.price).toBe(24500);
    expect(r.identity.findings).toContain("embedded_title_present");
    expect(r.identity.findings).not.toContain("page_title_unrecognized");
  });

  it("a document title that names neither the vehicle nor the dealer is a finding, and the page still reads", () => {
    const r = read(page(main(), "<title>PanelCo</title>"));
    expect(r.identity.verdict).toBe("vehicle");
    expect(r.identity.findings).toContain("page_title_unrecognized");
    expect(r.price).toBe(24500);
  });

  it("the old reader took the first <title> anywhere, so an embedded title could stand in for the page's", () => {
    const html = `<html><head></head><body><svg><title>ExamplePanel</title></svg>${main()}</body></html>`;
    expect(pageIdentity({ html, targetVin: VIN, requestedUrl: URL }).documentTitle).toBeNull();
  });
});

describe("fee basis: observation, dealer interpretation, page evidence and derived values kept apart", () => {
  const settings = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ doc_fee_enabled: true, doc_fee_amount: 900, ...o });
  const input = (o: Partial<Parameters<typeof decideFeeBasis>[0]> = {}) => ({
    observed: { amount: 30000, label: "Selling Price", source: "dom_label", section: "page" },
    settings: settings({ advertised_includes_doc_fee: true }),
    pageUrl: URL,
    listingCondition: "used",
    sectionText: "selling price $30,000",
    pageText: "",
    ...o,
  });

  it("reads the dealer interpretation exactly as the basis policy does", () => {
    expect(dealerInterpretation(settings({ advertised_includes_doc_fee: true }), "used").basis).toBe("includes_fee");
    expect(dealerInterpretation(settings({ advertised_includes_doc_fee: "false" }), "used").basis).toBe("before_fee");
    expect(dealerInterpretation(settings({ advertised_includes_doc_fee: true, advertised_excludes_doc_fee: true }), "used").basis).toBe("conflict");
    expect(dealerInterpretation(settings({ advertised_includes_doc_fee: "yes" }), "used").source).toBe("unreadable_setting");
    expect(dealerInterpretation(settings(), "used").basis).toBe("unconfigured");
  });

  it("a dealer setting alone is not page evidence: derived and recorded, never promoted (before: written to the listing)", () => {
    const b = decideFeeBasis(input());
    expect(b.status).toBe("dealer_configured_unverified");
    expect(b.page.says).toBeNull();
    expect(b.derivedFrom).toBe("dealer_setting");
    expect(b.derived).toEqual({ advertised_price_before_doc: 29100, doc_fee: 900, website_sale_price: 30000 });
    expect(b.promote).toBe(false);
  });

  it("a fee line and a labelled total on the page that agree with the setting verify the basis", () => {
    const b = decideFeeBasis(input({ sectionText: "selling price $30,000 documentation fee $900 total price $30,000" }));
    expect(b.status).toBe("page_verified");
    expect(b.promote).toBe(true);
    expect(b.page.decisive[0].kind).toBe("price_stack");
  });

  it("page wording that contradicts the setting is a conflict, and the setting is not changed", () => {
    const s = settings({ advertised_includes_doc_fee: true });
    const b = decideFeeBasis(input({ settings: s, sectionText: "selling price $30,000 plus documentation fee" }));
    expect(b.status).toBe("conflict");
    expect(b.promote).toBe(false);
    expect(s.advertised_includes_doc_fee).toBe(true);
  });

  it("page evidence without a configured basis stays unresolved", () => {
    const b = decideFeeBasis(input({ settings: settings(), sectionText: "selling price $30,000 includes the documentation fee" }));
    expect(b.status).toBe("unresolved");
    expect(b.promote).toBe(false);
  });

  it("a page-wide footer disclaimer is context, not evidence for this figure", () => {
    const b = decideFeeBasis(input({ pageText: "prices exclude documentation fee" }));
    expect(b.page.context).toHaveLength(1);
    expect(b.page.decisive).toHaveLength(0);
    expect(b.status).toBe("dealer_configured_unverified");
  });

  it("with no fee configured there is no basis question and the figure is the price", () => {
    const b = decideFeeBasis(input({ settings: { doc_fee_enabled: false } }));
    expect(b.status).toBe("not_applicable");
    expect(b.promote).toBe(true);
  });

  it("an itemised stack with an unverified incentive is held for review", () => {
    const html = page(`<main><div class="pricing" data-vin="${VIN}"><ul><li>Selling Price $50,000</li><li>Retail Cash -$4,000</li><li>Conveyance Fee +$900</li><li>Your Price $46,900</li></ul></div></main>`);
    const stack = readPriceStack(html, VIN, { configuredFee: 900, pageUrl: URL });
    const b = decideFeeBasis(input({ observed: { amount: 46900, label: "Your Price", source: "dom_label", section: "widget" }, stack }));
    expect(b.status).toBe("held_for_review");
    expect(b.promote).toBe(false);
  });

  it("finds the text around the figure for the section", () => {
    const t = `${"x ".repeat(500)}selling price $30,000 plus doc fee ${"y ".repeat(500)}`;
    const s = sectionAround(t, 30000);
    expect(s.section).toContain("plus doc fee");
    expect(s.section.length).toBeLessThan(900);
  });
});

describe("evidence from a separate load is revalidated", () => {
  const first = read(page(main()));
  it("accepts a second render of the same vehicle, address, figure and label", () => {
    expect(revalidateEvidence(first, URL, read(page(main())), URL)).toEqual({ status: "revalidated_render", reason: null });
  });
  it("rejects a second render of another vehicle", () => {
    const other = extractVehiclePrice(page(`<main>VIN ${OTHER} Selling Price $24,500</main>`), { targetVin: VIN, requestedUrl: URL, finalUrl: URL });
    expect(revalidateEvidence(first, URL, other, URL).status).toBe("rejected");
  });
  it("rejects a second render that was redirected", () => {
    const moved = `https://dealer.example.test/viewdetails/used/${VIN.toLowerCase()}/moved`;
    const d = revalidateEvidence(first, URL, read(page(main()), { finalUrl: moved }), moved);
    expect(d.status).toBe("rejected");
    expect(d.reason).toMatch(/address/);
  });
  it("rejects a second render showing a different price", () => {
    expect(revalidateEvidence(first, URL, read(page(main("$23,900"))), URL).status).toBe("rejected");
  });
  it("rejects a missing second render", () => {
    expect(revalidateEvidence(first, URL, null, null).status).toBe("rejected");
  });
});

// An in-memory store with the guarantees the real one gives: a unique key per
// dealership, a guarded update, and injectable failures.
function fakeDb(listing: ListingPricing | null, fail: Partial<Record<"insert" | "schema" | "read" | "update" | "race" | "promotionOff" | "controlMissing", boolean>> = {}) {
  const rows = new Map<string, { id: string; promotion: string | null; row: Record<string, unknown> }>();
  const legacy: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  let state = listing ? { ...listing } : null;
  const db: CommitDb = {
    async insertObservation(row) {
      if (fail.schema) return { kind: "schema_missing" };
      if (fail.insert) return { kind: "error", message: "insert refused" };
      const key = String(row.idempotency_key);
      const ex = rows.get(key);
      if (ex) return { kind: "duplicate", id: ex.id, promotion: ex.promotion };
      const id = `obs-${rows.size + 1}`;
      rows.set(key, { id, promotion: String(row.listing_promotion), row });
      return { kind: "inserted", id };
    },
    async insertLegacyObservation(row) { legacy.push(row); return { ok: true }; },
    async readListingPricing() { return fail.read ? { error: "read failed" } : state ? { ...state } : null; },
    async promoteListing(expected, patch) {
      if (fail.controlMissing) return { result: "held_promotion_off", detail: "promotion control not installed: promotion is off" };
      if (fail.promotionOff) return { result: "held_promotion_off", detail: "promotion is switched off (observation-only mode)" };
      if (fail.update) return { result: "error", error: "update refused" };
      if (fail.race && state) state = { ...state, website_sale_price: 1 };
      if (!state || (["advertised_price_before_doc", "doc_fee", "website_sale_price"] as const).some((f) => state![f] !== expected[f])) return { result: "conflict" };
      state = { ...state, ...(patch as Partial<ListingPricing>) };
      updates.push(patch);
      return { result: "promoted" };
    },
    async markObservation(id, promotion) { for (const r of rows.values()) if (r.id === id) r.promotion = promotion; },
  };
  return { db, rows, legacy, updates, listing: () => state, setFail: (f: typeof fail) => Object.assign(fail, f) };
}

const LISTING: ListingPricing = { id: "l1", advertised_price_before_doc: 29981, doc_fee: 895, website_sale_price: 30876 };
const commit = (o: Partial<CommitInput> = {}): CommitInput => ({
  tenantId: "t1", vin: VIN, key: "k1", row: { advertised_price: 30000, observation: {} }, legacyRow: { advertised_price: 30000 },
  promote: true, holdAs: null, holdDetail: null,
  patch: { advertised_price_before_doc: 29100, doc_fee: 900, website_sale_price: 30000, price_parse_status: "ok" }, ...o,
});

describe("store the observation, then promote", () => {
  it("promotes a verified observation with a guarded update", async () => {
    const f = fakeDb(LISTING);
    const r = await commitObservation(f.db, commit());
    expect(r.outcome).toBe("promoted");
    expect(f.listing()?.website_sale_price).toBe(30000);
    expect([...f.rows.values()][0].promotion).toBe("promoted");
  });

  it("an unverified fee basis stores the observation and leaves the listing unchanged", async () => {
    const f = fakeDb(LISTING);
    const r = await commitObservation(f.db, commit({ promote: false, holdAs: "held_fee_basis", holdDetail: "dealer_configured_unverified" }));
    expect(r.outcome).toBe("held_fee_basis");
    expect(f.rows.size).toBe(1);
    expect([...f.rows.values()][0].promotion).toBe("held_fee_basis");
    expect(f.listing()).toEqual(LISTING);
  });

  it("evidence failure stores the observation, leaves the listing unchanged and names the outcome", async () => {
    const f = fakeDb(LISTING);
    const r = await commitObservation(f.db, commit({ promote: false, holdAs: "held_evidence", holdDetail: "the evidence render gave up (out_of_time)" }));
    expect(r).toMatchObject({ outcome: "held_evidence", detail: "the evidence render gave up (out_of_time)" });
    expect(f.updates).toHaveLength(0);
  });

  it("an observation that cannot be stored never reaches the listing", async () => {
    const f = fakeDb(LISTING, { insert: true });
    const r = await commitObservation(f.db, commit());
    expect(r.outcome).toBe("observation_failed");
    expect(f.updates).toHaveLength(0);
    expect(f.listing()).toEqual(LISTING);
  });

  it("partial failure: the observation is stored, the listing write fails, the listing is unchanged; a retry promotes once", async () => {
    const f = fakeDb(LISTING, { update: true });
    expect((await commitObservation(f.db, commit())).outcome).toBe("promotion_failed");
    expect(f.listing()).toEqual(LISTING);
    expect([...f.rows.values()][0].promotion).toBe("promotion_failed");
    f.setFail({ update: false });
    expect((await commitObservation(f.db, commit())).outcome).toBe("promoted");
    expect(f.rows.size).toBe(1);
    expect((await commitObservation(f.db, commit())).outcome).toBe("duplicate");
    expect(f.updates).toHaveLength(1);
  });

  it("observation-only mode: a promotable observation and its evidence are stored, the listing is untouched", async () => {
    const f = fakeDb(LISTING, { promotionOff: true });
    const r = await commitObservation(f.db, commit());
    expect(r).toMatchObject({ outcome: "held_promotion_off", detail: "promotion is switched off (observation-only mode)" });
    expect(f.rows.size).toBe(1);
    expect([...f.rows.values()][0].row).toMatchObject({ observation: {} });
    expect([...f.rows.values()][0].promotion).toBe("held_promotion_off");
    expect(f.updates).toHaveLength(0);
    expect(f.listing()).toEqual(LISTING);
  });

  it("observation-only mode: once promotion is switched on, the held observation is promoted once", async () => {
    const f = fakeDb(LISTING, { promotionOff: true });
    expect((await commitObservation(f.db, commit())).outcome).toBe("held_promotion_off");
    f.setFail({ promotionOff: false });
    expect((await commitObservation(f.db, commit())).outcome).toBe("promoted");
    expect((await commitObservation(f.db, commit())).outcome).toBe("duplicate");
    expect(f.rows.size).toBe(1);
    expect(f.updates).toHaveLength(1);
  });

  it("a missing promotion control means promotion is off", async () => {
    const f = fakeDb(LISTING, { controlMissing: true });
    const r = await commitObservation(f.db, commit());
    expect(r.outcome).toBe("held_promotion_off");
    expect(f.updates).toHaveLength(0);
  });

  it("a listing that changed between read and write is not overwritten", async () => {
    const f = fakeDb(LISTING, { race: true });
    const r = await commitObservation(f.db, commit());
    expect(r.outcome).toBe("promotion_conflict");
    expect(f.updates).toHaveLength(0);
  });

  it("a listing that cannot be read is not written", async () => {
    const f = fakeDb(LISTING, { read: true });
    expect((await commitObservation(f.db, commit())).outcome).toBe("promotion_failed");
    expect(f.updates).toHaveLength(0);
  });

  it("an already matching listing is left as it is", async () => {
    const f = fakeDb({ ...LISTING, advertised_price_before_doc: 29100, doc_fee: 900, website_sale_price: 30000 });
    expect((await commitObservation(f.db, commit())).outcome).toBe("unchanged");
    expect(f.updates).toHaveLength(0);
  });

  it("without the new columns the observation is stored the old way and the listing is never promoted", async () => {
    const f = fakeDb(LISTING, { schema: true });
    const r = await commitObservation(f.db, commit());
    expect(r.outcome).toBe("held_schema");
    expect(f.legacy).toHaveLength(1);
    expect(f.updates).toHaveLength(0);
  });
});
