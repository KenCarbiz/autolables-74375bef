// GENERATED — do not edit.
// Mirror of src/lib/marketPass/pageView.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { VehicleListing } from "../vehicleListingType.ts";
import {
  derivePassport, fmt$, historyReportName, suppressPassportMarketClaim, compSampleView, listingEquipment,
  type PassportData,
} from "../passportV2Data.ts";
import { listingGallery } from "../photos.ts";
import { packetVisible } from "../packetModules.ts";
import { buildPassportSaleCard } from "../passport/saleCard.ts";
import {
  deriveVerificationReport, summarizeVerificationExceptions, isSettledCheck, recallHeadline, verificationScopeLine,
  verificationStatusCounts, VERIFICATION_STATUS_LABEL, VERIFICATION_CHECK_SHORT_LABEL,
  type ReportCheck, type VerificationReport, type VerificationStatus,
} from "../passport/verificationSummary.ts";
import { resolveMarketComparison } from "../passport/marketComparison.ts";
import { normalizeComparables } from "../passport/comparables.ts";
import { resolveFuelEconomy, FUEL_MODULE_HEADING } from "../passport/fuelEconomy.ts";
import { resolveStickyButtons, type StickyBottomButtons } from "../stickyButtons.ts";
import { CUSTOMER_UNAVAILABLE_MESSAGE, chargeTreatment, formatPayment, estimateAssumptionLine } from "../payment/estimator.ts";
import { identityFromListing } from "../vehicleIdentity.ts";
import { publicMarketClaimForListing, MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE } from "../market/publicClaim.ts";
import { oemCoverageRows } from "../oemWarranty.ts";
import { availabilityCopy, readPassportAvailability, PURCHASE_ACTION_KEYS } from "../../../listingDisposition.ts";
import { projectPublicListing } from "../../../publicListingProjection.ts";
import { applyRecallProjection, scrubTitleVerification } from "../../../lotFeedRow.ts";
import {
  MARKETPASS_PAGE_CONTRACT_VERSION,
  type MarketPassPageView, type PvAbout, type PvAction, type PvActionCenter, type PvAvailability, type PvConfirmBeforePurchase,
  type PvDocumentLink, type PvDocuments, type PvEquipment, type PvFooter, type PvFuelEconomy, type PvHeader, type PvHero,
  type PvHistory, type PvMarketComparison, type PvMarketIntelligence, type PvMoney, type PvOverview, type PvPayment,
  type PvPhotos, type PvPrice, type PvSimilarVehicles, type PvSpecs, type PvStickyRail, type PvStrengths,
  type PvTone, type PvVerification, type PvVerifiedCard, type PvWarranty, type PvWarrantyBar, type PvWhyBuy,
} from "./pageViewTypes.ts";

export * from "./pageViewTypes.ts";

/** The published window sticker as usePublishedWindowSticker reads it (get_published_documents_public). */
export interface PageViewWindowSticker {
  pdfUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
}

export interface PageViewOptions {
  nowMs?: number;
  windowSticker?: PageViewWindowSticker | null;
}

type Row = Record<string, unknown>;

const LOCALE = "en-US";
const num = (n: number): string => n.toLocaleString(LOCALE);
const money = (n: number): PvMoney => ({ amount: n, display: fmt$(n) });
const moneyOrNull = (n: number | null | undefined): PvMoney | null => (n == null ? null : money(n));
const dateDisplay = (iso: string | null | undefined): string | null => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return new Date(iso).toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

/**
 * The row the customer Passport receives: public-listing-view's explicit
 * allow-list projection, the title-attestation scrub, then the recall
 * projection. Applying it to a row that already went through it changes
 * nothing, so the endpoint may hand over either a raw or a shipped row.
 */
export function toPublicListing(row: unknown): Row {
  const shipped = projectPublicListing(row) as Row;
  if (shipped.title_verification) shipped.title_verification = scrubTitleVerification(shipped.title_verification);
  applyRecallProjection(shipped);
  return shipped;
}

// ── Dealer trust (the "Why Buy From" logic the page computes inline) ────────
export interface DealerTrustSummary {
  years: number | null;
  foundedYear: number | null;
  authorizedByMake: boolean;
  benefits: string[];
}

export function summarizeDealerTrust(
  d: Pick<PassportData, "dealerTrust" | "dealerName">,
  makeName: string,
  currentYear: number,
): DealerTrustSummary {
  const dt = d.dealerTrust;
  const dealerName = d.dealerName || "";
  const n = parseInt(String(dt.yearsInBusiness || "").replace(/[^\d]/g, ""), 10);
  const years = Number.isFinite(n) && n > 0 ? n : null;
  const foundedYear = years != null ? currentYear - years : null;
  const authorizedByMake = !!makeName && (
    dt.certifications.some((c) => c.toLowerCase().includes(makeName.toLowerCase())) ||
    dealerName.toLowerCase().includes(makeName.toLowerCase())
  );
  const benefits = ([
    dt.familyOwned ? "Family owned" : null,
    authorizedByMake ? `Authorized ${makeName} retailer` : null,
    dt.serviceLocation === "onsite" ? "On-site service center" : null,
    dt.financing ? "Financing available" : null,
    dt.delivery && dt.delivery !== "none" ? `${dt.delivery.charAt(0).toUpperCase()}${dt.delivery.slice(1)} delivery available` : null,
  ].filter(Boolean)) as string[];
  return { years, foundedYear, authorizedByMake, benefits };
}

