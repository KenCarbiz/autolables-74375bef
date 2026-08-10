// ──────────────────────────────────────────────────────────────────────
// buildNextPassportData — the typed boundary between the passport truth model
// and the next-version layout.
//
// The draft layout at /v-next/:slug owns presentation only. Everything it
// shows is decided HERE, from the same derivePassport / buildPassportSaleCard /
// deriveVerificationReport the live passport uses. A second passport that
// forked the truth model would drift from the live one inside a week — the way
// the new-car addendum drifted from the premium sheet.
//
// The rule that governs every mapping below: MISSING DATA NEVER BECOMES A
// POSITIVE CLAIM. A source that has not answered is "pending"; a source with
// nothing to say is "unavailable". Neither is ever rendered as a fact, and no
// row is emitted for a check that did not run.
// ──────────────────────────────────────────────────────────────────────

import type { PassportData } from "@/lib/passportV2Data";
import type { SalePriceCard } from "@/lib/priceModel";
import type { ReportCheck, VerificationReport, VerificationStatus } from "@/lib/passport/verificationSummary";

/** The status vocabulary the layout renders. */
export type NextStatus = "VERIFIED" | "ACTIVE" | "ESTIMATED" | "PENDING" | "NOT_AVAILABLE" | "ATTENTION";

/** Every data-backed section carries one of these. */
export type NextSectionState = "success" | "loading" | "pending" | "unavailable" | "error";

export interface NextPassportData {
  vehicle: {
    vehicleId: string; vin: string; stock: string;
    year: number | null; make: string; model: string; trim: string;
    mileage: number | null;
    cpo: boolean; cpoLabel: string;
    overview: string;
    photos: string[]; photoCount: number;
    specs: { label: string; value: string }[];
  };
  trustBadges: { label: string; status: NextStatus }[];
  price: {
    state: NextSectionState;
    current: number | null;
    lines: { label: string; value: number; negative?: boolean; strong?: boolean }[];
    total: { label: string; value: number } | null;
    disclosure: string;
  };
  payment: {
    state: NextSectionState;
    monthly: number | null; apr: string; term: string; down: number | null;
    disclosure: string;
  };
  verification: {
    state: NextSectionState;
    verifiedCount: number; pendingCount: number;
    items: { label: string; status: NextStatus; source: string; checked: string }[];
  };
  market: {
    state: NextSectionState;
    similar: number | null; belowMarket: number | null; daysOnMarket: number | null;
    position: number | null; updated: string; note: string;
  };
  reasons: { state: NextSectionState; items: string[] };
  confirm: {
    state: NextSectionState;
    items: { label: string; href?: string; external?: boolean }[];
    note: string;
  };
  timeline: { state: NextSectionState; events: { year: string; label: string; status: NextStatus }[] };
  windowSticker: { state: NextSectionState; previewImage: string; vinSpecific: boolean; url: string };
  warranty: {
    state: NextSectionState;
    estimated: boolean;
    coverages: { key: string; name: string; pct: number | null; color: string; terms: string; remaining: string }[];
  };
}

export interface NextPassportDealer {
  dealer_id: string;
  dealer_name: string;
  dealer_logo: string;
  dealer_hero_image: string;
  dealer_headline: string;
  dealer_subheadline: string;
  founded_year: number | null;
  years_in_business: number | null;
  proof_points: string[];
  recognitions: { name: string; disclosure: string }[];
  learn_more_url: string;
  phone: string;
}

// ── Status ────────────────────────────────────────────────────────────

// dealer_attested is deliberately NOT verified: a franchise store stating it
// never retails branded titles is describing its lot, not this VIN. The layout
// renders it as an explicit dealer statement, not as a checked fact.
const STATUS_BY_CHECK: Record<VerificationStatus, NextStatus> = {
  verified: "VERIFIED",
  dealer_attested: "ESTIMATED",
  needs_attention: "ATTENTION",
  needs_confirmation: "ATTENTION",
  pending: "PENDING",
  unavailable: "NOT_AVAILABLE",
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isFinite(t.getTime())
    ? t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";
};

const SOURCE_LABEL: Record<string, string> = {
  oem_vin: "OEM VIN record",
  vehicle_history: "Vehicle history report",
  nhtsa: "NHTSA",
  live_market: "Live market data",
  oem_warranty: "OEM warranty record",
  dealer: "Dealership",
};

