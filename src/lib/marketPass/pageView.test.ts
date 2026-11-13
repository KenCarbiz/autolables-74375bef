import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AutoLabelsVerifiedCard from "@/components/passport/AutoLabelsVerifiedCard";
import { derivePassport, fmt$, suppressPassportMarketClaim, compSampleView } from "@/lib/passportV2Data";
import { listingGallery } from "@/lib/photos";
import { packetVisible } from "@/lib/packetModules";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { deriveVerificationReport, summarizeVerificationExceptions, verificationStatusCounts } from "@/lib/passport/verificationSummary";
import { resolveMarketComparison } from "@/lib/passport/marketComparison";
import { normalizeComparables } from "@/lib/passport/comparables";
import { resolveFuelEconomy } from "@/lib/passport/fuelEconomy";
import { resolveStickyButtons, type StickyBottomButtons } from "@/lib/stickyButtons";
import { identityFromListing } from "@/lib/factorySticker/vehicleIdentity";
import { publicMarketClaimForListing } from "@/lib/market/publicClaim";
import { previewEstimatorPayload } from "@/lib/payment/previewExample";
import { PURCHASE_ACTION_KEYS, readPassportAvailability } from "../../../supabase/functions/_shared/listingDisposition";
import { MOCK_LISTING } from "@/pages/VehiclePassportV3";
import { MARKETPASS_PAGE_CONTRACT_VERSION } from "./pageViewTypes";
import { buildMarketPassPageView, collectDocumentLinks, summarizeDealerTrust, toPublicListing } from "./pageView";
import { decidePageViewResponse, pickWindowSticker } from "./pageViewHandler";
import { pageViewFixtures, NOW, withdrawnRow } from "./__fixtures__/pageViewRows";
import { OTHER_TENANT, TENANT, settings, usedRow } from "@/lib/intelligence/marketPass/__fixtures__/rows";

type Row = Record<string, unknown>;
const FIXTURES = pageViewFixtures();
const NAMES = Object.keys(FIXTURES);

/** The page's own chain, run on the same public row, as the parity oracle. */
function oracle(row: Row) {
  const listing = toPublicListing(row);
  const claim = publicMarketClaimForListing(listing as never);
  const derived = derivePassport(listing as never);
  const d = claim.show ? derived : suppressPassportMarketClaim(derived);
  const condition = String(listing.condition || "").toLowerCase();
  return { listing, d, condition, report: deriveVerificationReport(d, listing as never), saleCard: buildPassportSaleCard(d, condition), avail: readPassportAvailability(listing) };
}

describe("fixtures are real and distinct", () => {
  it("covers every required scenario", () => {
    for (const k of ["used", "new2026", "newMsrp", "usedFee", "sparse", "sold", "pending", "withdrawn", "brandedTitle", "mockListing", "marketPassUsed", "marketPassNew", "marketPassLegacy"]) {
      expect(FIXTURES[k], k).toBeTruthy();
    }
    expect(NAMES.length).toBeGreaterThanOrEqual(13);
  });
});

