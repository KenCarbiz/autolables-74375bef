import type { VehicleListing } from "@/hooks/useVehicleListing";
import { resolveDisplayPrice, getPriceDisplayMode, type PriceDisplayMode } from "@/lib/priceModel";
import type { OemFactoryWarranty } from "@/lib/oemWarranty";

// The OEM coverage breakdown public-listing-view attaches to a new/CPO listing.
export type OemWarrantyView = Partial<OemFactoryWarranty> & { owner?: "original" | "subsequent" };

// ──────────────────────────────────────────────────────────────
// Passport V2 shared derivations
//
// Single source of truth for the values the Passport V2 surface and
// its dedicated detail pages render. Everything here is computed from
// real listing data — no fabricated certainty. Fields are null when
// the backing data is absent so callers can show honest empty states.
// ──────────────────────────────────────────────────────────────

// Equipment strings for a listing: the curated `features` column PLUS the
// MarketCheck `mc_attributes.options`/`.features` (which the feed and the VIN
// decoder populate, and which arrive as arrays OR delimited strings). Without
// this, equipment captured by the API pull never reaches the shopper page,
// which only read the top-level `features` column. De-duplicated and trimmed.
export const listingEquipment = (listing: VehicleListing): string[] => {
  const toList = (v: unknown): string[] => Array.isArray(v)
    ? v.map((x) => typeof x === "string" ? x : String((x as Record<string, unknown>)?.name ?? (x as Record<string, unknown>)?.label ?? (x as Record<string, unknown>)?.description ?? "")).map((s) => s.trim()).filter(Boolean)
    : typeof v === "string" ? v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [];
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const fromFeatures = (listing.features || []).map((f) => [f.title, f.subtitle].filter(Boolean).join(" ").trim()).filter(Boolean);
  return Array.from(new Set([...fromFeatures, ...toList(mc.options), ...toList(mc.features)]));
};

export const fmt$ = (n: number | null | undefined) =>
  n == null ? "" : `$${Math.round(n).toLocaleString()}`;

export interface VerifyRow { label: string; done: boolean }
export interface Highlight { key: string; label: string; sub: string }