// ── Listing shape, narrowed to what this adapter reads ────────────────

export interface NextPassportListing {
  id?: string | null;
  slug?: string | null;
  vin?: string | null;
  stock_number?: string | null;
  ymm?: string | null;
  trim?: string | null;
  mileage?: number | null;
  condition?: string | null;
  hero_image_url?: string | null;
  dealer_snapshot?: Record<string, unknown> | null;
}

export interface BuildNextPassportArgs {
  d: PassportData;
  listing: NextPassportListing;
  report: VerificationReport;
  saleCard: SalePriceCard | null;
  gallery: string[];
  /** Published OEM window sticker, when one exists for this VIN. */
  windowSticker?: { previewImage?: string | null; url?: string | null } | null;
  /** Dealer packet-module visibility — a module the dealer switched off is
   *  reported unavailable rather than silently rendered empty. */
  isVisible?: (moduleKey: string) => boolean;
}

// ── Vehicle ───────────────────────────────────────────────────────────

const splitYmm = (ymm: string | null | undefined) => {
  const parts = String(ymm || "").trim().split(/\s+/).filter(Boolean);
  const yearRaw = parts[0] && /^\d{4}$/.test(parts[0]) ? Number(parts[0]) : null;
  const rest = yearRaw != null ? parts.slice(1) : parts;
  return { year: yearRaw, make: rest[0] || "", model: rest.slice(1).join(" ") };
};

export function buildNextPassportData(args: BuildNextPassportArgs): NextPassportData {
  const { d, listing, report, saleCard, gallery } = args;
  const pv = args.isVisible || (() => true);
  const condition = String(listing.condition || "").toLowerCase();
  const isNew = condition === "new";
  const isCpo = condition === "cpo" || condition.includes("certified");
  const { year, make, model } = splitYmm(listing.ymm);

  // keySpecs is already the shopper-facing pairs derived from key_specs /
  // mc_attributes, so the layout shows exactly what the live passport shows.
  const specs = d.keySpecs
    .map(([label, value]) => ({ label, value: String(value || "").trim() }))
    .filter((x) => !!x.label && !!x.value);

  return {
    vehicle: {
      vehicleId: String(listing.id || ""),
      vin: String(listing.vin || ""),
      stock: String(listing.stock_number || ""),
      year, make, model, trim: String(listing.trim || ""),
      mileage: listing.mileage ?? null,
      cpo: isCpo,
      cpoLabel: isCpo ? `${make ? `${make} ` : ""}Certified · CPO`.trim() : "",
      overview: d.overview || "",
      photos: gallery,
      photoCount: gallery.length,
      specs,
    },

    trustBadges: buildTrustBadges({ report, isCpo, make, d }),
    price: buildPrice(saleCard, d),
    payment: buildPayment(d),
    verification: buildVerification(report),
    market: buildMarket(d, pv),
    reasons: buildReasons({ d, report, isCpo, make }),
    confirm: buildConfirm(listing),
    timeline: buildTimeline(d),
    windowSticker: buildWindowSticker(args),
    warranty: buildWarranty({ d, listing, isNew, pv }),
  };
}

// ── Trust badges ──────────────────────────────────────────────────────

/**
 * Three or four badges, and every one has to be earned. A check that is pending
 * or unavailable produces NO badge — the absence of a badge is honest, an
 * unearned badge is not.
 */
function buildTrustBadges({ report, isCpo, make, d }: {
  report: VerificationReport; isCpo: boolean; make: string; d: PassportData;
}): { label: string; status: NextStatus }[] {
  const verified = (key: string) => report.checks.find((c) => c.key === key)?.status === "verified";
  const badges: { label: string; status: NextStatus }[] = [];

  if (report.valid && verified("history")) badges.push({ label: "Vehicle History Verified", status: "VERIFIED" });
  if (d.marketAvg != null && !d.marketBasisWeak) badges.push({ label: "Market Data Verified", status: "VERIFIED" });
  if (d.warrantyStr && !d.warrantyExpired) badges.push({ label: "Factory Warranty Active", status: "ACTIVE" });
  if (isCpo) badges.push({ label: `${make ? `${make} ` : ""}Certified · CPO`.trim(), status: "VERIFIED" });
  if (badges.length < 3 && d.ownerCount === 1) badges.push({ label: "One Owner Reported", status: "VERIFIED" });
  if (badges.length < 3 && verified("recalls")) badges.push({ label: "No Open Recalls", status: "VERIFIED" });

  return badges.slice(0, 4);
}