describe.each(NAMES)("parity with the Passport's own functions: %s", (name) => {
  const row = FIXTURES[name];
  const v = buildMarketPassPageView(row, { nowMs: NOW });
  const o = oracle(row);

  it("carries the envelope", () => {
    expect(v.contractVersion).toBe(MARKETPASS_PAGE_CONTRACT_VERSION);
    expect(v.audience).toBe("public");
    expect(v.vin).toBe(String(o.listing.vin));
    expect(v.slug).toBe(String(o.listing.slug));
    expect(v.generatedAt).toBe(new Date(NOW).toISOString());
  });

  it("prices equal buildPassportSaleCard, line for line", () => {
    const price = v.actionCenter!.price;
    if (!o.avail.purchasable) {
      expect(price.mode).toBe("last_advertised");
      return;
    }
    const card = o.saleCard!;
    expect(price.mode).toBe(card.reconciles ? "breakdown" : "headline");
    if (price.mode !== "breakdown") return;
    expect(price.total.amount).toBe(card.totalAdvertisedPrice);
    expect(price.totalAdvertisedPrice.amount).toBe(card.totalAdvertisedPrice);
    expect(price.vehicleSellingPrice.amount).toBe(card.vehicleSellingPrice);
    expect(price.lines.map((l) => [l.key, l.label, l.amount, l.role])).toEqual(card.lines.map((l) => [l.key, l.label, l.amount, l.role]));
    expect(price.fee?.amount ?? null).toBe(card.feeAmount);
    expect(price.fee?.label ?? null).toBe(card.feeLabel ? `+ ${card.feeLabel}` : null);
    expect(price.youSave?.amount ?? null).toBe(card.showSavings ? card.customerSavings : null);
    if (price.youSave) expect(price.youSave.amount).toBeGreaterThan(0);
  });

  it("verification counts equal deriveVerificationReport", () => {
    if (!(o.report.valid && o.report.totalChecks > 0)) { expect(v.verification).toBeNull(); return; }
    const ver = v.verification!;
    expect(ver.totalChecks).toBe(o.report.totalChecks);
    expect(ver.verifiedChecks).toBe(o.report.verifiedChecks);
    expect(ver.checks.map((c) => [c.key, c.status])).toEqual(o.report.checks.map((c) => [c.key, c.status]));
    const allVerified = o.report.verifiedChecks === o.report.totalChecks;
    expect(ver.summaryLine).toBe(allVerified ? `All ${o.report.totalChecks} checks verified` : `${o.report.verifiedChecks} of ${o.report.totalChecks} checks independently verified · ${summarizeVerificationExceptions(o.report)}`);
    expect(v.hero!.verifiedCard!.tiles.map((t) => [t.status, t.count])).toEqual(verificationStatusCounts(o.report).map((t) => [t.status, t.count]));
    for (const c of ver.checks) if (c.status !== "verified") expect(c.statusLabel).not.toBe("Verified");
  });

  it("the verified card matches what AutoLabelsVerifiedCard renders", () => {
    const card = v.hero!.verifiedCard;
    if (!card) return;
    const html = renderToStaticMarkup(createElement(AutoLabelsVerifiedCard, { report: o.report, onOpenReport: () => undefined }));
    const tiles = /data-verification-tiles="([^"]*)"/.exec(html)?.[1];
    expect(tiles).toBe(card.tiles.map((t) => `${t.status}:${t.count}`).join(","));
    const text = html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
    expect(text).toContain(card.scopeLine);
    for (const a of card.attention) { expect(text).toContain(a.label); expect(text).toContain(a.line); expect(text).toContain(a.actionLabel); }
    for (const p of card.passed) expect(text).toContain(p.label);
    if (card.badge) expect(text).toContain(card.badge); else expect(text).not.toMatch(/All verified|to review/);
  });

  it("gallery, sticky rail, fuel, comparison and similar vehicles equal the page's functions", () => {
    expect(v.hero!.gallery.images).toEqual(listingGallery(o.listing));
    const estimatorOn = o.avail.purchasable && o.d.paymentEstimator != null;
    const sticky = resolveStickyButtons((o.listing as { sticky_bottom_buttons?: StickyBottomButtons }).sticky_bottom_buttons);
    const items = sticky.items.filter((b) => (estimatorOn || b.key !== "calculate_payment") && (o.avail.purchasable || !PURCHASE_ACTION_KEYS.has(b.key)));
    expect(v.stickyRail?.items.map((i) => i.key) ?? []).toEqual(sticky.enabled ? items.map((i) => i.key) : []);
    const fuel = resolveFuelEconomy(o.d.epa);
    expect(v.fuelEconomy!.available).toBe(fuel.available);
    expect(v.fuelEconomy!.combinedMpg).toBe(fuel.available ? fuel.combinedMpg : null);
    const mc = resolveMarketComparison({ valueHistory: o.d.valueHistory, advertisedPrice: o.d.price, normalizedMarketValue: o.d.marketBasisWeak ? null : o.d.marketAvg, sampleSize: o.d.marketMeta.analyzedCount, radiusMiles: o.d.marketMeta.radius, checkedAt: o.d.marketCheckedAt });
    expect(v.marketComparison!.mode).toBe(mc.mode);
    if (mc.mode === "trend") expect(v.marketComparison!.listingSeries).toEqual(mc.listingSeries);
    const year = Number(String(o.listing.ymm).match(/\b(19|20)\d{2}\b/)?.[0]) || null;
    const sims = normalizeComparables({ vin: o.listing.vin as string, year, trim: (o.listing.trim as string) ?? null, advertisedPrice: o.d.price }, (o.listing as { group_similar?: never[] }).group_similar ?? []);
    expect(v.similarVehicles!.items.map((s) => s.ref)).toEqual(sims.map((s) => s.id));
    expect(v.similarVehicles!.count).toBe(sims.length);
    const sample = compSampleView(o.d.marketMeta);
    if (sims.length === 0) expect(v.similarVehicles!.emptyBody).toContain(sample.n != null ? String(sample.n) : "None met");
  });

  it("dealer trust equals the page's inline logic", () => {
    const d = o.d;
    const make = identityFromListing(o.listing as never).make;
    const dt = d.dealerTrust;
    const n = parseInt(String(dt.yearsInBusiness || "").replace(/[^\d]/g, ""), 10);
    const years = Number.isFinite(n) && n > 0 ? n : null;
    const authorized = !!make && (dt.certifications.some((c) => c.toLowerCase().includes(make.toLowerCase())) || (d.dealerName || "").toLowerCase().includes(make.toLowerCase()));
    const expected = ([
      dt.familyOwned ? "Family owned" : null,
      authorized ? `Authorized ${make} retailer` : null,
      dt.serviceLocation === "onsite" ? "On-site service center" : null,
      dt.financing ? "Financing available" : null,
      dt.delivery && dt.delivery !== "none" ? `${dt.delivery.charAt(0).toUpperCase()}${dt.delivery.slice(1)} delivery available` : null,
    ].filter(Boolean)) as string[];
    const t = summarizeDealerTrust(d, make, new Date(NOW).getUTCFullYear());
    expect(t.benefits).toEqual(expected);
    expect(t.years).toBe(years);
    expect(t.foundedYear).toBe(years != null ? new Date(NOW).getUTCFullYear() - years : null);
    if (d.dealerName) {
      expect(v.whyBuy!.benefits).toEqual(expected);
      expect(v.whyBuy!.benefitsDesktop).toEqual(expected.slice(0, 4));
    } else expect(v.whyBuy).toBeNull();
  });

  it("pending is never shown as verified anywhere in the view", () => {
    const r = o.report;
    const pendingKeys = new Set(r.checks.filter((c) => c.status === "pending").map((c) => c.key));
    for (const c of v.verification?.checks ?? []) if (pendingKeys.has(c.key)) expect(c.status).toBe("pending");
    for (const p of v.hero?.verifiedCard?.passed ?? []) expect(pendingKeys.has(p.key)).toBe(false);
  });

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