// ── AutoLabels Verified card (logic the component keeps private) ────────────
const GRID_LABEL: Record<string, string> = {
  vin: "VIN", history: "Vehicle history", ownership: "Ownership", odometer: "Odometer",
  title: "Title & brand", recall: "Recall status", market: "Market value", warranty: "Warranty",
};
const labelFor = (c: ReportCheck): string => GRID_LABEL[c.key] ?? c.name;
const rank = (s: VerificationStatus): number =>
  s === "needs_attention" ? 0 : s === "needs_confirmation" ? 1 : s === "pending" ? 2 : 3;
const toneOf = (c: ReportCheck): "red" | "amber" | "gray" =>
  c.status === "needs_attention" && c.highSeverity ? "red" : c.status === "unavailable" ? "gray" : "amber";

const attentionLine = (c: ReportCheck): string => {
  if (c.key === "recall") return recallHeadline(c);
  switch (c.status) {
    case "needs_attention":
      return c.key === "title" ? "Title brand on record" : c.key === "history" ? "Reported accident history" : "Needs attention";
    case "needs_confirmation":
      return c.key === "odometer" ? "Mileage records require review" : c.key === "vin" ? "Identity needs confirmation" : "Needs confirmation";
    case "pending": return "Pending · no result yet";
    case "unavailable": {
      const miles = typeof c.facts?.reportedMiles === "number" ? (c.facts.reportedMiles as number) : null;
      if (c.key === "odometer" && miles != null) return `${miles.toLocaleString(LOCALE)} mi reported · history not verified`;
      if (c.key === "vin" && c.facts?.formatValid) return "VIN on record · decode not verified";
      if (c.key === "title" && c.facts?.dealerPolicy) return "Not available · dealer policy only";
      return "Not available · no source data";
    }
    default: return "";
  }
};

export function buildVerifiedCardView(report: VerificationReport): PvVerifiedCard {
  const reviewCount = report.needsAttentionChecks + report.needsConfirmationChecks;
  const allVerified = report.totalChecks > 0 && report.verifiedChecks === report.totalChecks;
  const attention = report.checks
    .filter((c) => !isSettledCheck(c.status))
    .sort((a, b) => rank(a.status) - rank(b.status));
  return {
    title: "Vehicle data verification",
    scopeLine: verificationScopeLine(report),
    badge: allVerified ? "All verified" : reviewCount > 0 ? `${reviewCount} to review` : null,
    allVerified,
    tiles: verificationStatusCounts(report).map((t) => ({ status: t.status, label: t.label, count: t.count })),
    attention: attention.map((c) => ({
      key: c.key,
      label: labelFor(c),
      line: attentionLine(c),
      tone: toneOf(c),
      actionLabel: c.status === "needs_attention" || c.status === "needs_confirmation" ? "Review" : "Details",
    })),
    passed: report.checks.filter((c) => isSettledCheck(c.status)).map((c) => ({
      key: c.key,
      label: c.status === "dealer_attested" && c.key === "title" ? "Title (dealer)" : `${labelFor(c)}${c.status === "dealer_attested" ? " (dealer)" : ""}`,
      dealerAttested: c.status === "dealer_attested",
    })),
    reportLinkLabel: "Open Full Verification Report",
  };
}

// ── Documents (the Documents drawer's list, minus signed and deal paper) ────
// Signed and deal paper is kept with the vehicle for the customer who signed it
// and is not part of a public read of the Passport.
const SIGNED_RECORD = /sign|addendum|disclosure|purchase|buyers?_?order|retail_?installment|contract|agreement|credit|financ/i;

export function collectDocumentLinks(listing: Row, d: PassportData): PvDocumentLink[] {
  const rows: PvDocumentLink[] = [];
  const stored = ((listing.documents as { type?: string; name?: string; url?: string }[] | undefined) || [])
    .filter((x) => x?.name && x?.url)
    .filter((x) => (x.type === "window_sticker" ? packetVisible(listing, "oemSticker") : packetVisible(listing, "documents")));

  for (const doc of stored) {
    if (SIGNED_RECORD.test(String(doc.type || ""))) continue;
    rows.push({
      key: `stored:${doc.type}:${doc.name}`,
      title: doc.name as string,
      source: "Dealer-provided",
      scope: "VIN-specific",
      availability: "Available now",
      url: doc.url as string,
      external: false,
      why: "The dealership attached this record to this specific vehicle.",
    });
  }

  const brand = identityFromListing(listing as never).make;
  const hist = d.historyReport && packetVisible(listing, "historyReport") ? d.historyReport : null;
  if (hist) {
    rows.push({
      key: "history",
      title: `${historyReportName(hist.provider)} Vehicle History Report`,
      source: historyReportName(hist.provider),
      scope: "VIN-specific",
      availability: "External source",
      url: hist.url,
      external: true,
      why: "An independent record of title, ownership, odometer and reported damage for this VIN.",
    });
  }

  const brochure = (listing as { oem_brochure?: { url?: string; year?: number } }).oem_brochure;
  if (brochure?.url && packetVisible(listing, "brochure")) {
    rows.push({
      key: "brochure",
      title: `Official ${brand.toUpperCase()} Brochure${brochure.year ? ` (${brochure.year})` : ""}`,
      source: `${brand} (manufacturer)`,
      scope: "Model-level",
      availability: "External source",
      url: brochure.url,
      external: true,
      why: "The manufacturer's own description of this model year's trims, packages and equipment.",
    });
  }

  const manual = (listing as { oem_owners_manual?: { url?: string; year?: number } }).oem_owners_manual;
  const manualStored = stored.some((x) => x.type === "owners_manual");
  if (manual?.url && packetVisible(listing, "ownersManual") && !manualStored) {
    rows.push({
      key: "manual",
      title: `Official ${brand.toUpperCase()} Owner's Manual${manual.year ? ` (${manual.year})` : ""}`,
      source: `${brand} (manufacturer)`,
      scope: "Model-level",
      availability: "External source",
      url: manual.url,
      external: true,
      why: "Operating, maintenance and warning information for this model year.",
    });
  }

  const oemSticker = listing.oem_sticker_url as string | null | undefined;
  if (oemSticker && packetVisible(listing, "oemSticker") && !stored.some((x) => x.type === "window_sticker")) {
    rows.push({
      key: "oem-sticker",
      title: "Original OEM Window Sticker",
      source: "Manufacturer",
      scope: "VIN-specific",
      availability: "External source",
      url: oemSticker,
      external: true,
      why: "The factory Monroney label showing how this exact VIN was built and priced when new.",
    });
  }
  return rows;
}

