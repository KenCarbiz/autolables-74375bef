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
  // TRUE only for a tenant whose advertised price EXCLUDES the doc fee, so the
  // fee-inclusive display must be website_sale_price (= advertised + fee). Absent
  // / false means the advertised `price` is already the all-in number (every Harte
  // store), so website_sale_price mode shows `price` unchanged — adding the fee to
  // an already-inclusive price double-counts it.
  advertised_excludes_doc_fee?: boolean | null;
}

// The customer-facing "Our Price" value, chosen by tenant setting. The mode
// describes what the dealer's LISTED price means:
//   advertised_before_doc — the listed price excludes the doc fee; surfaces
//     disclose it additively ("+ $895 doc fee · Sale $X").
//   website_sale_price — the listed price ALREADY includes the doc fee; it is
//     displayed unchanged with an "Incl. doc fee" note. The stored breakdown's
//     computed website_sale_price is deliberately ignored here: it derives from
//     the additive assumption, and adding the fee to a fee-inclusive listed
//     price would overstate what the customer pays.
// The website-scraped advertised price and the inventory feed price are two
// reads of the same "our price". They usually agree; when they disagree the
// customer must NEVER see a number above the dealer's own inventory price — a
// scrape that lands above the feed is a mis-parse (it grabbed the sticker/MSRP
// or a lease figure, not the sale price), while a scrape BELOW the feed is a
// real website price drop we want to honor. So the advertised price is the
// lower of the two whenever both are present.
const lowerAdvertised = (f: DisplayPriceFields): number | null => {
  const a = f.advertised_price_before_doc;
  const p = f.price;
  if (a != null && p != null) return Math.min(a, p);
  return a ?? p ?? null;
};