// ── Price ─────────────────────────────────────────────────────────────

/**
 * The fee-inclusive backward derivation, straight from buildPassportSaleCard.
 * No arithmetic happens here — a second implementation of the ladder is exactly
 * how two passports end up quoting two prices for one car.
 *
 * The anchor row is labelled "Market Reference" for used and CPO: "Market
 * Value" next to a lower asking price invites the reading that the shopper is
 * saving the difference, which is depreciation, not a discount.
 */
function buildPrice(card: SalePriceCard | null, d: PassportData): NextPassportData["price"] {
  const disclosure =
    "Price excludes taxes, title, registration and any charge not itemized above. Final terms from the dealership.";
  if (!card || !card.reconciles) {
    return {
      state: d.price != null ? "success" : "unavailable",
      current: d.price,
      lines: [],
      total: d.price != null ? { label: "Total Advertised Price", value: d.price } : null,
      disclosure,
    };
  }

  const lines = card.lines.map((l) => ({
    label: l.label === "Market Value" ? "Market Reference" : l.label,
    value: l.amount,
    negative: l.amount < 0,
  }));
  lines.push({ label: "Vehicle Selling Price", value: card.vehicleSellingPrice, negative: false });
  if (card.feeAmount != null && card.feeAmount > 0) {
    lines.push({ label: `+ ${card.feeLabel || "Dealer Doc Fee"}`, value: card.feeAmount, negative: false });
  }

  return {
    state: "success",
    current: card.totalAdvertisedPrice,
    lines,
    total: { label: "Total Advertised Price", value: card.totalAdvertisedPrice },
    disclosure,
  };
}

// ── Payment ───────────────────────────────────────────────────────────

/** An illustration, never an approval, offer, or commitment. Absent unless the
 *  dealership enabled payment display. */
function buildPayment(d: PassportData): NextPassportData["payment"] {
  return {
    state: d.estMonthly != null ? "success" : "unavailable",
    monthly: d.estMonthly,
    apr: "", term: "", down: null,
    disclosure: d.paymentAssumptions
      ? `${d.paymentAssumptions}. Estimate only — not an offer, approval, or final payment. Taxes, title, fees and trade equity not included.`
      : "Estimate only — not an offer, approval, or final payment.",
  };
}

// ── Verification ──────────────────────────────────────────────────────

function buildVerification(report: VerificationReport): NextPassportData["verification"] {
  if (!report.valid) {
    return { state: "unavailable", verifiedCount: 0, pendingCount: 0, items: [] };
  }
  const items = report.checks.map((c: ReportCheck) => ({
    label: c.name,
    status: STATUS_BY_CHECK[c.status] || "NOT_AVAILABLE",
    source: SOURCE_LABEL[c.family] || "",
    checked: fmtDate(c.checkedAt),
  }));
  return {
    state: "success",
    verifiedCount: report.verifiedChecks,
    pendingCount: report.pendingChecks,
    items,
  };
}

// ── Market ────────────────────────────────────────────────────────────

/**
 * A weak basis (the legacy model-wide comps median, which is mileage- and
 * trim-blind) may never produce an over/under-market claim: a 12k-mile top trim
 * judged against 60k-mile base cars reads "above market" when it is priced
 * right. The module reports unavailable instead of guessing.
 */
function buildMarket(d: PassportData, pv: (k: string) => boolean): NextPassportData["market"] {
  const usable = pv("market") && d.marketAvg != null && !d.marketBasisWeak;
  const updated = fmtDate(d.marketCheckedAt || d.marketMeta.checkedAt);
  if (!usable) {
    return {
      state: d.marketAvg == null ? "pending" : "unavailable",
      similar: null, belowMarket: null, daysOnMarket: null, position: null,
      updated, note: "",
    };
  }
  const position = (() => {
    if (d.price == null || d.marketAvg == null) return null;
    const low = d.marketLow ?? d.marketAvg * 0.85;
    const high = d.marketHigh ?? d.marketAvg * 1.15;
    return Math.max(0, Math.min(1, (d.price - low) / Math.max(1, high - low)));
  })();
  return {
    state: "success",
    similar: d.marketMeta.likeCount ?? d.marketMeta.similarCount,
    belowMarket: d.belowMarket != null && d.belowMarket > 0 ? d.belowMarket : null,
    daysOnMarket: d.dom,
    position,
    updated,
    note: "",
  };
}

