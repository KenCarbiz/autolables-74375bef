// ──────────────────────────────────────────────────────────────────────
// priceModel — the single source of truth for how an advertised price, a
// doc/conveyance fee, and a website sale price relate.
//
// Canonical model (confirmed against Harte INFINITI VDPs):
//   advertised_price_before_doc  — the vehicle price the dealer advertises,
//                                  BEFORE the doc/conveyance fee. This is what
//                                  the MarketCheck feed and `vehicle_listings.price`
//                                  carry, and what we compare against the market.
//   doc_fee                      — the conveyance/doc fee added on top ($895 at
//                                  Harte unless parsed otherwise).
//   website_sale_price           — advertised_price_before_doc + doc_fee. This
//                                  is the dealer site's final "Sale Price".
//
//   website_sale_price = advertised_price_before_doc + doc_fee
//
// Nothing here mutates inputs or double-adds the fee; the calculation is
// performed exactly once. Edge functions (Deno) mirror this tiny calc inline
// because they cannot import from src/.
// ──────────────────────────────────────────────────────────────────────

export type PriceDisplayMode = "advertised_before_doc" | "website_sale_price";

export const DEFAULT_PRICE_DISPLAY_MODE: PriceDisplayMode = "advertised_before_doc";

export const PRICE_DISPLAY_MODES: { value: PriceDisplayMode; label: string; help: string }[] = [
  {
    value: "advertised_before_doc",
    label: "Advertised price (before doc fee)",
    help: "Show the advertised vehicle price and disclose the doc fee separately.",
  },
  {
    value: "website_sale_price",
    label: "Website sale price (incl. doc fee)",
    help: "Show the final website sale price with the doc fee already included.",
  },
];

export type PriceParseStatus = "ok" | "warning" | "pending" | "error";

export interface PriceBreakdown {
  advertised_price_before_doc: number | null;
  doc_fee: number | null;
  website_sale_price: number | null;
  msrp: number | null;
  dealer_discount: number | null;
  retail_cash: number | null;
  displayed_sale_price: number | null;
  price_parse_status: PriceParseStatus;
  price_parse_notes: string;
}

// Strip $, commas, whitespace (incl. non-breaking), and leading +/- signs from a
// currency string, returning a finite magnitude or null. Plus/minus are removed
// per the parsing spec — Retail Cash is carried as a positive discount magnitude
// and the Conveyance Fee as a positive added-fee magnitude, never as a signed
// number, so the calculation can never accidentally subtract or double-add.
export function normalizeCurrency(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw)
    .replace(/usd/gi, "")
    .replace(/[$,\s +\-]/g, "");
  if (cleaned === "") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// website_sale_price = advertised_price_before_doc + doc_fee. The fee is added
// exactly once; a null advertised price yields null (we never invent a price).
export function computeWebsiteSalePrice(
  advertisedBeforeDoc: number | null | undefined,
  docFee: number | null | undefined,
): number | null {
  if (advertisedBeforeDoc == null) return null;
  return advertisedBeforeDoc + (docFee ?? 0);
}

export interface PriceBreakdownInput {
  advertisedBeforeDoc: number | null | undefined;
  // The dealer's CONFIGURED doc fee — authoritative for the calculation (the
  // dealer told us their fee in admin). website_sale_price uses this.
  docFee?: number | null;
  // The doc/conveyance fee PARSED off the live page, when found. Used only as a
  // CHECK that we are parsing the page correctly against the configured fee —
  // never as the calculation basis. A disagreement flags a warning.
  parsedDocFee?: number | null;
  // The dealer site's displayed final "Sale Price", when one was parsed off the
  // page. Used only to VALIDATE the calculation — never to overwrite advertised.
  displayedSalePrice?: number | null;
  msrp?: number | null;
  retailCash?: number | null;
  dealerDiscount?: number | null;
}

const TOLERANCE = 1; // dollars