describe("known figures", () => {
  it("renders the approved used-with-fee ladder", () => {
    const v = buildMarketPassPageView(FIXTURES.usedFee, { nowMs: NOW });
    const p = v.actionCenter!.price;
    expect(p.mode).toBe("breakdown");
    if (p.mode !== "breakdown") return;
    expect(p.lines.map((l) => l.display)).toEqual(["$31,981", "−$2,000"]);
    expect(p.vehicleSellingPrice.display).toBe("$29,981");
    expect(p.fee).toEqual({ label: "+ Dealer Doc Fee", amount: 895, display: "$895" });
    expect(p.totalAdvertisedPrice.display).toBe("$30,876");
    expect(p.youSave?.display).toBe("$1,105");
    expect(p.lines[0].mobileLabel).toBe("Market Reference");
  });

  it("degrades the sparse listing to the minimum truthful rows", () => {
    const p = buildMarketPassPageView(FIXTURES.sparse, { nowMs: NOW }).actionCenter!.price;
    expect(p.mode === "breakdown" && p.lines.length === 0 && p.fee === null && p.youSave === null).toBe(true);
  });

  it("surfaces a title brand as a confirm-before-purchase row and never as verified", () => {
    const v = buildMarketPassPageView(FIXTURES.brandedTitle, { nowMs: NOW });
    expect(v.confirmBeforePurchase!.rows.map((r) => r.title)).toContain("Title brand reported");
    expect(v.verification!.checks.find((c) => c.key === "title")!.status).not.toBe("verified");
    expect(v.hero!.identity.trustBadgesMobile).not.toContain("Clean Title");
  });

  it("applies the warranty remaining-coverage math at the supplied clock", () => {
    const used = { ...(MOCK_LISTING as Row), condition: "used", warranty_info: { factory_months: 48, factory_miles: 60000, in_service_date: "2024-10-01" } };
    const v = buildMarketPassPageView(used, { nowMs: NOW });
    const bar = v.warranty!.bars[0];
    expect(bar.key).toBe("bumper_to_bumper");
    expect(bar.percent).toBeGreaterThan(3);
    expect(bar.percent).toBeLessThan(100);
    expect(bar.text).toMatch(/left$/);
  });
});