// ── Reasons ───────────────────────────────────────────────────────────

/** Evidence, not marketing. Every line traces to a confirmed record; no
 *  "Amazing Deal", no "Best Choice", no superlatives. */
function buildReasons({ d, report, isCpo, make }: {
  d: PassportData; report: VerificationReport; isCpo: boolean; make: string;
}): NextPassportData["reasons"] {
  const verified = (key: string) => report.checks.find((c) => c.key === key)?.status === "verified";
  const items = ([
    d.belowMarket != null && d.belowMarket > 250 && !d.marketBasisWeak ? "Priced below the local market for comparable vehicles" : null,
    d.ownerCount === 1 ? "One owner reported" : null,
    verified("title") ? "Title verified: clean" : null,
    verified("recalls") ? "No open recalls reported" : null,
    isCpo ? `${make ? `${make} ` : ""}Certified pre-owned`.trim() : null,
    d.serviceCount > 0 ? `${d.serviceCount} service record${d.serviceCount === 1 ? "" : "s"} reported` : null,
    d.warrantyStr && !d.warrantyExpired ? "Factory warranty coverage remaining" : null,
  ].filter(Boolean)) as string[];
  return { state: items.length ? "success" : "unavailable", items };
}

// ── Confirm before purchase ───────────────────────────────────────────

function buildConfirm(listing: NextPassportListing): NextPassportData["confirm"] {
  const slug = String(listing.slug || "");
  return {
    state: "success",
    items: [
      { label: "View the vehicle history report", href: slug ? `/v/${slug}/vehicle-history` : undefined },
      { label: "View all documents", href: slug ? `/v/${slug}/documents` : undefined },
    ],
    note: "Confirm equipment, coverage and final figures with the dealership before purchase.",
  };
}

// ── Ownership timeline ────────────────────────────────────────────────

/** An inferred date renders as ESTIMATED, never as VERIFIED. */
function buildTimeline(d: PassportData): NextPassportData["timeline"] {
  const h = d.history;
  if (!h?.available) return { state: "pending", events: [] };
  const yearOf = (iso: string | null | undefined) => {
    if (!iso) return "";
    const t = new Date(iso);
    return Number.isFinite(t.getTime()) ? String(t.getFullYear()) : "";
  };
  const events: { year: string; label: string; status: NextStatus }[] = [];
  if (h.inServiceDate) events.push({ year: yearOf(h.inServiceDate), label: "Placed in service", status: "VERIFIED" });
  if (h.owners != null) {
    events.push({ year: "", label: `${h.owners} owner${h.owners === 1 ? "" : "s"} reported`, status: "VERIFIED" });
  }
  // First-seen is when a listing appeared in the feed, not a recorded arrival
  // date — inferred, so it can only ever be ESTIMATED.
  if (h.firstSeen) events.push({ year: yearOf(h.firstSeen), label: "First listed", status: "ESTIMATED" });
  events.push({ year: "", label: "Available today", status: "ACTIVE" });
  return { state: events.length > 1 ? "success" : "pending", events };
}

// ── Window sticker ────────────────────────────────────────────────────

function buildWindowSticker(args: BuildNextPassportArgs): NextPassportData["windowSticker"] {
  const s = args.windowSticker;
  const url = s?.url || "";
  return {
    state: url || s?.previewImage ? "success" : "unavailable",
    previewImage: s?.previewImage || "",
    vinSpecific: !!url,
    url,
  };
}

// ── Factory warranty ──────────────────────────────────────────────────

/**
 * Bumper-to-Bumper is BLUE and Powertrain is GREEN. These are semantic and
 * locked; they are not a palette choice.
 *
 * Remaining coverage is computed from in-service date, today, current mileage
 * and published limits — it is not returned by the manufacturer — so it is
 * flagged `estimated` and the layout labels it "Estimated remaining".
 */