// Assemble the full, validated breakdown.
//   • website_sale_price = advertised_price_before_doc + doc_fee (configured).
//   • Parse checks (spec #8/#9): the page's conveyance fee must match the
//     dealer's configured doc fee, AND advertised + doc fee must equal the
//     page's displayed sale price. Either disagreement flags price_parse_status
//     "warning" so the audit view can surface "Price parse mismatch."
// This is what an inventory reconcile uses to PROVE we parse a dealer's pricing
// correctly against the doc fee they entered in admin.
export function buildPriceBreakdown(input: PriceBreakdownInput): PriceBreakdown {
  const advertised = input.advertisedBeforeDoc ?? null;
  const docFee = input.docFee ?? null;
  const calc = computeWebsiteSalePrice(advertised, docFee ?? 0);
  const displayed = input.displayedSalePrice ?? null;
  const parsedFee = input.parsedDocFee ?? null;

  const issues: string[] = [];
  const verified: string[] = [];

  if (parsedFee != null && docFee != null) {
    if (Math.abs(parsedFee - docFee) > TOLERANCE) {
      issues.push(`page conveyance fee ${parsedFee} != configured doc fee ${docFee}`);
    } else {
      verified.push(`doc fee ${docFee} matches the page`);
    }
  }
  if (displayed != null && calc != null) {
    if (Math.abs(displayed - calc) > TOLERANCE) {
      issues.push(`displayed sale price ${displayed} != advertised ${advertised} + doc fee ${docFee ?? 0} = ${calc}`);
    } else {
      verified.push(`sale price ${calc} matches the page`);
    }
  }

  let status: PriceParseStatus = "ok";
  let notes: string;
  if (advertised == null) {
    status = "pending";
    notes = "No advertised price parsed.";
  } else if (issues.length) {
    status = "warning";
    notes = `Price parse mismatch: ${issues.join("; ")}. Review source page.`;
  } else if (verified.length) {
    notes = `Verified: ${verified.join("; ")}.`;
  } else {
    notes = "Sale price not displayed; computed from advertised price + doc fee.";
  }

  return {
    advertised_price_before_doc: advertised,
    doc_fee: docFee,
    website_sale_price: calc,
    msrp: input.msrp ?? null,
    dealer_discount: input.dealerDiscount ?? null,
    retail_cash: input.retailCash ?? null,
    displayed_sale_price: displayed,
    price_parse_status: status,
    price_parse_notes: notes,
  };
}

export interface DisplayPriceFields {
  advertised_price_before_doc?: number | null;
  doc_fee?: number | null;
  website_sale_price?: number | null;
  // Fallback to the legacy single price column when the breakdown is unpopulated.
  price?: number | null;
}

// The customer-facing "Our Price" value, chosen by tenant setting. Default mode
// shows the advertised price (before doc); website_sale_price mode shows the
// final sale price. Falls back across fields so a vehicle that predates the
// breakdown columns still renders its plain price.
export function resolveDisplayPrice(
  f: DisplayPriceFields,
  mode: PriceDisplayMode = DEFAULT_PRICE_DISPLAY_MODE,
): number | null {
  const advertised = f.advertised_price_before_doc ?? f.price ?? null;
  if (mode === "website_sale_price") {
    return (
      f.website_sale_price ??
      computeWebsiteSalePrice(advertised, f.doc_fee ?? 0) ??
      advertised
    );
  }
  return advertised;
}

// The price MarketCheck (and our own market math) should compare against.
// Default is advertised_before_doc so we compare vehicle price to vehicle price,
// not vehicle price plus doc fee — unless the tenant explicitly displays the
// website sale price, in which case we compare like-for-like.
export function resolveComparePrice(
  f: DisplayPriceFields,
  mode: PriceDisplayMode = DEFAULT_PRICE_DISPLAY_MODE,
): number | null {
  const advertised = f.advertised_price_before_doc ?? f.price ?? null;
  if (mode === "website_sale_price") {
    return (
      f.website_sale_price ??
      computeWebsiteSalePrice(advertised, f.doc_fee ?? 0) ??
      advertised
    );
  }
  return advertised;
}

export function isPriceDisplayMode(v: unknown): v is PriceDisplayMode {
  return v === "advertised_before_doc" || v === "website_sale_price";
}

// Read a tenant's price_display_mode out of dealer_profiles.settings, defaulting
// safely. Harte INFINITI keeps the default (advertised_before_doc).
export function getPriceDisplayMode(settings: unknown): PriceDisplayMode {
  const m = (settings as { price_display_mode?: unknown } | null | undefined)?.price_display_mode;
  return isPriceDisplayMode(m) ? m : DEFAULT_PRICE_DISPLAY_MODE;
}