// ── Warranty coverage bars (the mobile card's remaining-coverage math) ──────
function warrantyBars(d: PassportData, listing: Row, isNew: boolean, nowMs: number): PvWarrantyBar[] {
  const w = d.warranty;
  const mileage = listing.mileage as number | null | undefined;
  const calc = (months?: number | null, miles?: number | null) => {
    let timePct: number | null = null, monthsLeft: number | null = null;
    if (w.in_service_date && months) {
      const end = new Date(w.in_service_date); end.setMonth(end.getMonth() + months);
      const msLeft = end.getTime() - nowMs;
      monthsLeft = msLeft > 0 ? Math.round(msLeft / (1000 * 60 * 60 * 24 * 30.4)) : 0;
      timePct = Math.max(3, Math.min(100, (monthsLeft / months) * 100));
    }
    const milesLeft = miles != null && miles > 0 && mileage != null ? Math.max(0, miles - mileage) : null;
    const milesPct = miles != null && miles > 0 && mileage != null ? Math.max(3, 100 - Math.min(100, (mileage / miles) * 100)) : null;
    const vals = [timePct, milesPct].filter((x): x is number => x != null);
    const remainPct = vals.length ? Math.round(Math.min(...vals)) : null;
    const yrs = monthsLeft == null ? null : monthsLeft >= 12 ? `${Math.round(monthsLeft / 12)} yr` : `${monthsLeft} mo`;
    const milesLbl = milesLeft == null ? null : `${(milesLeft / 1000).toFixed(0)}K mi`;
    const fullTerm = [months ? `${Math.round(months / 12)} yr` : null, miles === -1 ? "Unlimited" : miles ? `${(miles / 1000).toFixed(0)}K mi` : null].filter(Boolean).join(" / ");
    const remainLbl = [yrs, milesLbl].filter(Boolean).join(" / ");
    return { pct: isNew ? 100 : remainPct, label: isNew ? (fullTerm || null) : (remainLbl ? `${remainLbl} left` : null) };
  };
  const bars: PvWarrantyBar[] = [];
  const b2b = calc(w.factory_months, w.factory_miles);
  if (b2b.pct != null) bars.push({ key: "bumper_to_bumper", label: "Bumper-to-Bumper", percent: b2b.pct, text: b2b.label });
  if (w.powertrain_months != null || w.powertrain_miles != null) {
    const ptw = calc(w.powertrain_months, w.powertrain_miles);
    if (ptw.pct != null) bars.push({ key: "powertrain", label: "Powertrain", percent: ptw.pct, text: ptw.label });
  }
  return bars;
}

const MARKET_UNAVAILABLE = "Market comparison temporarily unavailable. Vehicle information and dealer pricing remain available.";

/**
 * One server-side render of what the customer Passport shows for this listing,
 * computed with the same functions the page calls. A consumer renders these
 * fields; it never derives a price, status or count of its own.
 */