export interface PassportData {
  // Identity / price
  price: number | null;
  msrp: number | null;
  priceLabel: string;
  estMonthly: number | null;
  saveVsMsrp: number | null;
  // Doc-fee model. `price` already reflects priceMode; docFee/websiteSalePrice
  // let the surface disclose the fee. priceIncludesDoc = the displayed price is
  // the website sale price (fee already inside) vs advertised-before-doc.
  docFee: number | null;
  websiteSalePrice: number | null;
  priceMode: PriceDisplayMode;
  priceIncludesDoc: boolean;
  // Customer-safe reconditioning & inspection summary (injected by
  // public-listing-view from the dealer's prep/detail/install/inspection
  // sign-offs). Null until the dealership records reconditioning work.
  recon: {
    inspection: { type: string | null; passed: boolean; date: string | null } | null;
    detailed: boolean;
    detailDate: string | null;
    workItems: string[];
    thirdParty: { product: string; company: string }[];
    photos: string[];
  } | null;
  // Market
  marketAvg: number | null;
  marketLow: number | null;
  marketHigh: number | null;
  belowMarket: number | null;
  viewCount: number | null;
  dom: number | null;
  // Enrichment (pulled at ingest by vehicle-enrich)
  marketMeta: { percentile: number | null; radius: number | null; similarCount: number | null; avgDom: number | null; daysSupply: number | null; inventoryCount: number | null; checkedAt: string | null };
  comparables: { vin?: string | null; ymm?: string | null; trim?: string | null; miles?: number | null; price?: number | null; dist?: number | null; dealer?: string | null; dom?: number | null; image?: string | null }[];
  blackbook: { tradeinClean: number | null; retailClean: number | null; wholesaleClean: number | null; available: boolean } | null;
  marketCheckedAt: string | null;
  // VIN listing history (from MarketCheck History-by-VIN, pulled at ingest)
  history: {
    available: boolean;
    entries: { price: number | null; miles: number | null; seller_type: string | null; inventory_type: string | null; dealer: string | null; first_seen: string | null; last_seen: string | null }[];
    owners: number | null;
    inServiceDate: string | null;
    firstSeen: string | null;
  } | null;
  // History
  ownerCount: number | null;
  accidentCount: number | null;
  cleanTitle: boolean;
  serviceCount: number;
  recallClear: boolean;
  openRecalls: number | null;
  hasRecallCheck: boolean;
  // Warranty
  warranty: NonNullable<VehicleListing["warranty_info"]>;
  warrantyStr: string | null;
  // Full OEM coverage breakdown for new/CPO cars (from the dealer's verified
  // Factory & CPO terms, attached by public-listing-view). Drives the
  // factory-warranty slide-out's full presentation.
  oemWarranty: OemWarrantyView | null;
  // Confidence
  confScore: number | null;
  confLabel: string;
  verifiedBy: string[];
  verifyRows: VerifyRow[];
  // Content
  highlights: Highlight[];
  specRows: [string, string | null | undefined][];
  keySpecs: [string, string][];
  overview: string;
  whyBuy: string[];
  // Reviews
  reviewRating: number | null;
  reviewCount: number | null;
  reviewUrl: string;
  // Dealer
  dealer: Record<string, unknown>;
  dealerName: string;
  dealerPhone: string;
  dealerAddress: string;
  // Offers
  offers: { title: string; body: string; exp: string }[];
  // Price history (real captured snapshots from vehicle_value_history)
  valueHistory: { captured_at: string; market_value: number | null; listing_price: number | null; below_market: number | null; position: string | null }[];
  priceChange7d: number | null;   // listing_price delta vs ~7 days ago (negative = drop)
  priceChangeTotal: number | null; // delta since first capture
  // Dealer-entered trust content (from public-listing-view → dealer_trust)
  dealerTrust: {
    yearsInBusiness: string;
    satisfaction: string;
    bbbRating: string;
    googleRating: string;
    googleCount: string;
    certifications: string[];
    storefrontUrl: string;
    reviewSources: { name: string; rating: number | null; quote: string }[];
    advisorName: string;
    advisorTitle: string;
    advisorPhoto: string;
    advisorResponse: string;
    familyOwned: boolean;
    serviceLocation: string;   // "onsite" | "offsite" | ""
    serviceAddress: string;
    delivery: string;          // "none" | "local" | "regional" | "nationwide" | ""
    financing: boolean;
    amenities: string[];
    services: string[];
    hours: string;
    mobileCtaVariant: string;
  };
}

export interface PricePoint { captured_at: string; market_value: number | null; listing_price: number | null; below_market: number | null; position: string | null }

// Real captured price history (attached to the listing by public-listing-view
// from the vehicle_value_history table). Returns the series plus 7-day and
// total listing-price deltas (negative = price drop).
export const computePriceHistory = (listing: VehicleListing): { valueHistory: PricePoint[]; priceChange7d: number | null; priceChangeTotal: number | null } => {
  const rawHist = (listing as unknown as { value_history?: unknown }).value_history;
  const valueHistory: PricePoint[] = (Array.isArray(rawHist) ? rawHist : []).map((h) => h as Record<string, unknown>).map((h) => ({
    captured_at: String(h.captured_at ?? ""),
    market_value: h.market_value != null ? Number(h.market_value) : null,
    listing_price: h.listing_price != null ? Number(h.listing_price) : null,
    below_market: h.below_market != null ? Number(h.below_market) : null,
    position: (h.position as string) ?? null,
  })).filter((h) => h.captured_at);
  const priced = valueHistory.filter((h) => h.listing_price != null);
  const latestPrice = priced.length ? priced[priced.length - 1].listing_price! : null;
  const priceChangeTotal = priced.length >= 2 && latestPrice != null ? latestPrice - priced[0].listing_price! : null;
  const priceChange7d = (() => {
    if (priced.length < 2 || latestPrice == null) return null;
    const latestT = new Date(priced[priced.length - 1].captured_at).getTime();
    const weekAgo = latestT - 7 * 24 * 60 * 60 * 1000;
    const prior = [...priced].reverse().find((h) => new Date(h.captured_at).getTime() <= weekAgo) ?? priced[0];
    return latestPrice - prior.listing_price!;
  })();
  return { valueHistory, priceChange7d, priceChangeTotal };
};