describe("hard exclusions", () => {
  const EXCLUDED_KEYS = [
    "tenant_id", "tenantId", "store_id", "storeId", "id", "listing_id", "blackbook", "black_book", "tradeinClean", "wholesaleClean", "retailClean",
    "viewCount", "view_count", "confScore", "confLabel", "confDeductions", "confBlockedBy", "deductions", "blockedBy",
    "marketDesirability", "marketDesirabilityScore", "dataConfidence", "dataConfidenceScore",
    "mc_attributes", "market_meta", "market_payload", "mc_raw", "inputsHash", "inputs_hash",
    "cost", "costs", "acquisitionCost", "reconCost", "recon_cost", "advisorName", "advisor_name", "advisorPhoto", "email", "staffName", "created_by", "assigned_agent_id", "install_token",
  ];
  const SENTINELS = { view_count: 918273, tradein: 2345611, wholesale: 3456722, retail: 4567833 };

  const walk = (value: unknown, path: string, hits: string[], bannedValues: Set<unknown>) => {
    if (Array.isArray(value)) { value.forEach((x, i) => walk(x, `${path}[${i}]`, hits, bannedValues)); return; }
    if (value && typeof value === "object") {
      for (const [k, x] of Object.entries(value)) {
        if (EXCLUDED_KEYS.includes(k)) hits.push(`key ${path}.${k}`);
        walk(x, `${path}.${k}`, hits, bannedValues);
      }
      return;
    }
    if ((typeof value === "number" || typeof value === "string") && bannedValues.has(value)) hits.push(`value ${path}=${String(value)}`);
  };
  const banned = new Set<unknown>(Object.values(SENTINELS).flatMap((n) => [n, String(n), fmt$(n)]));
  const scan = (view: unknown) => { const hits: string[] = []; walk(view, "$", hits, banned); return hits; };

  const loaded = (row: Row): Row => ({
    ...row,
    view_count: SENTINELS.view_count,
    cost: 11111, recon_cost: 22222, acquisition_cost: 33333,
    created_by: "staff-user-1", assigned_agent_id: "agent-9", install_token: "tok_secret",
    blackbook: { trade_in_clean: SENTINELS.tradein, wholesale_clean: SENTINELS.wholesale, retail_clean: SENTINELS.retail, tradeinClean: SENTINELS.tradein, wholesaleClean: SENTINELS.wholesale, retailClean: SENTINELS.retail, available: true },
    black_book: { wholesale: SENTINELS.wholesale },
    mc_attributes: { ...((row.mc_attributes as Row) ?? {}), blackbook: { trade_in: SENTINELS.tradein } },
  });

  it.each(NAMES)("%s carries no excluded key and no planted figure", (name) => {
    const view = buildMarketPassPageView(loaded(FIXTURES[name]), { nowMs: NOW });
    expect(scan(view)).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(String(SENTINELS.view_count));
  });

  it("the walker fails on a planted key and on a planted figure", () => {
    const view = buildMarketPassPageView(loaded(FIXTURES.used), { nowMs: NOW }) as unknown as Row;
    expect(scan(view)).toEqual([]);
    expect(scan({ ...view, tenant_id: "t" }).length).toBeGreaterThan(0);
    expect(scan({ ...view, hero: { ...(view.hero as Row), blackbook: { x: 1 } } }).length).toBeGreaterThan(0);
    expect(scan({ ...view, hero: { ...(view.hero as Row), notes: [SENTINELS.tradein] } }).length).toBeGreaterThan(0);
    expect(scan({ ...view, footer: { label: fmt$(SENTINELS.view_count) } }).length).toBeGreaterThan(0);
  });

  it("never serves signed or deal paper or a staff name", () => {
    const v = buildMarketPassPageView(FIXTURES.mockListing, { nowMs: NOW });
    const titles = v.documents!.links.map((l) => l.title);
    expect(titles).not.toContain("Purchase Agreement");
    expect(titles).not.toContain("Buyer's Order");
    expect(titles).not.toContain("Retail Installment Contract");
    expect(titles).toContain("Maintenance Records");
    const json = JSON.stringify(v);
    expect((FIXTURES.mockListing.dealer_trust as Row).advisor_name ?? "__none__").not.toBe("");
    const advisor = String((FIXTURES.mockListing.dealer_trust as Row).advisor_name || "");
    if (advisor) expect(json).not.toContain(advisor);
  });

  it("honours packet curation: an excluded module is absent", () => {
    const hidden = { ...(FIXTURES.mockListing as Row), packet_modules: { marketValue: false, warranty: false, documents: false, historyReport: false } };
    const v = buildMarketPassPageView(hidden, { nowMs: NOW });
    expect(v.marketIntelligence).toBeNull();
    expect(v.warranty).toBeNull();
    expect(v.documents!.links.filter((l) => l.source === "Dealer-provided").map((l) => l.title)).toEqual(["Window Sticker (Monroney)"]);
    expect(packetVisible(hidden, "marketValue")).toBe(false);
  });

  it("projects a raw row to the public allowlist before computing anything", () => {
    const listing = toPublicListing(loaded(FIXTURES.used));
    for (const k of ["blackbook", "black_book", "cost", "created_by", "install_token", "assigned_agent_id"]) expect(listing[k], k).toBeUndefined();
    const again = toPublicListing(listing);
    expect(again).toEqual(listing);
  });
});

