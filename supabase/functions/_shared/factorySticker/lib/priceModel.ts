// GENERATED — do not edit.
// Mirror of src/lib/priceModel.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type PriceDisplayMode = "advertised_before_doc" | "website_sale_price";
export const DEFAULT_PRICE_DISPLAY_MODE: PriceDisplayMode = "advertised_before_doc";
export const PRICE_DISPLAY_MODES: {
    value: PriceDisplayMode;
    label: string;
    help: string;
}[] = [
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
export function normalizeCurrency(raw: unknown): number | null {
    if (raw == null)
        return null;
    if (typeof raw === "number")
        return Number.isFinite(raw) ? raw : null;
    const cleaned = String(raw)
        .replace(/usd/gi, "")
        .replace(/[$,\s +\-]/g, "");
    if (cleaned === "")
        return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}
export function computeWebsiteSalePrice(advertisedBeforeDoc: number | null | undefined, docFee: number | null | undefined): number | null {
    if (advertisedBeforeDoc == null)
        return null;
    return advertisedBeforeDoc + (docFee ?? 0);
}
export interface PriceBreakdownInput {
    advertisedBeforeDoc: number | null | undefined;
    docFee?: number | null;
    parsedDocFee?: number | null;
    displayedSalePrice?: number | null;
    msrp?: number | null;
    retailCash?: number | null;
    dealerDiscount?: number | null;
}
const TOLERANCE = 1;
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
        }
        else {
            verified.push(`doc fee ${docFee} matches the page`);
        }
    }
    if (displayed != null && calc != null) {
        if (Math.abs(displayed - calc) > TOLERANCE) {
            issues.push(`displayed sale price ${displayed} != advertised ${advertised} + doc fee ${docFee ?? 0} = ${calc}`);
        }
        else {
            verified.push(`sale price ${calc} matches the page`);
        }
    }
    let status: PriceParseStatus = "ok";
    let notes: string;
    if (advertised == null) {
        status = "pending";
        notes = "No advertised price parsed.";
    }
    else if (issues.length) {
        status = "warning";
        notes = `Price parse mismatch: ${issues.join("; ")}. Review source page.`;
    }
    else if (verified.length) {
        notes = `Verified: ${verified.join("; ")}.`;
    }
    else {
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
    price?: number | null;
    advertised_excludes_doc_fee?: boolean | null;
}
const lowerAdvertised = (f: DisplayPriceFields): number | null => {
    const a = f.advertised_price_before_doc;
    const p = f.price;
    if (a != null && p != null)
        return Math.min(a, p);
    return a ?? p ?? null;
};
export function resolveDisplayPrice(f: DisplayPriceFields, mode: PriceDisplayMode = DEFAULT_PRICE_DISPLAY_MODE): number | null {
    const advertised = lowerAdvertised(f);
    if (mode === "website_sale_price") {
        if (f.advertised_excludes_doc_fee) {
            return f.website_sale_price ?? advertised ?? f.price ?? null;
        }
        return f.price ?? f.website_sale_price ?? advertised ?? null;
    }
    return advertised;
}
export function resolveComparePrice(f: DisplayPriceFields, mode: PriceDisplayMode = DEFAULT_PRICE_DISPLAY_MODE): number | null {
    const advertised = lowerAdvertised(f);
    if (mode === "website_sale_price") {
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
export function getPriceDisplayMode(settings: unknown): PriceDisplayMode {
    const m = (settings as {
        price_display_mode?: unknown;
    } | null | undefined)?.price_display_mode;
    return isPriceDisplayMode(m) ? m : DEFAULT_PRICE_DISPLAY_MODE;
}
export interface DiscountLine {
    key: "dealer_discount" | "retail_cash" | "savings";
    label: string;
    amount: number;
    derived: boolean;
}
export interface DiscountBreakdown {
    msrp: number;
    lines: DiscountLine[];
    totalSavings: number;
    savingsPct: number;
    ourPrice: number;
    docFee: number | null;
    salePrice: number | null;
}
export interface DiscountBreakdownInput {
    msrp?: number | null;
    advertisedBeforeDoc?: number | null;
    price?: number | null;
    docFee?: number | null;
    dealerDiscount?: number | null;
    retailCash?: number | null;
}
const DISCOUNT_TOLERANCE = 1;
const posMag = (n: number | null | undefined): number | null => n != null && Number.isFinite(n) && Math.abs(n) > DISCOUNT_TOLERANCE ? Math.abs(n) : null;
export function buildDiscountBreakdown(input: DiscountBreakdownInput, mode: PriceDisplayMode = DEFAULT_PRICE_DISPLAY_MODE): DiscountBreakdown | null {
    const msrp = input.msrp != null && Number.isFinite(input.msrp) ? input.msrp : null;
    const listed = lowerAdvertised({ advertised_price_before_doc: input.advertisedBeforeDoc, price: input.price });
    if (msrp == null || listed == null)
        return null;
    const docFee = posMag(input.docFee);
    const ourPrice = mode === "website_sale_price" && docFee ? listed - docFee : listed;
    const salePrice = mode === "website_sale_price" ? listed : docFee ? ourPrice + docFee : ourPrice;
    const totalSavings = Math.round(msrp - ourPrice);
    if (totalSavings <= DISCOUNT_TOLERANCE)
        return null;
    const dealer = posMag(input.dealerDiscount);
    const cash = posMag(input.retailCash);
    const lines: DiscountLine[] = [];
    if (dealer == null && cash == null) {
        lines.push({ key: "savings", label: "Total Savings", amount: totalSavings, derived: false });
    }
    else {
        let dealerAmt = dealer;
        if (dealerAmt == null) {
            const rem = Math.round(totalSavings - (cash ?? 0));
            if (rem > DISCOUNT_TOLERANCE)
                dealerAmt = rem;
        }
        if (dealerAmt && dealerAmt > DISCOUNT_TOLERANCE) {
            lines.push({ key: "dealer_discount", label: "Dealer Discount", amount: dealerAmt, derived: dealer == null });
        }
        if (cash)
            lines.push({ key: "retail_cash", label: "Retail Cash", amount: cash, derived: false });
        const sum = lines.reduce((s, l) => s + l.amount, 0);
        const diff = Math.round(totalSavings - sum);
        if (diff > DISCOUNT_TOLERANCE) {
            lines.push({ key: "savings", label: "Additional Savings", amount: diff, derived: true });
        }
        else if (diff < -DISCOUNT_TOLERANCE) {
            lines.length = 0;
            lines.push({ key: "savings", label: "Total Savings", amount: totalSavings, derived: false });
        }
    }
    if (!lines.length)
        lines.push({ key: "savings", label: "Total Savings", amount: totalSavings, derived: false });
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
export type PricingVehicleType = "new" | "used" | "cpo";
export interface SalePriceLine {
    key: string;
    label: string;
    amount: number;
    role: "anchor" | "discount";
}
export interface SalePriceCard {
    vehicleType: PricingVehicleType;
    anchorLabel: "MSRP" | "Market Value";
    lines: SalePriceLine[];
    vehicleSellingPrice: number;
    feeLabel: string | null;
    feeAmount: number | null;
    totalAdvertisedPrice: number;
    reconciles: boolean;
    conflict: boolean;
    msrpEqualsTotal: boolean;
    customerSavings: number | null;
    showSavings: boolean;
    documentedDiscountMismatch: boolean;
}
export interface SalePriceInput {
    vehicleType: PricingVehicleType;
    msrp?: number | null;
    marketValue?: number | null;
    vehicleSellingPrice: number;
    totalAdvertisedPrice: number;
    docFee?: number | null;
    docFeeLabel?: string | null;
    factoryRebates?: {
        key?: string;
        label: string;
        amount: number;
    }[];
    documentedDealerDiscount?: number | null;
}
export const DEFAULT_DOC_FEE_LABEL = "Dealer Doc Fee";
const toCents = (n: number): number => Math.round(n * 100);
const toDollars = (c: number): number => c / 100;
const validMoney = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
export function buildSalePriceCard(input: SalePriceInput): SalePriceCard {
    const totalC = toCents(input.totalAdvertisedPrice);
    const feeC = validMoney(input.docFee) && input.docFee > 0 ? toCents(input.docFee) : 0;
    const sellC = totalC - feeC;
    const anchorLabel: "MSRP" | "Market Value" = input.vehicleType === "new" ? "MSRP" : "Market Value";
    const anchorRaw = input.vehicleType === "new" ? input.msrp : input.marketValue;
    const anchorC = validMoney(anchorRaw) ? toCents(anchorRaw) : null;
    const rebates = (input.vehicleType === "new" ? (input.factoryRebates ?? []) : [])
        .filter((r) => validMoney(r.amount) && r.amount > 0 && typeof r.label === "string" && r.label.trim().length > 0)
        .map((r, i) => ({ key: r.key ?? `rebate-${i}`, label: r.label, amountC: toCents(r.amount) }));
    const rebateTotalC = rebates.reduce((s, r) => s + r.amountC, 0);
    const discC = anchorC != null ? anchorC - rebateTotalC - sellC : null;
    const conflict = discC != null && discC < 0;
    const documentedDiscountMismatch = validMoney(input.documentedDealerDiscount) && discC != null
        && toCents(input.documentedDealerDiscount) !== discC;
    const showLadder = anchorC != null && discC != null && discC >= 0 && (discC > 0 || rebateTotalC > 0);
    const lines: SalePriceLine[] = [];
    if (showLadder && anchorC != null && discC != null) {
        lines.push({ key: "anchor", label: anchorLabel, amount: toDollars(anchorC), role: "anchor" });
        rebates.forEach((r) => lines.push({ key: r.key, label: r.label, amount: toDollars(r.amountC), role: "discount" }));
        if (discC > 0)
            lines.push({ key: "dealer_discount", label: "Dealer Discount", amount: toDollars(discC), role: "discount" });
    }
    const feeAmount = feeC > 0 ? toDollars(feeC) : null;
    const feeLabel = feeAmount != null ? ((input.docFeeLabel && input.docFeeLabel.trim()) || DEFAULT_DOC_FEE_LABEL) : null;
    const feeReconciles = sellC + feeC === totalC;
    const ladderReconciles = !showLadder || (anchorC != null && discC != null && anchorC - rebateTotalC - discC === sellC);
    const reconciles = feeReconciles && ladderReconciles && Number.isFinite(totalC);
    const savingsC = anchorC != null ? anchorC - totalC : null;
    const customerSavings = savingsC != null ? toDollars(savingsC) : null;
    const showSavings = reconciles && savingsC != null && savingsC > 0;
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
        customerSavings,
        showSavings,
        documentedDiscountMismatch,
    };
}
export type PriceLabelPreset = "our_price" | "advertised" | "best" | "one_price" | "sale" | "dealer" | "website" | "custom";
export interface PriceLabelSetting {
    preset: PriceLabelPreset;
    custom?: string;
}
export const DEFAULT_PRICE_LABEL: PriceLabelSetting = { preset: "our_price" };
export const PRICE_LABEL_PRESETS: {
    value: PriceLabelPreset;
    label: string;
    sample?: string;
}[] = [
    { value: "our_price", label: "Our Price (default)", sample: "Our Price" },
    { value: "advertised", label: "Advertised Price", sample: "Advertised Price" },
    { value: "best", label: "Best Price", sample: "Best Price" },
    { value: "one_price", label: "One Price", sample: "One Price" },
    { value: "sale", label: "Sale Price", sample: "Sale Price" },
    { value: "dealer", label: "{Dealer} Price (uses your dealership name)" },
    { value: "website", label: "Match my website" },
    { value: "custom", label: "Custom\u2026" },
];
const PRICE_LABEL_FIXED: Partial<Record<PriceLabelPreset, string>> = {
    our_price: "Our Price",
    advertised: "Advertised Price",
    best: "Best Price",
    one_price: "One Price",
    sale: "Sale Price",
};
export function resolvePriceLabel(setting: PriceLabelSetting | null | undefined, dealerName?: string | null, websiteTerm?: string | null): string {
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
export function getPriceLabelSetting(settings: unknown): PriceLabelSetting {
    const raw = (settings as {
        price_label?: unknown;
    } | null | undefined)?.price_label;
    if (raw && typeof raw === "object" && typeof (raw as {
        preset?: unknown;
    }).preset === "string") {
        const r = raw as {
            preset: string;
            custom?: unknown;
        };
        return { preset: r.preset as PriceLabelPreset, custom: typeof r.custom === "string" ? r.custom : undefined };
    }
    return { ...DEFAULT_PRICE_LABEL };
}