export function resolveDisplayPrice(
  f: DisplayPriceFields,
  mode: PriceDisplayMode = DEFAULT_PRICE_DISPLAY_MODE,
): number | null {
  const advertised = lowerAdvertised(f);
  if (mode === "website_sale_price") {
    // Fee-INCLUSIVE display. Only a tenant whose advertised price EXCLUDES the
    // fee needs the additive total (website_sale_price = advertised + fee). For
    // every tenant whose advertised price already includes the fee, the advertised
    // `price` IS the all-in number; surfacing website_sale_price there would
    // double-count the fee (and violate the invariant that the customer never sees
    // a number above the dealer's own inventory price). Anchor on `price`.
    if (f.advertised_excludes_doc_fee) {
      return f.website_sale_price ?? advertised ?? f.price ?? null;
    }
    return f.price ?? f.website_sale_price ?? advertised ?? null;
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
  const advertised = lowerAdvertised(f);
  if (mode === "website_sale_price") {
    // Compare the number the customer actually sees. Mirror resolveDisplayPrice:
    // an already-inclusive advertised price IS the displayed number (anchor on
    // `price`), while a fee-excluding tenant compares on the additive total.
    if (f.advertised_excludes_doc_fee) {
      return f.website_sale_price ?? advertised ?? f.price ?? null;
    }
    return f.price ?? f.website_sale_price ?? advertised ?? null;
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

// ──────────────────────────────────────────────────────────────────────
// Discount / savings breakdown — the customer-facing "MSRP → dealer discount
// → retail cash → your price → + doc fee → sale price" ladder that mirrors the
// dealer's own website. Every line is a captured number or pure arithmetic off
// the captured numbers; nothing is invented, and the discount lines ALWAYS sum
// to the real MSRP−price gap so the customer can never see savings that don't
// reconcile to the actual price (an FTC exposure). Returns null when there is
// no genuine savings story (no MSRP, or MSRP at/below the price), so the UI
// simply omits the card rather than showing a $0 or negative "discount".
// ──────────────────────────────────────────────────────────────────────

export interface DiscountLine {
  key: "dealer_discount" | "retail_cash" | "savings";
  label: string;
  amount: number;   // positive magnitude subtracted from MSRP
  derived: boolean; // true when computed as a remainder, not a captured column
}

export interface DiscountBreakdown {
  msrp: number;
  lines: DiscountLine[]; // in MSRP→price order; guaranteed to sum to totalSavings
  totalSavings: number;  // msrp − ourPrice
  savingsPct: number;    // totalSavings / msrp * 100
  ourPrice: number;      // the vehicle price BEFORE the doc fee
  docFee: number | null; // rendered as an added line when > 0
  salePrice: number | null; // ourPrice + docFee (the fee-inclusive final)
}

export interface DiscountBreakdownInput {
  msrp?: number | null;
  advertisedBeforeDoc?: number | null;
  price?: number | null;
  docFee?: number | null;
  dealerDiscount?: number | null;
  retailCash?: number | null;
}

const DISCOUNT_TOLERANCE = 1; // dollars

// A captured discount column is only meaningful as a positive magnitude above
// the tolerance; anything else (null, 0, NaN) is treated as "not captured".
const posMag = (n: number | null | undefined): number | null =>
  n != null && Number.isFinite(n) && Math.abs(n) > DISCOUNT_TOLERANCE ? Math.abs(n) : null;

export function buildDiscountBreakdown(
  input: DiscountBreakdownInput,
  mode: PriceDisplayMode = DEFAULT_PRICE_DISPLAY_MODE,
): DiscountBreakdown | null {
  const msrp = input.msrp != null && Number.isFinite(input.msrp) ? input.msrp : null;
  // The vehicle price the customer sees, chosen the same way the headline is —
  // the lower of the feed price and the scraped advertised price.
  const listed = lowerAdvertised({ advertised_price_before_doc: input.advertisedBeforeDoc, price: input.price });
  if (msrp == null || listed == null) return null;

  const docFee = posMag(input.docFee);
  // ourPrice is the pre-doc vehicle price. In website_sale_price mode the listed
  // number already includes the doc fee, so back it out to compare against MSRP
  // (a pre-doc sticker) like-for-like; the fee-inclusive number is the sale price.
  const ourPrice = mode === "website_sale_price" && docFee ? listed - docFee : listed;
  const salePrice = mode === "website_sale_price" ? listed : docFee ? ourPrice + docFee : ourPrice;

  const totalSavings = Math.round(msrp - ourPrice);
  if (totalSavings <= DISCOUNT_TOLERANCE) return null; // MSRP at/below price — no story

  const dealer = posMag(input.dealerDiscount);
  const cash = posMag(input.retailCash);

  const lines: DiscountLine[] = [];
  if (dealer == null && cash == null) {
    // No component detail captured — a single honest total, no attribution.
    lines.push({ key: "savings", label: "Total Savings", amount: totalSavings, derived: false });
  } else {
    // Dealer discount first (captured, or the remainder after a known rebate),
    // then retail cash — matching the dealer's own site order.
    let dealerAmt = dealer;
    if (dealerAmt == null) {
      const rem = Math.round(totalSavings - (cash ?? 0));
      if (rem > DISCOUNT_TOLERANCE) dealerAmt = rem;
    }
    if (dealerAmt && dealerAmt > DISCOUNT_TOLERANCE) {
      lines.push({ key: "dealer_discount", label: "Dealer Discount", amount: dealerAmt, derived: dealer == null });
    }
    if (cash) lines.push({ key: "retail_cash", label: "Retail Cash", amount: cash, derived: false });

    // Reconcile: the lines must sum to the real MSRP−price gap. A positive
    // remainder becomes an "Additional Savings" line; if captured columns
    // overstate the gap (parse drift), collapse to one trustworthy total.
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    const diff = Math.round(totalSavings - sum);
    if (diff > DISCOUNT_TOLERANCE) {
      lines.push({ key: "savings", label: "Additional Savings", amount: diff, derived: true });
    } else if (diff < -DISCOUNT_TOLERANCE) {
      lines.length = 0;
      lines.push({ key: "savings", label: "Total Savings", amount: totalSavings, derived: false });
    }
  }
  if (!lines.length) lines.push({ key: "savings", label: "Total Savings", amount: totalSavings, derived: false });

  return {
    msrp,
    lines,
    totalSavings,
    savingsPct: (totalSavings / msrp) * 100,
    ourPrice,
    docFee,
    salePrice,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Sale-price BREAKDOWN card — the customer-facing pricing math on the Vehicle
// Passport. The nightly dealer scrape gives ONE locked number: the Total
// Advertised Price, which ALREADY INCLUDES the dealer doc fee. Everything is
// derived backward from it, in integer cents, so the arithmetic always
// reconciles to that scraped total.
//
//   Vehicle Selling Price = Total Advertised Price − Dealer Doc Fee
//   NEW:      MSRP − factory rebates − Dealer Discount = Vehicle Selling Price
//   USED/CPO: Market Value          − Dealer Discount = Vehicle Selling Price
//   ⇒ Dealer Discount is DERIVED so the ladder reconciles. When the total
//     equals MSRP with no rebates, that discount correctly equals the doc fee
//     (the dealer cut the price by the fee, then added the fee back) — this is
//     real reconciling arithmetic off the scraped total, not a fabricated
//     discount. A negative derived discount means the inputs conflict and is
//     never shown as a positive discount.
//
// The doc fee is itemized by SUBTRACTION and re-ADDITION — never added on top of
// the already-inclusive scraped total (no double count). The card never repeats
// the scraped total as MSRP/Selling/Total, never renders $0/null/negative rows,
// and never disappears: the minimum truthful card is Vehicle Selling Price →
// Total Advertised Price.
// ──────────────────────────────────────────────────────────────────────

export type PricingVehicleType = "new" | "used" | "cpo";

export interface SalePriceLine {
  key: string;
  label: string;
  amount: number;                     // positive magnitude (dollars); role decides the sign shown
  role: "anchor" | "discount";        // anchor = MSRP/Market Value (muted); discount = green "−"
}

export interface SalePriceCard {
  vehicleType: PricingVehicleType;
  anchorLabel: "MSRP" | "Market Value";
  lines: SalePriceLine[];             // anchor + factory rebates + dealer discount, ABOVE the divider
  vehicleSellingPrice: number;        // pre-doc-fee (Total − Doc Fee)
  feeLabel: string | null;
  feeAmount: number | null;           // > 0 → render "+ <feeLabel>"; null → no fee row
  totalAdvertisedPrice: number;       // the headline; the locked, fee-inclusive scraped total
  reconciles: boolean;                // exact integer-cent reconciliation of the whole ladder
  conflict: boolean;                  // inputs disagree (negative derived discount, etc.)
  msrpEqualsTotal: boolean;           // new + MSRP === total (the "discount == doc fee" case)
  // Internal audit: a scraped/fed dealer discount was supplied and disagrees with
  // the derived one. The display still uses the reconciling derived value.
  documentedDiscountMismatch: boolean;
}

export interface SalePriceInput {
  vehicleType: PricingVehicleType;
  msrp?: number | null;               // new anchor
  marketValue?: number | null;        // used/CPO anchor
  vehicleSellingPrice: number;        // Total Advertised Price − Dealer Doc Fee
  totalAdvertisedPrice: number;       // the locked, fee-inclusive nightly scraped total
  docFee?: number | null;             // tenant-configured doc fee (already inside the total)
  docFeeLabel?: string | null;
  // NEW only: manufacturer rebates included in the advertised price (Retail Cash,
  // Bonus Cash, …). Each is a real, unconditional, included rebate. Conditional
  // incentives are excluded UPSTREAM (the caller only passes included rebates).
  factoryRebates?: { key?: string; label: string; amount: number }[];
  // Optional: a dealer discount captured directly from the scrape/feed. Used only
  // to CROSS-CHECK the derived discount (never to alter the reconciling display).
  // A disagreement sets documentedDiscountMismatch for internal audit.
  documentedDealerDiscount?: number | null;
}

export const DEFAULT_DOC_FEE_LABEL = "Dealer Doc Fee";

// All money math is done in integer cents; dollars only cross the boundary in/out.
const toCents = (n: number): number => Math.round(n * 100);
const toDollars = (c: number): number => c / 100;
const validMoney = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

// Build the pricing card. Pure + deterministic; all arithmetic in integer cents.
export function buildSalePriceCard(input: SalePriceInput): SalePriceCard {
  const totalC = toCents(input.totalAdvertisedPrice);
  const feeC = validMoney(input.docFee) && input.docFee > 0 ? toCents(input.docFee) : 0;
  // Vehicle Selling Price is the total minus the doc fee — computed here from the
  // locked total so selling + fee === total holds exactly in cents.
  const sellC = totalC - feeC;

  const anchorLabel: "MSRP" | "Market Value" = input.vehicleType === "new" ? "MSRP" : "Market Value";
  const anchorRaw = input.vehicleType === "new" ? input.msrp : input.marketValue;
  const anchorC = validMoney(anchorRaw) ? toCents(anchorRaw) : null;

  const rebates = (input.vehicleType === "new" ? (input.factoryRebates ?? []) : [])
    .filter((r) => validMoney(r.amount) && r.amount > 0 && typeof r.label === "string" && r.label.trim().length > 0)
    .map((r, i) => ({ key: r.key ?? `rebate-${i}`, label: r.label, amountC: toCents(r.amount) }));
  const rebateTotalC = rebates.reduce((s, r) => s + r.amountC, 0);

  // Derived dealer discount that reconciles the anchor to the selling price.
  const discC = anchorC != null ? anchorC - rebateTotalC - sellC : null;
  const conflict = discC != null && discC < 0; // anchor below selling / rebates exceed the gap
  // Cross-check a documented discount against the derived one (audit only).
  const documentedDiscountMismatch = validMoney(input.documentedDealerDiscount) && discC != null
    && toCents(input.documentedDealerDiscount) !== discC;

  // Show the anchor ladder only when it holds up: a valid anchor and a
  // non-negative derived discount, with something real to show (a positive
  // discount or at least one rebate). Otherwise the card degrades cleanly to
  // Vehicle Selling Price → Doc Fee → Total.
  const showLadder = anchorC != null && discC != null && discC >= 0 && (discC > 0 || rebateTotalC > 0);

  const lines: SalePriceLine[] = [];
  if (showLadder && anchorC != null && discC != null) {
    lines.push({ key: "anchor", label: anchorLabel, amount: toDollars(anchorC), role: "anchor" });
    rebates.forEach((r) => lines.push({ key: r.key, label: r.label, amount: toDollars(r.amountC), role: "discount" }));
    if (discC > 0) lines.push({ key: "dealer_discount", label: "Dealer Discount", amount: toDollars(discC), role: "discount" });
  }

  const feeAmount = feeC > 0 ? toDollars(feeC) : null;
  const feeLabel = feeAmount != null ? ((input.docFeeLabel && input.docFeeLabel.trim()) || DEFAULT_DOC_FEE_LABEL) : null;

  // Exact integer-cent reconciliation: selling + fee === total, and (when a ladder
  // is shown) anchor − rebates − discount === selling. No rounding tolerance.
  const feeReconciles = sellC + feeC === totalC;
  const ladderReconciles = !showLadder || (anchorC != null && discC != null && anchorC - rebateTotalC - discC === sellC);
  const reconciles = feeReconciles && ladderReconciles && Number.isFinite(totalC);

  return {
    vehicleType: input.vehicleType,
    anchorLabel,
    lines,
    vehicleSellingPrice: toDollars(sellC),
    feeLabel,
    feeAmount,
    totalAdvertisedPrice: toDollars(totalC),
    reconciles,
    conflict,
    msrpEqualsTotal: input.vehicleType === "new" && anchorC != null && anchorC === totalC,
    documentedDiscountMismatch,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Price LABEL — what the dealer CALLS their price on customer surfaces.
// This is display text only; it never changes the price VALUE or the doc-fee
// inclusion decided by price_display_mode. Stored on dealer_profiles.settings
// as { preset, custom? }. The "dealer" preset substitutes the dealership name
// ("Harte Price"); "website" mirrors the term the dealer's own VDP uses next to
// its price (vehicle_listings.website_price_term); "custom" uses free text.
// ──────────────────────────────────────────────────────────────────────

export type PriceLabelPreset =
  | "our_price"
  | "advertised"
  | "best"
  | "one_price"
  | "sale"
  | "dealer"
  | "website"
  | "custom";

export interface PriceLabelSetting {
  preset: PriceLabelPreset;
  custom?: string;
}

export const DEFAULT_PRICE_LABEL: PriceLabelSetting = { preset: "our_price" };

// Admin dropdown options. `sample` is the copy shown in the live preview for the
// fixed presets; "dealer" and "custom" resolve from live inputs so they carry no
// static sample.
export const PRICE_LABEL_PRESETS: { value: PriceLabelPreset; label: string; sample?: string }[] = [
  { value: "our_price", label: "Our Price (default)", sample: "Our Price" },
  { value: "advertised", label: "Advertised Price", sample: "Advertised Price" },
  { value: "best", label: "Best Price", sample: "Best Price" },
  { value: "one_price", label: "One Price", sample: "One Price" },
  { value: "sale", label: "Sale Price", sample: "Sale Price" },
  { value: "dealer", label: "{Dealer} Price (uses your dealership name)" },
  { value: "website", label: "Match my website" },
  { value: "custom", label: "Custom…" },
];

const PRICE_LABEL_FIXED: Partial<Record<PriceLabelPreset, string>> = {
  our_price: "Our Price",
  advertised: "Advertised Price",
  best: "Best Price",
  one_price: "One Price",
  sale: "Sale Price",
};

// Resolve the display string a shopper sees for the price header. Falls back to
// "Our Price" for an unset setting, an empty custom string, a "dealer" preset
// with no dealership name, or a "website" preset with no term captured yet.
export function resolvePriceLabel(
  setting: PriceLabelSetting | null | undefined,
  dealerName?: string | null,
  websiteTerm?: string | null,
): string {
  const preset = setting?.preset;
  if (preset === "dealer") {
    const name = (dealerName || "").trim();
    return name ? `${name} Price` : "Our Price";
  }
  if (preset === "website") {
    return (websiteTerm || "").trim() || "Our Price";
  }
  if (preset === "custom") {
    return (setting?.custom || "").trim() || "Our Price";
  }
  return (preset && PRICE_LABEL_FIXED[preset]) || "Our Price";
}

// Read a tenant's price_label setting out of dealer_profiles.settings, tolerating
// legacy/absent shapes.
export function getPriceLabelSetting(settings: unknown): PriceLabelSetting {
  const raw = (settings as { price_label?: unknown } | null | undefined)?.price_label;
  if (raw && typeof raw === "object" && typeof (raw as { preset?: unknown }).preset === "string") {
    const r = raw as { preset: string; custom?: unknown };
    return { preset: r.preset as PriceLabelPreset, custom: typeof r.custom === "string" ? r.custom : undefined };
  }
  return { ...DEFAULT_PRICE_LABEL };
}