describe("not purchasable", () => {
  const withEstimator = (row: Row): Row => ({ ...row, payment_estimator: previewEstimatorPayload() });

  it("an available car with an estimator offers hold, test drive, payment and watch", () => {
    const v = buildMarketPassPageView(withEstimator(FIXTURES.usedFee), { nowMs: NOW });
    const keys = v.actionCenter!.actions.map((a) => a.key);
    for (const k of ["test_drive", "reserve", "build_payment", "watch_price"]) expect(keys).toContain(k);
    expect(v.actionCenter!.payment.state).toBe("available");
    expect(v.actionCenter!.payment.monthly!.display).toMatch(/^\$/);
    expect(v.availability).toBeNull();
    expect(v.actionCenter!.taxNote).toBeTruthy();
  });

  it.each(["sold", "pending", "withdrawn"])("%s hides hold, test drive, price and payment exactly as the page does", (name) => {
    const v = buildMarketPassPageView(withEstimator(FIXTURES[name]), { nowMs: NOW });
    const keys = v.actionCenter!.actions.map((a) => a.key);
    for (const k of ["test_drive", "reserve", "build_payment", "watch_price"]) expect(keys, k).not.toContain(k);
    expect(keys).toEqual(expect.arrayContaining(["value_trade", "ask_question", "documents", "save", "share"]));
    expect(v.actionCenter!.price.mode).toBe("last_advertised");
    expect(v.actionCenter!.payment.state).toBe("off");
    expect(v.actionCenter!.payment.monthly).toBeNull();
    expect(v.actionCenter!.taxNote).toBeNull();
    expect(v.actionCenter!.watchPrice.offered).toBe(false);
    expect(v.actionCenter!.nextSteps.map((s) => s.key)).toEqual(["contact", "print"]);
    expect(v.availability!.purchasable).toBe(false);
    expect(v.availability!.message.length).toBeGreaterThan(10);
    expect(v.hero!.gallery.archivedPhotoNote).toContain("not a current offer");
    for (const b of v.stickyRail?.items ?? []) expect(PURCHASE_ACTION_KEYS.has(b.key)).toBe(false);
  });

  it("the same figures that make an available car purchasable do not leak as an offer", () => {
    const v = buildMarketPassPageView(withEstimator(FIXTURES.withdrawn), { nowMs: NOW });
    const p = v.actionCenter!.price;
    expect(p.mode).toBe("last_advertised");
    if (p.mode === "last_advertised") expect(p.note).toContain("Not a current offer");
    expect(JSON.stringify(v.actionCenter)).not.toContain("youSave");
  });

  it("withdrawn rows read the same disposition the page reads", () => {
    expect(readPassportAvailability(toPublicListing(withdrawnRow())).purchasable).toBe(false);
  });
});