function buildWarranty({ d, listing, isNew, pv }: {
  d: PassportData; listing: NextPassportListing; isNew: boolean; pv: (k: string) => boolean;
}): NextPassportData["warranty"] {
  const w = d.warranty;
  const show = pv("warranty") && !!d.warrantyStr && (!d.warrantyExpired || d.dealerCoverage.length > 0);
  if (!show) return { state: d.warrantyStr ? "unavailable" : "pending", estimated: true, coverages: [] };

  const calc = (months?: number | null, miles?: number | null) => {
    let timePct: number | null = null, monthsLeft: number | null = null;
    if (w.in_service_date && months) {
      const end = new Date(w.in_service_date);
      end.setMonth(end.getMonth() + months);
      const msLeft = end.getTime() - Date.now();
      monthsLeft = msLeft > 0 ? Math.round(msLeft / (1000 * 60 * 60 * 24 * 30.4)) : 0;
      timePct = Math.max(3, Math.min(100, (monthsLeft / months) * 100));
    }
    const milesLeft = miles != null && miles > 0 && listing.mileage != null ? Math.max(0, miles - listing.mileage) : null;
    const milesPct = miles != null && miles > 0 && listing.mileage != null
      ? Math.max(3, 100 - Math.min(100, (listing.mileage / miles) * 100)) : null;
    const vals = [timePct, milesPct].filter((x): x is number => x != null);
    const pct = vals.length ? Math.round(Math.min(...vals)) : null;
    const terms = [
      months ? `${Math.round(months / 12)} yr` : null,
      miles === -1 ? "Unlimited miles" : miles ? `${(miles / 1000).toFixed(0)}K mi` : null,
    ].filter(Boolean).join(" / ");
    const remaining = [
      monthsLeft == null ? null : monthsLeft >= 12 ? `${Math.round(monthsLeft / 12)} yr` : `${monthsLeft} mo`,
      milesLeft == null ? null : `${(milesLeft / 1000).toFixed(0)}K mi`,
    ].filter(Boolean).join(" / ");
    return { pct: isNew ? 100 : pct, terms, remaining: remaining ? `${remaining} remaining` : "" };
  };

  const coverages: NextPassportData["warranty"]["coverages"] = [];
  const b2b = calc(w.factory_months, w.factory_miles);
  if (b2b.pct != null || b2b.terms) {
    coverages.push({ key: "b2b", name: "Bumper-to-Bumper", color: "bg-blue-600", ...b2b });
  }
  if (w.powertrain_months != null || w.powertrain_miles != null) {
    const pt = calc(w.powertrain_months, w.powertrain_miles);
    coverages.push({ key: "powertrain", name: "Powertrain", color: "bg-green-600", ...pt });
  }
  return { state: coverages.length ? "success" : "unavailable", estimated: !isNew, coverages };
}

// ── Dealer ────────────────────────────────────────────────────────────

/** Arrays, not fixed slots, so zero / one / two awards and a missing hero
 *  image all degrade cleanly for any rooftop. */
export function buildNextPassportDealer(d: PassportData, listing: NextPassportListing): NextPassportDealer {
  const dt = d.dealerTrust;
  const snap = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const name = d.dealerName || String(snap.name || "");
  const years = (() => {
    const n = parseInt(String(dt.yearsInBusiness || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const make = (listing.ymm || "").replace(/^\d{4}\s+/, "").split(/\s+/)[0] || "";
  const authorized = !!make && (
    dt.certifications.some((c) => c.toLowerCase().includes(make.toLowerCase())) ||
    name.toLowerCase().includes(make.toLowerCase())
  );

  return {
    dealer_id: String(snap.id || snap.store_id || ""),
    dealer_name: name,
    dealer_logo: String(snap.logo_url || snap.logo || ""),
    dealer_hero_image: dt.storefrontUrl || "",
    dealer_headline: name ? `Why Buy From ${name}` : "Why buy here",
    dealer_subheadline: "What makes buying here different.",
    founded_year: years != null ? new Date().getFullYear() - years : null,
    years_in_business: years,
    proof_points: ([
      dt.familyOwned ? "Family owned" : null,
      authorized ? `Authorized ${make} retailer` : null,
      dt.serviceLocation === "onsite" ? "On-site service center" : null,
      dt.financing ? "Financing available" : null,
      dt.delivery && dt.delivery !== "none"
        ? `${dt.delivery.charAt(0).toUpperCase()}${dt.delivery.slice(1)} delivery available` : null,
    ].filter(Boolean)) as string[],
    // Every award carries its disclosure in the same object so the disclosure
    // can never be dropped from the one that made the claim.
    recognitions: dt.certifications.map((c) => ({ name: c, disclosure: "Dealer-reported recognition" })),
    learn_more_url: dt.storefrontUrl ? "" : "",
    phone: d.dealerPhone || String(snap.phone || ""),
  };
}
