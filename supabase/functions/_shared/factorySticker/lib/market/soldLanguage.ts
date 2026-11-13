// GENERATED — do not edit.
// Mirror of src/lib/market/soldLanguage.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const APPROVED_SOLD_PHRASES = [
    "last observed advertised price",
    "last advertised price",
    "inferred sold listing",
    "inferred sold",
    "inferred market exit",
    "left the market",
    "listings that left the market",
    "recently removed listings",
    "advertised price before inferred sale",
] as const;
export const FORBIDDEN_SOLD_PHRASES = [
    "transaction price",
    "actual sale price",
    "final sale amount",
    "final sale price",
    "customer paid",
    "customers paid",
    "paid price",
    "sold for",
    "sold price",
    "sale price of similar",
    "recently sold for",
    "recently sold in",
] as const;
const normalize = (s: unknown): string => String(s ?? "").toLowerCase().replace(/\s+/g, " ");
const NEGATED = /\b(not|never|isn't|is not|aren't|are not|no)\b[^.]{0,40}\b(transaction price|actual sale price|final sale (amount|price)|customer(s)? paid|paid price|sold for|sold price)/;
export interface SoldWordingCheck {
    ok: boolean;
    offending: string[];
}
export function checkInferredSoldWording(copy: unknown): SoldWordingCheck {
    const text = normalize(copy);
    if (!text)
        return { ok: true, offending: [] };
    if (NEGATED.test(text))
        return { ok: true, offending: [] };
    const offending = FORBIDDEN_SOLD_PHRASES.filter((p) => text.includes(p));
    return { ok: offending.length === 0, offending: [...offending] };
}
export function assertInferredSoldWording(copy: unknown): string {
    const check = checkInferredSoldWording(copy);
    if (!check.ok) {
        throw new Error(`inferred-sold evidence described as a transaction: ${check.offending.join(", ")}`);
    }
    return String(copy ?? "");
}
export const INFERRED_SOLD_PRICE_LABEL = "last advertised price before inferred sale";
export const INFERRED_SOLD_COLUMN_NAMES = [
    "last_advertised_price",
    "inferred_sold_price_median",
    "inferred_sold_count",
    "inferred_sold_at",
] as const;
export const FORBIDDEN_COLUMN_FRAGMENTS = ["transaction_price", "actual_sale_price", "final_sale", "customer_paid", "sold_for"] as const;
export const isAcceptableSoldColumnName = (name: string): boolean => !FORBIDDEN_COLUMN_FRAGMENTS.some((f) => name.toLowerCase().includes(f));
export const CUSTOMER_UNSUPPORTED_EXIT_PHRASES = [
    "inferred sold",
    "inferred sale",
    "sold in",
    "sell in",
    "sold within",
    "before sale",
    "90 days",
    "90-day",
] as const;
export function checkCustomerExitWording(copy: unknown): SoldWordingCheck {
    const text = normalize(copy);
    const offending = [
        ...checkInferredSoldWording(copy).offending,
        ...CUSTOMER_UNSUPPORTED_EXIT_PHRASES.filter((p) => text.includes(p)),
    ];
    return { ok: offending.length === 0, offending };
}