export const derivePassport = (listing: VehicleListing): PassportData => {
  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  // The MarketCheck pull writes specs into mc_attributes, but key_specs is the
  // column the passport historically read — empty on synced cars. Merge so the
  // shopper page shows engine/drivetrain/MPG/colors from whichever is present.
  const ksRaw = (listing.key_specs || {}) as Record<string, unknown>;
  const ks = {
    ...ksRaw,
    engine: (ksRaw.engine ?? mc.engine ?? undefined) as string | undefined,
    drivetrain: (ksRaw.drivetrain ?? mc.drivetrain ?? undefined) as string | undefined,
    transmission: (ksRaw.transmission ?? mc.transmission ?? undefined) as string | undefined,
    fuel: (ksRaw.fuel ?? mc.fuel_type ?? undefined) as string | undefined,
    mpg_city: (ksRaw.mpg_city ?? mc.city_mpg ?? undefined) as number | undefined,
    mpg_hwy: (ksRaw.mpg_hwy ?? mc.highway_mpg ?? undefined) as number | undefined,
    exterior_color: (ksRaw.exterior_color ?? mc.exterior_color ?? undefined) as string | undefined,
    interior_color: (ksRaw.interior_color ?? mc.interior_color ?? undefined) as string | undefined,
  };
  const mp = listing.market_payload || {};

  const mm = ((listing as unknown as { market_meta?: Record<string, unknown> }).market_meta || {}) as Record<string, unknown>;
  const n = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const marketMeta = {
    percentile: n(mm.price_percentile), radius: n(mm.search_radius), similarCount: n(mm.similar_count),
    avgDom: n(mm.avg_dom), daysSupply: n(mm.market_days_supply), inventoryCount: n(mm.inventory_count),
    checkedAt: (mm.checked_at as string) || null,
  };
  const comparables = Array.isArray((listing as unknown as { comparables?: unknown }).comparables)
    ? ((listing as unknown as { comparables: PassportData["comparables"] }).comparables) : [];
  const bbRaw = (listing as unknown as { blackbook?: Record<string, unknown> }).blackbook || null;
  const blackbook = bbRaw ? {
    tradeinClean: n((bbRaw.tradein as Record<string, unknown>)?.clean),
    retailClean: n((bbRaw.retail as Record<string, unknown>)?.clean),
    wholesaleClean: n((bbRaw.wholesale as Record<string, unknown>)?.clean),
    available: !!bbRaw.available,
  } : null;
  const marketCheckedAt = (listing as unknown as { market_checked_at?: string }).market_checked_at || marketMeta.checkedAt || null;

  const histRaw = (listing as unknown as { history_payload?: Record<string, unknown> }).history_payload || null;
  type HistEntries = NonNullable<PassportData["history"]>["entries"];
  const history: PassportData["history"] = histRaw && histRaw.available ? {
    available: true,
    entries: (Array.isArray(histRaw.entries) ? histRaw.entries : []) as HistEntries,
    owners: n(histRaw.owners),
    inServiceDate: (histRaw.inServiceDate as string) || null,
    firstSeen: (histRaw.firstSeen as string) || null,
  } : null;

  // Price / doc-fee model. The customer-facing price follows the tenant's
  // price_display_mode (default advertised_before_doc — Harte INFINITI's
  // default, which keeps the historic behavior of showing listing.price). The
  // doc fee is disclosed separately by the surface; market math compares on the
  // same value the dealer displays.
  const lp = listing as unknown as {
    advertised_price_before_doc?: number | null; doc_fee?: number | null; website_sale_price?: number | null; price_display_mode?: unknown;
  };
  const priceMode: PriceDisplayMode = getPriceDisplayMode({ price_display_mode: lp.price_display_mode });
  const advBeforeDoc = lp.advertised_price_before_doc ?? listing.price ?? null;
  const docFee = lp.doc_fee ?? null;
  const websiteSalePrice = lp.website_sale_price ?? (advBeforeDoc != null ? advBeforeDoc + (docFee ?? 0) : null);
  const price = resolveDisplayPrice(
    { advertised_price_before_doc: advBeforeDoc, doc_fee: docFee, website_sale_price: websiteSalePrice, price: listing.price },
    priceMode,
  );
  const priceIncludesDoc = priceMode === "website_sale_price";
  const msrp = (mc.msrp as number) ?? null;
  const marketAvg = listing.market_value ?? null;
  const marketHigh = (mp.high as number) ?? null;
  const marketLow = (mp.low as number) ?? null;
  const belowMarket = (mp.belowMarket as number) ?? (marketAvg != null && price != null && price < marketAvg ? marketAvg - price : null);
  const priceLabel = (dealer.price_label as string) || "Our Price";
  const saveVsMsrp = msrp != null && price != null && msrp > price ? msrp - price : null;
  const estMonthly = (() => {
    if (price == null) return null;
    const r = 0.0749 / 12, n = 72, principal = price * 0.9;
    const m = Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
    return isFinite(m) ? m : null;
  })();

  // A brand-new car has had no prior owners. For everything else, only trust a
  // real owner signal (MarketCheck owner_count or a CARFAX one-owner flag) —
  // never the listing-history "owners" estimate, which counts distinct dealer
  // listing spells (a car relisted by 12 dealers is NOT a 12-owner car).
  const isNew = String((listing as { condition?: string }).condition || "").toLowerCase() === "new";
  const ownerCount = isNew ? 0 : ((mc.owner_count as number) ?? (mc.carfax_1_owner === true ? 1 : null));
  const accidentCount = (mc.accident_count as number) ?? (mc.carfax_clean_title === true ? 0 : null);
  const cleanTitle = mc.carfax_clean_title === true;
  const serviceCount = listing.service_records?.length ?? 0;
  const recallClear = listing.recall_status === "clear";
  const openRecalls = listing.open_recall_count ?? null;
  const hasRecallCheck = !!listing.recall_status;

  const warranty = listing.warranty_info || {};
  const warrantyStr = (() => {
    const yrs = warranty.factory_months ? Math.round(warranty.factory_months / 12) : null;
    const mi = warranty.factory_miles ? `${(warranty.factory_miles / 1000).toFixed(0)},000 mi` : null;
    return [yrs ? `${yrs} yr` : null, mi].filter(Boolean).join(" / ") || null;
  })();

  const confSignals: { ok: boolean; w: number }[] = [];
  if (typeof mc.carfax_clean_title === "boolean") confSignals.push({ ok: cleanTitle, w: 22 });
  if (accidentCount != null) confSignals.push({ ok: accidentCount === 0, w: 22 });
  if (ownerCount != null) confSignals.push({ ok: ownerCount === 1, w: 16 });
  if (listing.recall_status) confSignals.push({ ok: recallClear, w: 16 });
  if (serviceCount > 0) confSignals.push({ ok: true, w: 12 });
  if (warrantyStr) confSignals.push({ ok: true, w: 12 });
  const confScore = confSignals.length >= 2
    ? Math.min(99, Math.round(60 + (confSignals.reduce((s, x) => s + (x.ok ? x.w : 0), 0) / confSignals.reduce((s, x) => s + x.w, 0)) * 39))
    : null;
  const confLabel = confScore == null ? "" : confScore >= 90 ? "Excellent" : confScore >= 80 ? "Very Good" : confScore >= 70 ? "Good" : "Fair";

  const verifiedBy = [
    { label: "Vehicle History", on: typeof mc.carfax_clean_title === "boolean" || ownerCount != null },
    { label: "MarketCheck", on: marketAvg != null || Object.keys(mc).length > 0 },
    { label: "NHTSA", on: !!listing.recall_status },
  ].filter((x) => x.on).map((x) => x.label);

  const verifyRows: VerifyRow[] = [
    { label: "VIN Verified", done: !!listing.vin },
    { label: "Vehicle History", done: typeof mc.carfax_clean_title === "boolean" || ownerCount != null || accidentCount != null },
    { label: "Recall Verification", done: !!listing.recall_status },
    { label: "Market Data", done: marketAvg != null || verifiedBy.includes("MarketCheck") },
    { label: "Title & Brand", done: cleanTitle },
    { label: "Warranty Checked", done: !!warrantyStr },
    { label: "Service History", done: serviceCount > 0 },
  ].filter((r) => r.done);

  const highlights: Highlight[] = [];
  if (ks.engine) highlights.push({ key: "engine", label: ks.engine, sub: "Engine" });
  if (mc.horsepower) highlights.push({ key: "hp", label: `${mc.horsepower} HP`, sub: "Horsepower" });
  if (ks.drivetrain) highlights.push({ key: "drive", label: ks.drivetrain, sub: "Drivetrain" });
  if (ks.transmission) highlights.push({ key: "trans", label: ks.transmission, sub: "Transmission" });
  if (ks.mpg_city && ks.mpg_hwy) highlights.push({ key: "mpg", label: `${ks.mpg_city}/${ks.mpg_hwy} MPG`, sub: "Fuel economy" });
  else if (ks.mpg_city) highlights.push({ key: "mpg", label: `${ks.mpg_city} MPG`, sub: "City" });
  else if (ks.fuel) highlights.push({ key: "fuel", label: ks.fuel, sub: "Fuel" });
  if (ks.exterior_color) highlights.push({ key: "ext", label: ks.exterior_color, sub: "Exterior" });
  listingEquipment(listing).forEach((label, i) => { if (highlights.length < 8) highlights.push({ key: `f${i}`, label, sub: "Feature" }); });

  const overview = listing.description ||
    `The ${listing.ymm}${listing.trim ? " " + listing.trim : ""} pairs a ${ks.engine || "capable"} powertrain with ${ks.drivetrain || "a refined drivetrain"} and a well-equipped cabin.`;

  const specRows: [string, string | null | undefined][] = [
    ["Exterior Color", ks.exterior_color as string | undefined],
    ["Interior Color", ks.interior_color as string | undefined],
    ["Transmission", ks.transmission],
    ["Drivetrain", ks.drivetrain],
    ["Engine", ks.engine],
    ["Fuel Type", ks.fuel],
    ks.mpg_city && ks.mpg_hwy ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`] : ["", null],
  ];

  // Structured key specs (goal's "Key Specifications" card) — real values only.
  const keySpecs = ([
    ["Engine", ks.engine],
    ["Horsepower", mc.horsepower ? `${mc.horsepower} HP` : null],
    ["Transmission", ks.transmission],
    ["Drivetrain", ks.drivetrain],
    ["Fuel Economy", ks.mpg_city && ks.mpg_hwy ? `${ks.mpg_city}/${ks.mpg_hwy} MPG` : ks.fuel || null],
    ["Exterior Color", ks.exterior_color],
    ["Interior Color", ks.interior_color],
    ["Seats", (mc.seating as string | number) ? `${mc.seating}-Passenger` : null],
  ] as [string, unknown][]).filter(([, v]) => v).map(([k, v]) => [k, String(v)] as [string, string]);

  const whyBuy: string[] = [];
  if (saveVsMsrp) whyBuy.push(`Priced ${fmt$(saveVsMsrp)} below MSRP`);
  if (belowMarket && belowMarket > 0) whyBuy.push(`${fmt$(belowMarket)} below market average`);
  if (warrantyStr) whyBuy.push("Factory warranty remaining");
  if (recallClear) whyBuy.push("No open recalls");
  whyBuy.push("Dealer-verified listing");
  if (ownerCount === 1) whyBuy.push("One owner — personal use");
  if (listing.mileage != null && listing.mileage < 30000) whyBuy.push(`Low mileage — ${listing.mileage.toLocaleString()} mi`);
  if (listing.trim && /luxe|autograph|limited|platinum|premium|touring|sport|signature|reserve|titanium|sensory|denali/i.test(listing.trim)) whyBuy.push(`Premium trim — ${listing.trim}`);
  if (cleanTitle && accidentCount === 0) whyBuy.push("Clean vehicle history");
  else if (accidentCount === 0) whyBuy.push("No accidents reported");
  if (/awd|4wd|4x4/i.test(String(ks.drivetrain || ""))) whyBuy.push(`${ks.drivetrain} — all-weather confidence`);

  const rawOffers = (listing as unknown as { incentives?: unknown }).incentives ?? (mc as { incentives?: unknown }).incentives;
  const offers = (Array.isArray(rawOffers) ? rawOffers : []).map((o) => o as Record<string, unknown>).map((o) => ({
    title: (o.title as string) || (o.program as string) || "Offer",
    body: (o.summary as string) || (o.description as string) || (o.amount ? `$${Number(o.amount).toLocaleString()}` : ""),
    exp: o.valid_through ? `Expires ${new Date(o.valid_through as string).toLocaleDateString()}` : "",
  })).filter((o) => o.body).slice(0, 6);

  const { valueHistory, priceChange7d, priceChangeTotal } = computePriceHistory(listing);

  const t = (listing as unknown as { dealer_trust?: Record<string, string> }).dealer_trust ?? {};
  const dealerTrust = {
    yearsInBusiness: t.years_in_business || "",
    satisfaction: t.satisfaction || "",
    bbbRating: t.bbb_rating || "",
    googleRating: t.google_rating || "",
    googleCount: t.google_count || "",
    certifications: (t.certifications || "").split(",").map((c) => c.trim()).filter(Boolean),
    storefrontUrl: t.storefront_url || "",
    reviewSources: (t.review_sources || "").split("\n").map((line) => {
      const [name, rating, ...rest] = line.split("|").map((p) => p.trim());
      return { name: name || "", rating: rating ? Number(rating) : null, quote: rest.join(" | ") };
    }).filter((r) => r.name),
    advisorName: t.advisor_name || "",
    advisorTitle: t.advisor_title || "",
    advisorPhoto: t.advisor_photo || "",
    advisorResponse: t.advisor_response || "",
    familyOwned: t.family_owned === "yes",
    serviceLocation: t.service_location || "",
    serviceAddress: t.service_address || "",
    delivery: t.delivery || "",
    financing: t.financing === "yes",
    amenities: (t.amenities || "").split(",").map((a) => a.trim()).filter(Boolean),
    services: (t.services || "").split(",").map((a) => a.trim()).filter(Boolean),
    hours: t.hours || "",
    mobileCtaVariant: t.mobile_cta_variant || "dealer_availability",
  };

  return {
    price, msrp, priceLabel, estMonthly, saveVsMsrp,
    docFee, websiteSalePrice, priceMode, priceIncludesDoc,
    recon: (listing as unknown as { recon?: PassportData["recon"] }).recon ?? null,
    marketAvg, marketLow, marketHigh, belowMarket,
    marketMeta, comparables, blackbook, marketCheckedAt, history,
    viewCount: listing.view_count ?? null, dom: (mc.dom as number) ?? marketMeta.avgDom ?? null,
    ownerCount, accidentCount, cleanTitle, serviceCount, recallClear, openRecalls, hasRecallCheck,
    warranty, warrantyStr,
    oemWarranty: ((listing as unknown as { oem_warranty?: OemWarrantyView }).oem_warranty) || null,
    confScore, confLabel, verifiedBy, verifyRows,
    highlights, specRows, keySpecs, overview, whyBuy,
    reviewRating: (dealer.review_rating as number) ?? null,
    reviewCount: (dealer.review_count as number) ?? null,
    reviewUrl: (dealer.review_url as string) || (dealer.google_url as string) || (dealer.reviews_url as string) || "",
    dealer,
    dealerName: (dealer.name as string) || "the dealership",
    dealerPhone: (dealer.phone as string) || "",
    dealerAddress: [dealer.address, dealer.city, dealer.state, dealer.zip].filter(Boolean).join(", "),
    offers,
    valueHistory, priceChange7d, priceChangeTotal,
    dealerTrust,
  };
};
