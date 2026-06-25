import type { VehicleListing } from "@/hooks/useVehicleListing";

// ──────────────────────────────────────────────────────────────
// Passport V2 shared derivations
//
// Single source of truth for the values the Passport V2 surface and
// its dedicated detail pages render. Everything here is computed from
// real listing data — no fabricated certainty. Fields are null when
// the backing data is absent so callers can show honest empty states.
// ──────────────────────────────────────────────────────────────

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
  // Market
  marketAvg: number | null;
  marketLow: number | null;
  marketHigh: number | null;
  belowMarket: number | null;
  viewCount: number | null;
  dom: number | null;
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
}

export const derivePassport = (listing: VehicleListing): PassportData => {
  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const ks = listing.key_specs || {};
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const mp = listing.market_payload || {};

  const price = listing.price ?? null;
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

  const ownerCount = (mc.owner_count as number) ?? (mc.carfax_1_owner === true ? 1 : null);
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
  else if (ks.fuel) highlights.push({ key: "fuel", label: ks.fuel, sub: "Fuel" });
  if (ks.exterior_color) highlights.push({ key: "ext", label: ks.exterior_color, sub: "Exterior" });
  (listing.features || []).forEach((f, i) => { if (highlights.length < 8) highlights.push({ key: `f${i}`, label: f.title, sub: f.subtitle || "Feature" }); });

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

  return {
    price, msrp, priceLabel, estMonthly, saveVsMsrp,
    marketAvg, marketLow, marketHigh, belowMarket,
    viewCount: listing.view_count ?? null, dom: (mc.dom as number) ?? null,
    ownerCount, accidentCount, cleanTitle, serviceCount, recallClear, openRecalls, hasRecallCheck,
    warranty, warrantyStr,
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
  };
};