describe("documents and the window sticker", () => {
  it("carries the published window sticker only when one is supplied", () => {
    const none = buildMarketPassPageView(FIXTURES.used, { nowMs: NOW });
    expect(none.documents!.windowSticker).toBeNull();
    const ws = { pdfUrl: "https://x.test/p.pdf", thumbnailUrl: "https://x.test/t.png", publishedAt: "2026-11-02T10:00:00Z" };
    const v = buildMarketPassPageView(FIXTURES.used, { nowMs: NOW, windowSticker: ws });
    expect(v.documents!.windowSticker).toMatchObject({ pdfUrl: ws.pdfUrl, thumbnailUrl: ws.thumbnailUrl, updatedDisplay: "Nov 2, 2026", ctaLabel: "View Window Sticker" });
    expect(buildMarketPassPageView(FIXTURES.used, { nowMs: NOW, windowSticker: { ...ws, pdfUrl: null } }).documents!.windowSticker).toBeNull();
  });

  it("lists the history report, brochure and manual as external sources", () => {
    const listing = toPublicListing({ ...(FIXTURES.used as Row), history_report: { url: "https://www.carfax.com/vehicle/5N1AL1F83VC332077", provider: "carfax", source: "vin" } });
    const d = derivePassport(listing as never);
    const links = collectDocumentLinks(listing, d);
    expect(links.find((l) => l.key === "history")?.external).toBe(true);
    expect(links.find((l) => l.key === "brochure")?.scope).toBe("Model-level");
  });

  it("pickWindowSticker takes the newest published factory sticker and a stable address", () => {
    const rows = [{ document_type: "factory_sticker", version: 1, published_at: "2026-10-01" }, { document_type: "factory_sticker", version: 3, published_at: "2026-11-03" }, { document_type: "buyers_guide", version: 9 }];
    const o = { functionsBase: "https://p.supabase.co/functions/v1", slug: "SLUG 1", hasPdf: true, hasThumbnail: false };
    const ws = pickWindowSticker(rows, o)!;
    expect(ws.publishedAt).toBe("2026-11-03");
    expect(ws.pdfUrl).toBe("https://p.supabase.co/functions/v1/public-document-asset?slug=SLUG%201&document_type=factory_sticker&asset_type=pdf&redirect=1");
    expect(ws.thumbnailUrl).toBeNull();
    expect(pickWindowSticker(rows, { ...o, hasPdf: false })).toBeNull();
    expect(pickWindowSticker([{ document_type: "buyers_guide", version: 1 }], o)).toBeNull();
  });
});

describe("view=page request decision", () => {
  const caller = { userId: null, memberTenantIds: [] as string[] };
  const row = () => usedRow();
  const base = { settings: settings(false), caller, nowMs: NOW };

  it("another tenant's listing is 404", () => {
    const r = decidePageViewResponse({ ...base, row: row(), expectedTenantId: OTHER_TENANT });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "not_found" });
  });

  it("a public row from another tenant than the raw row is 404", () => {
    const r = decidePageViewResponse({ ...base, row: row(), publicRow: { ...(row() as unknown as Row), tenant_id: OTHER_TENANT }, expectedTenantId: TENANT });
    expect(r.status).toBe(404);
  });

  it("a missing listing and a draft are 404", () => {
    expect(decidePageViewResponse({ ...base, row: null }).status).toBe(404);
    expect(decidePageViewResponse({ ...base, row: usedRow({ status: "draft" }) }).status).toBe(404);
  });

  it("serves the page with marketpass null while the flag is off", () => {
    const r = decidePageViewResponse({ ...base, row: row(), expectedTenantId: TENANT });
    expect(r.status).toBe(200);
    const body = r.body as { ok: boolean; page: { contractVersion: string }; marketpass: unknown };
    expect(body.ok).toBe(true);
    expect(body.page.contractVersion).toBe(MARKETPASS_PAGE_CONTRACT_VERSION);
    expect(body.marketpass).toBeNull();
  });

  it("serves the page without a tenant binding when none is named", () => {
    expect(decidePageViewResponse({ ...base, row: row() }).status).toBe(200);
  });

  it("adds the public MarketPass contract only when the flag is on, never the dealer one", () => {
    const r = decidePageViewResponse({ ...base, settings: settings(true), row: row(), expectedTenantId: TENANT });
    const body = r.body as { marketpass: Record<string, unknown> | null };
    expect(body.marketpass).not.toBeNull();
    expect(body.marketpass!.audience).toBe("public");
    expect(JSON.stringify(body.marketpass)).not.toMatch(/marketDesirability|dataConfidence/);
    expect(JSON.stringify(body.marketpass)).not.toMatch(/tenant_id|"store_id"/);
  });
});

describe("marketpass-assessment view=page is server-to-server only", () => {
  const src = readFileSync(resolve(__dirname, "../../../supabase/functions/marketpass-assessment/index.ts"), "utf8");
  const gate = src.slice(src.indexOf("if (viewPage) {"), src.indexOf("if (viewPage) {") + 600);
  it("refuses a caller without AutoFilm's shared secret before any read", () => {
    expect(gate).toMatch(/AUTOLABELS_LOOKUP_SECRET/);
    expect(gate).toMatch(/timingSafeEqual\(key, secret\)\) return json\(401/);
    expect(src.indexOf("if (viewPage) {")).toBeLessThan(src.indexOf("createClient("));
  });
  it("requires a tenant binding", () => {
    expect(gate).toMatch(/tenant_id_required/);
  });
});