export function buildMarketPassPageView(row: unknown, opts: PageViewOptions = {}): MarketPassPageView {
  const nowMs = opts.nowMs ?? Date.now();
  const listing = toPublicListing(row);
  const L = listing as unknown as VehicleListing;
  const rawSlug = String(listing.slug ?? "");

  const marketClaim = publicMarketClaimForListing(listing as never);
  const marketUnavailableCopy = marketClaim.subjectPriceMissing ? MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE : MARKET_UNAVAILABLE;
  const derived = derivePassport(L);
  const d = marketClaim.show ? derived : suppressPassportMarketClaim(derived);
  const gallery = listingGallery(listing);
  const pv = (id: string) => packetVisible(listing, id);

  const report = deriveVerificationReport(d, L);
  const vShow = report.valid && report.totalChecks > 0;
  const vTotal = report.totalChecks;
  const vVerified = report.verifiedChecks;
  const vAllVerified = vTotal > 0 && vVerified === vTotal;
  const vSummary = summarizeVerificationExceptions(report);
  const statusOf = (key: string) => report.checks.find((c) => c.key === key)?.status;
  const recallVerified = statusOf("recall") === "verified";
  const marketVerified = statusOf("market") === "verified";
  const titleVerified = statusOf("title") === "verified";
  const historyOnRecord = report.checks.some((c) => (c.key === "history" || c.key === "ownership") && c.status !== "pending" && c.status !== "unavailable");

  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const dealerLogo = (dealer.logo_url as string) || (dealer.logo as string) || "";
  const dealerName = d.dealerName || "";
  const condition = String((listing.condition as string) || "").toLowerCase();
  const isNew = condition === "new";
  const conditionLabel = isNew ? "New" : condition === "cpo" ? "Certified Pre-Owned" : "Used";
  const price = d.price;
  const mileage = (listing.mileage as number | null | undefined) ?? null;
  const title = `${listing.ymm ?? ""}${listing.trim ? ` ${listing.trim}` : ""}`;

  const saleCard = buildPassportSaleCard(d, condition);
  const avail = readPassportAvailability(listing);
  const purchasable = avail.purchasable;
  const availCopy = availabilityCopy(avail, dealerName);
  const availAsOf = dateDisplay(avail.as_of);

  // ── header
  const header: PvHeader = {
    brand: "AutoLabels",
    dealerName,
    dealerLogoUrl: dealerLogo || null,
    dealerAddress: d.dealerAddress || null,
    actions: ["save", "share"],
  };

  // ── hero
  const titleCheckStatus = statusOf("title");
  const trustBadgesMobile = [
    d.ownerCount === 1 ? "One Owner" : null,
    titleCheckStatus === "verified" ? "Clean Title" : null,
    condition === "cpo" ? "CPO Certified" : null,
  ].filter(Boolean) as string[];
  if (marketVerified && trustBadgesMobile.length < 3) trustBadgesMobile.push("Market Data Verified");
  const trustBadgesDesktop = [
    d.ownerCount === 1 ? "One Owner" : null,
    marketVerified ? "Market Data Verified" : null,
  ].filter(Boolean) as string[];
  const hasVideo = Array.isArray(listing.videos) && (listing.videos as unknown[]).length > 0;
  const hero: PvHero = {
    gallery: {
      images: gallery,
      count: gallery.length,
      hasVideo,
      archivedPhotoNote: !purchasable ? "Dealer photos from when this vehicle was advertised. Any sale or promotion shown in them is not a current offer." : null,
    },
    identity: {
      conditionLabel,
      title,
      vin: (listing.vin as string | null | undefined) || null,
      mileage,
      mileageDisplay: mileage != null ? `${num(mileage)} mi` : null,
      trustBadgesDesktop,
      trustBadgesMobile,
    },
    verifiedCard: vShow ? buildVerifiedCardView(report) : null,
  };

  // ── action center
  let priceView: PvPrice;
  if (!purchasable) {
    priceView = {
      mode: "last_advertised",
      label: availCopy?.priceLabel ?? "Last advertised price",
      amount: moneyOrNull(price),
      note: `Not a current offer${availAsOf ? ` · listing ended ${availAsOf}` : ""}`,
    };
  } else if (saleCard && saleCard.reconciles && Number.isFinite(saleCard.totalAdvertisedPrice)) {
    priceView = {
      mode: "breakdown",
      heading: "Today's Sale Price",
      mobileHeading: "Current Price",
      total: money(saleCard.totalAdvertisedPrice),
      lines: saleCard.lines.map((l) => ({
        key: l.key,
        role: l.role,
        label: l.label,
        mobileLabel: l.label === "Market Value" ? "Market Reference" : l.label,
        amount: l.amount,
        display: l.role === "discount" ? `−${fmt$(l.amount)}` : fmt$(l.amount),
      })),
      vehicleSellingPrice: money(saleCard.vehicleSellingPrice),
      fee: saleCard.feeAmount != null && saleCard.feeLabel
        ? { label: `+ ${saleCard.feeLabel}`, amount: saleCard.feeAmount, display: fmt$(saleCard.feeAmount) }
        : null,
      totalAdvertisedPrice: money(saleCard.totalAdvertisedPrice),
      youSave: saleCard.showSavings && saleCard.customerSavings != null ? money(saleCard.customerSavings) : null,
      reconciles: true,
    };
  } else {
    priceView = {
      mode: "headline",
      heading: "Today's Sale Price",
      mobileHeading: "Current Price",
      total: moneyOrNull(saleCard ? saleCard.totalAdvertisedPrice : price),
    };
  }

  const estimatorOn = purchasable && d.paymentEstimator != null;
  const shownEstimate = !purchasable ? null : (d.paymentEstimate.status === "available" ? d.paymentEstimate : null);
  const payMonthly = shownEstimate ? shownEstimate.monthlyPayment : null;
  const payCharges = chargeTreatment(d.priceIncludesDoc);
  const payment: PvPayment = payMonthly != null
    ? {
      state: "available",
      unavailableMessage: null,
      monthly: { amount: payMonthly, display: formatPayment(payMonthly) },
      assumptions: shownEstimate ? estimateAssumptionLine(shownEstimate) || null : null,
      chargesSummary: payCharges.summary,
      disclaimer: `Estimated payment for illustration only, using the dealership's assumed APR. Not a credit approval, a guaranteed rate or a financing offer. ${payCharges.summary}`,
      isCustomized: false,
    }
    : {
      state: estimatorOn ? "unavailable" : "off",
      unavailableMessage: estimatorOn ? CUSTOMER_UNAVAILABLE_MESSAGE : null,
      monthly: null, assumptions: null, chargesSummary: null, disclaimer: null,
      isCustomized: false,
    };

  const watchEnabled = purchasable && (listing as { price_drop_watch?: boolean }).price_drop_watch !== false;
  const actions: PvAction[] = [];
  if (purchasable) {
    actions.push({ key: "test_drive", label: "Schedule Test Drive", group: "primary" });
    actions.push({ key: "reserve", label: "Request Vehicle Hold", group: "secondary" });
  }
  actions.push({ key: "value_trade", label: "Value My Trade", group: "tool" });
  if (estimatorOn) actions.push({ key: "build_payment", label: "Build My Payment", group: "tool" });
  actions.push({ key: "ask_question", label: "Ask a Question", group: "tool" });
  actions.push({ key: "documents", label: "Documents", group: "tool" });
  actions.push({ key: "save", label: "Save", group: "utility" });
  actions.push({ key: "share", label: "Share", group: "utility" });
  if (watchEnabled) actions.push({ key: "watch_price", label: "Watch Price", group: "utility" });

  const nextSteps: PvActionCenter["nextSteps"] = [];
  if (purchasable) nextSteps.push({ key: "reserve", label: "Request Hold" }, { key: "test_drive", label: "Schedule Test Drive" });
  nextSteps.push({ key: "contact", label: "Contact Dealer" }, { key: "print", label: "Print Passport" });

  const actionCenter: PvActionCenter = {
    heading: "Customer Action Center",
    price: priceView,
    payment,
    taxNote: purchasable ? "Sales tax, title, registration and dealer-installed options are not included." : null,
    actions,
    watchPrice: { offered: watchEnabled, formEnabled: watchEnabled },
    dealerCard: dealerName
      ? {
        name: dealerName,
        address: d.dealerAddress || null,
        phone: d.dealerPhone || null,
        availabilityNote: "Confirm current availability with the dealership.",
        meetLabel: `Meet ${dealerName}`,
      }
      : null,
    privacyNote: "Your information is only shared when you choose to contact the dealership.",
    nextSteps,
  };

  // ── verification
  const verification: PvVerification | null = vShow
    ? {
      heading: "Verified Vehicle Data",
      allVerified: vAllVerified,
      totalChecks: vTotal,
      verifiedChecks: vVerified,
      summaryLine: vAllVerified ? `All ${vTotal} checks verified` : `${vVerified} of ${vTotal} checks independently verified · ${vSummary}`,
      checks: report.checks.map((c) => ({
        key: c.key,
        name: VERIFICATION_CHECK_SHORT_LABEL[c.key] || c.name,
        status: c.status,
        statusLabel: VERIFICATION_STATUS_LABEL[c.status],
      })),
      footnote: "AutoLabels Data-Verified Report — records aggregated across data sources. A pending check is never shown as verified.",
    }
    : null;

  // ── market position + intelligence
  const marketPos = (() => {
    if (d.price == null || d.marketAvg == null || d.marketBasisWeak) return null;
    if (d.marketLow == null || d.marketHigh == null || d.marketHigh <= d.marketLow) return null;
    const span = Math.max(1, d.marketHigh - d.marketLow);
    const t = Math.max(0, Math.min(1, (d.price - d.marketLow) / span));
    return { t, label: d.belowMarket != null && d.belowMarket > 250 ? "Below Est. Market" : d.belowMarket != null && d.belowMarket < -250 ? "Above Est. Market" : "Near Est. Market" };
  })();
  const compSample = compSampleView(d.marketMeta);
  const aboveMarket = !d.marketBasisWeak ? d.aboveMarket : null;
  const marketCheckedLabel = dateDisplay(d.marketCheckedAt || d.marketMeta.checkedAt);

  let marketIntelligence: PvMarketIntelligence | null = null;
  if (pv("marketValue")) {
    if (marketPos) {
      const below = d.belowMarket != null && d.belowMarket > 0;
      marketIntelligence = {
        unavailable: false,
        unavailableMessage: null,
        pricePosition: {
          fraction: marketPos.t, percent: Math.round(marketPos.t * 100), label: marketPos.label,
          lowLabel: "Below est. market", highLabel: "Above est. market",
        },
        sample: { label: compSample.analyzed ? "Listings analyzed" : "Matching listings", count: compSample.n, caption: compSample.caption },
        vsMarket: {
          display: below ? fmt$(d.belowMarket) : aboveMarket != null ? fmt$(aboveMarket) : "—",
          caption: below ? "below est. value" : aboveMarket != null ? "above est. value" : "vs est. value",
          tone: below ? "positive" : aboveMarket != null ? "caution" : "neutral",
        },
        estimatedMarketValue: {
          display: d.marketAvg != null ? fmt$(d.marketAvg) : "—",
          caption: d.marketCheckedAt ? "Provider estimate for this VIN" : "—",
        },
        retrievedLabel: marketCheckedLabel ? `Market data retrieved ${marketCheckedLabel}` : null,
        daysListed: {
          value: d.dom != null ? d.dom : d.marketMeta.avgDom != null ? d.marketMeta.avgDom : null,
          caption: d.dom != null ? "this car, per listing feed" : "avg, comparable listings",
        },
      };
    } else {
      marketIntelligence = {
        unavailable: true, unavailableMessage: marketUnavailableCopy,
        pricePosition: null, sample: null, vsMarket: null, estimatedMarketValue: null, retrievedLabel: null, daysListed: null,
      };
    }
  }

  // ── warranty
  const hasInService = !!(d.warranty && (d.warranty as { in_service_date?: string }).in_service_date);
  const warrantyHead = d.warrantyStr ? "Factory warranty terms found" : "Confirm warranty with dealer";
  const warrantySub = hasInService ? (d.warrantyStr || "Coverage on record") : "Remaining eligibility requires confirmation of the in-service date";
  const showWarranty = !!d.warrantyStr && (!d.warrantyExpired || d.dealerCoverage.length > 0);
  const warranty: PvWarranty | null = pv("warranty")
    ? {
      card: { title: "Warranty", head: d.warrantyExpired ? "Coverage ended" : warrantyHead, sub: warrantySub },
      heading: !d.warrantyExpired ? "Factory Warranty" : "Warranty Coverage",
      expired: !!d.warrantyExpired,
      summary: d.warrantyStr || null,
      bars: showWarranty && !d.warrantyExpired ? warrantyBars(d, listing, isNew, nowMs) : [],
      coverageRows: d.oemWarranty ? oemCoverageRows(d.oemWarranty).map((r) => ({ key: r.key, label: r.label, sub: r.sub, term: r.term })) : [],
      dealerCoverage: d.dealerCoverage.map((c) => ({
        title: c.title, coverage: c.coverage, termYears: c.termYears, termMiles: c.termMiles,
        lifetime: c.lifetime, mode: c.mode, offer: c.offer, disclosure: c.disclosure,
      })),
    }
    : null;

  // ── equipment / history / specs
  const equipItems = listingEquipment(L);
  const accessories = ((listing.available_accessories as { name?: string }[] | undefined) || [])
    .map((a) => String(a?.name || "").trim()).filter(Boolean);
  const equipment: PvEquipment = {
    card: { title: "Features & Equipment", head: "Equipment analyzed", sub: "Premium, safety, tech & more" },
    items: equipItems,
    count: equipItems.length,
    availableAccessories: pv("warranty") ? accessories : [],
  };

  const mfgYear = (listing.ymm as string || "").split(" ")[0];
  const timeline = ([
    /^\d{4}$/.test(mfgYear) ? { when: mfgYear, title: "Manufactured", detail: "Factory production" } : null,
    d.warranty.in_service_date ? { when: dateDisplay(d.warranty.in_service_date) || String(d.warranty.in_service_date), title: "Placed in service", detail: "Factory warranty begins" } : null,
    d.ownerCount != null ? {
      when: d.ownerCount === 0 ? "New" : d.ownerCount === 1 ? "Single owner" : `${d.ownerCount} owners`,
      title: d.ownerCount === 0 ? "You'd be the first owner" : "Ownership",
      detail: d.ownerCount === 0 ? "No prior owners" : "Reported ownership on record",
    } : null,
    d.serviceCount > 0 ? { when: `${d.serviceCount} records`, title: "Regular service", detail: "Maintenance on record" } : null,
    { when: "Today", title: "Ready for you", detail: "Available at the dealership" },
  ].filter(Boolean)) as PvHistory["timeline"];
  const history: PvHistory = {
    card: {
      title: "History & Ownership",
      head: titleVerified ? "Clean title on record" : historyOnRecord ? "History records found" : "No history report on file",
      sub: d.ownerCount != null ? `${d.ownerCount === 1 ? "One owner" : `${d.ownerCount} owners`} on record` : "View reported results",
    },
    ownerCount: d.ownerCount,
    timeline: (pv("historyReport") || pv("insights")) && timeline.length > 1 ? timeline : [],
  };

  const specs: PvSpecs = {
    card: { title: "Specifications", head: "Detailed specs", sub: "Engine, dimensions, capacity" },
    rows: d.specRows.filter((r): r is [string, string] => !!r[1]).map(([label, value]) => ({ label, value })),
  };

  // ── strengths
  const strengthItems = ([
    d.ownerCount === 1 ? `One owner reported${d.historyReport ? ` (${historyReportName(d.historyReport.provider)})` : ""}` : d.ownerCount != null && d.ownerCount > 1 ? `${d.ownerCount} owners reported` : null,
    mileage != null ? `${num(mileage)} reported miles` : null,
    listing.trim ? `${listing.trim} trim` : null,
    recallVerified ? "No open recalls for this VIN" : null,
    d.warrantyStr ? "Factory warranty terms found — remaining coverage requires confirmation" : null,
  ].filter(Boolean) as string[]);
  const strengths: PvStrengths = {
    heading: "Vehicle Strengths",
    mobileHeading: "Why This Vehicle Checks Out",
    items: strengthItems.length ? strengthItems : ["Details confirmed at the dealership"],
    reportLinkLabel: "Open Full Buying Report",
  };

  // ── market comparison
  const mc = resolveMarketComparison({
    valueHistory: d.valueHistory, advertisedPrice: price, normalizedMarketValue: d.marketBasisWeak ? null : d.marketAvg,
    sampleSize: d.marketMeta.analyzedCount, radiusMiles: d.marketMeta.radius, checkedAt: d.marketCheckedAt,
  });
  const cur = (n: number) => fmt$(n) || `$${n}`;
  const marketComparison: PvMarketComparison = mc.mode === "unavailable"
    ? {
      mode: "unavailable", unavailableMessage: marketUnavailableCopy, thisVehicle: null, marketValueLabel: null, marketValue: null,
      diffText: null, diffTone: null, diffPercent: null, listingSeries: [], marketSeries: [], hasMarketSeries: false,
      periodLabel: null, chartSummary: null, staticPosition: null, staticPositionNote: null, sampleLine: null, retrievedLine: null, limitation: null,
    }
    : (() => {
      const lbl = mc.marketValueLabel.toLowerCase();
      const first = mc.listingSeries[0], last = mc.listingSeries[mc.listingSeries.length - 1];
      const showPos = !!marketPos && (mc.mode === "static" || (mc.mode === "trend" && !mc.hasMarketSeries));
      return {
        mode: mc.mode,
        unavailableMessage: null,
        thisVehicle: moneyOrNull(mc.advertisedPrice),
        marketValueLabel: mc.marketValueLabel,
        marketValue: moneyOrNull(mc.normalizedMarketValue),
        diffText: mc.diff == null ? null : mc.diff < 0 ? `${fmt$(-mc.diff)} below ${lbl}` : mc.diff > 0 ? `${fmt$(mc.diff)} above ${lbl}` : `At ${lbl}`,
        diffTone: mc.diff == null ? null : (mc.diff < 0 ? "positive" : "neutral") as PvTone,
        diffPercent: mc.diff != null && mc.diffPct != null ? Math.abs(mc.diffPct) : null,
        listingSeries: mc.mode === "trend" ? mc.listingSeries : [],
        marketSeries: mc.mode === "trend" && mc.marketSeries.length >= 2 ? mc.marketSeries : [],
        hasMarketSeries: mc.hasMarketSeries,
        periodLabel: mc.mode === "trend" ? mc.periodLabel : null,
        chartSummary: mc.mode === "trend" && first && last
          ? `This vehicle's listed price moved from ${cur(first.value)} on ${first.at} to ${cur(last.value)} on ${last.at}${mc.marketSeries.length >= 2 ? "; the estimated market value is also shown." : "."}`
          : null,
        staticPosition: showPos && marketPos ? { fraction: marketPos.t, percent: Math.round(marketPos.t * 100), label: marketPos.label } : null,
        staticPositionNote: mc.mode === "trend" && !mc.hasMarketSeries && marketPos
          ? "The line above is this vehicle's advertised-price history. A normalized market-value trend line is not yet available, so the bar below shows its current market position."
          : null,
        sampleLine: mc.sampleSize != null ? `${mc.sampleSize} comparables analyzed${mc.radiusMiles ? ` · ${mc.radiusMiles} mi` : ""}` : null,
        retrievedLine: mc.checkedAt ? `Market data retrieved ${mc.checkedAt.slice(0, 10)}` : null,
        limitation: mc.limitations.length > 0 ? mc.limitations[0] : null,
      };
    })();

  // ── similar vehicles (this rooftop's own offer, never the market set)
  const subjectYear = Number((listing.ymm as string || "").match(/\b(19|20)\d{2}\b/)?.[0]) || null;
  const sims = normalizeComparables(
    { vin: (listing.vin as string | null) ?? null, year: subjectYear, trim: (listing.trim as string | null) ?? null, advertisedPrice: price },
    ((listing as unknown as { group_similar?: typeof d.comparables }).group_similar) ?? [],
  );
  const similarVehicles: PvSimilarVehicles = {
    count: sims.length,
    items: sims.map((c) => ({
      ref: c.id,
      title: c.ymm || "Comparable listing",
      trim: c.trim,
      miles: c.miles,
      distanceMiles: c.dist != null ? Math.round(c.dist) : null,
      detailLine: [c.trim, c.miles != null ? `${num(c.miles)} mi` : null, c.dist != null ? `${Math.round(c.dist)} mi away` : null].filter(Boolean).join(" · "),
      price: money(c.price),
      priceDelta: c.priceDelta,
      priceDeltaLabel: c.priceDeltaLabel,
      matchLabel: c.matchLabel,
      image: c.image,
    })),
    emptyHeadline: sims.length === 0 ? "No close matches found" : null,
    emptyBody: sims.length === 0
      ? (compSample.n != null
        ? `We ${compSample.analyzed ? "analyzed" : "found"} ${compSample.n} ${compSample.analyzed ? "listings" : "matching listings"}, but none met the current year, trim, condition and mileage requirements.`
        : "None met the current year, trim, condition and mileage requirements.")
      : null,
  };

  // ── fuel economy
  const fuel = resolveFuelEconomy(d.epa);
  const epaChecked = (listing as { epa_checked_at?: string }).epa_checked_at;
  const fuelEconomy: PvFuelEconomy = {
    heading: FUEL_MODULE_HEADING,
    available: fuel.available,
    note: fuel.note,
    source: fuel.available ? fuel.source : null,
    checkedAt: fuel.available && fuel.source && epaChecked ? epaChecked.slice(0, 10) : null,
    annualFuelCost: fuel.available && fuel.annualFuelCost != null && fuel.annualFuelCostLabel
      ? { label: fuel.annualFuelCostLabel, amount: money(fuel.annualFuelCost) } : null,
    combinedMpg: fuel.available ? fuel.combinedMpg : null,
    cityMpg: fuel.available ? fuel.cityMpg : null,
    highwayMpg: fuel.available ? fuel.highwayMpg : null,
    rangeMiles: fuel.available ? fuel.rangeMiles : null,
    fuelType: fuel.available ? fuel.fuelType : null,
  };

  // ── why buy from {dealer}
  const dt = d.dealerTrust;
  const trust = summarizeDealerTrust(d, identityFromListing(L).make, new Date(nowMs).getUTCFullYear());
  const whyBuy: PvWhyBuy | null = dealerName
    ? {
      heading: `Why Buy From ${dealerName}`,
      dealerName,
      servingSinceYear: trust.foundedYear,
      yearsInBusiness: trust.years,
      storefrontImageUrl: dt.storefrontUrl || null,
      benefits: trust.benefits,
      benefitsDesktop: trust.benefits.slice(0, 4),
      reviewRating: d.reviewRating,
      reviewCount: d.reviewCount,
      certifications: dt.certifications.slice(0, 4).map((name) => ({ name, caption: "Dealer-reported recognition" })),
      ctaLabel: `Learn more about ${dealerName}`,
      ctaLabelDesktop: `Meet ${dealerName}`,
    }
    : null;

  // ── confirm before purchase
  const recallStatus = statusOf("recall");
  const recallNeedsReview = recallStatus === "needs_confirmation" || recallStatus === "needs_attention";
  const confirmRows = ([
    recallNeedsReview ? {
      title: recallStatus === "needs_confirmation" ? "Recall status needs confirmation" : "Open safety recall reported",
      detail: recallStatus === "needs_confirmation" ? "Sources disagree on this vehicle — confirm the recall status with the dealer before purchase." : "Ask the dealer about the recall remedy before purchase.",
    } : null,
    d.accidentCount != null && d.accidentCount > 0 ? { title: `${d.accidentCount} reported accident${d.accidentCount === 1 ? "" : "s"}`, detail: "Review the full history report and reconditioning work with the dealer." } : null,
    d.titleStatus === "branded" ? { title: "Title brand reported", detail: "Review the title history with the dealer before purchase." } : null,
  ].filter(Boolean)) as { title: string; detail: string }[];
  const histLink = d.historyReport && pv("historyReport") ? d.historyReport : null;
  const confirmBeforePurchase: PvConfirmBeforePurchase | null = confirmRows.length > 0 || histLink
    ? {
      rows: confirmRows,
      historyReport: histLink
        ? {
          url: histLink.url,
          label: histLink.source === "vin" ? `View the ${historyReportName(histLink.provider)} record` : `View the free ${historyReportName(histLink.provider)} Report`,
          providedBy: histLink.source !== "vin" && dealerName ? `Provided at no cost by ${dealerName}` : null,
        }
        : null,
    }
    : null;

  // ── about / overview / photos
  const about: PvAbout | null = d.highlights.length > 0
    ? { highlights: d.highlights.slice(0, 6).map((h) => ({ key: h.key, label: h.label, sub: h.sub || null })) }
    : null;
  const overview: PvOverview | null = d.overview
    ? { text: d.overview.length > 320 ? `${d.overview.slice(0, 320).trimEnd()}…` : d.overview, fullText: d.overview, truncated: d.overview.length > 320 }
    : null;
  const photos: PvPhotos | null = gallery.length > 1 ? { heading: "Photos", images: gallery.slice(0, 6), total: gallery.length } : null;

  // ── documents
  const ws = opts.windowSticker && opts.windowSticker.pdfUrl ? opts.windowSticker : null;
  const documents: PvDocuments = {
    windowSticker: ws
      ? {
        title: "Original Equipment & MSRP Window Sticker",
        description: "VIN-specific manufacturer equipment, options, pricing, fuel-economy, warranty and assembly information.",
        verifiedLabel: "Verified vehicle data",
        format: "PDF",
        updatedAt: ws.publishedAt || null,
        updatedDisplay: dateDisplay(ws.publishedAt),
        pdfUrl: ws.pdfUrl as string,
        thumbnailUrl: ws.thumbnailUrl || null,
        ctaLabel: "View Window Sticker",
      }
      : null,
    links: collectDocumentLinks(listing, d),
  };

  const availability: PvAvailability | null = availCopy
    ? {
      disposition: avail.disposition, purchasable, label: availCopy.label, message: availCopy.message,
      priceLabel: availCopy.priceLabel, asOf: avail.as_of && Number.isFinite(Date.parse(avail.as_of)) ? avail.as_of : null, asOfDisplay: availAsOf,
    }
    : null;

  // ── sticky rail
  const stickyResolved = resolveStickyButtons((listing as unknown as { sticky_bottom_buttons?: StickyBottomButtons }).sticky_bottom_buttons);
  const stickyItems = stickyResolved.items.filter((b) => (estimatorOn || b.key !== "calculate_payment") && (purchasable || !PURCHASE_ACTION_KEYS.has(b.key)));
  const stickyRail: PvStickyRail | null = stickyResolved.enabled && stickyItems.length > 0
    ? { mobileOnly: true, items: stickyItems.map((b) => ({ key: b.key, label: b.label, primary: b.primary })) }
    : null;

  const footer: PvFooter = {
    helpLine: d.dealerPhone ? `Need help? Call ${d.dealerPhone}` : null,
    dealerPhone: d.dealerPhone || null,
    offeredBy: dealerName ? `Vehicle offered by ${dealerName}. Confirm current availability, price and details with the dealership.` : null,
    links: [{ label: "Privacy", path: "/privacy" }, { label: "Terms", path: "/terms" }],
  };

  return {
    contractVersion: MARKETPASS_PAGE_CONTRACT_VERSION,
    audience: "public",
    vin: String(listing.vin ?? ""),
    slug: rawSlug,
    generatedAt: new Date(nowMs).toISOString(),
    sourceUpdatedAt: (listing.updated_at as string | null | undefined) ?? null,
    header,
    hero,
    actionCenter,
    verification,
    marketIntelligence,
    warranty,
    equipment,
    history,
    specs,
    strengths,
    marketComparison,
    similarVehicles,
    fuelEconomy,
    whyBuy,
    confirmBeforePurchase,
    about,
    overview,
    photos,
    documents,
    availability,
    stickyRail,
    footer,
  };
}
