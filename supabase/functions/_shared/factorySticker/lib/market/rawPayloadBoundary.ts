// GENERATED — do not edit.
// Mirror of src/lib/market/rawPayloadBoundary.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── What a vehicle_listings.mc_raw value actually is ───────────────────────
//
// `mc_raw` is documented as the verbatim syndication row. In production it is
// that on 247 rows and, on 81 others, the output of the retired
// `marketcheck-market-pricing` function: `{belowMarket, checkedAt, high, low,
// listingPrice, marketValue, position, raw, rawProvider}`. Those 81 cars have
// no stored feed row at all, and anything that reads `mc_raw.build` or
// `mc_raw.dealer` on them reads nothing.
//
// This classifier is the one definition of the two shapes, used by the repair
// migration's predicate (asserted equal by test), by the sync's own write
// path, and by the Vehicle File read model when it decides whether a feed row
// exists. It never reinterprets a payload: a shape it does not recognise is
// `unknown`, and `unknown` is left where it is.

export type RawPayloadKind = "syndication_row" | "legacy_market_pricing" | "empty" | "unknown";

export interface RawPayloadClassification {
  kind: RawPayloadKind;
  reasons: string[];
}

/** Keys the retired pricing writer always produced together. */
export const LEGACY_PRICING_KEYS = ["marketValue", "rawProvider", "listingPrice", "position"] as const;

/** Keys only a syndication listing row carries. */
export const SYNDICATION_ROW_KEYS = ["build", "dealer", "media", "mc_dealership", "inventory_type", "heading"] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function classifyRawPayload(value: unknown): RawPayloadClassification {
  if (value === null || value === undefined) return { kind: "empty", reasons: ["null"] };
  if (!isObject(value)) return { kind: "unknown", reasons: ["not_an_object"] };
  const keys = Object.keys(value);
  if (keys.length === 0) return { kind: "empty", reasons: ["no_keys"] };

  const legacyHits = LEGACY_PRICING_KEYS.filter((k) => k in value);
  const rowHits = SYNDICATION_ROW_KEYS.filter((k) => k in value);

  if (rowHits.length >= 2 && legacyHits.length === 0) {
    return { kind: "syndication_row", reasons: rowHits.map((k) => `has_${k}`) };
  }
  if (legacyHits.length >= 2 && rowHits.length === 0) {
    return { kind: "legacy_market_pricing", reasons: legacyHits.map((k) => `has_${k}`) };
  }
  // A row with a VIN and nothing else, or a payload carrying both vocabularies,
  // is a question for a person.
  return {
    kind: "unknown",
    reasons: [
      ...rowHits.map((k) => `has_${k}`),
      ...legacyHits.map((k) => `has_${k}`),
      ...(rowHits.length === 0 && legacyHits.length === 0 ? ["no_recognised_keys"] : []),
    ],
  };
}

/**
 * The SQL predicate the repair migration uses to find legacy rows. Written
 * here so a test can hold the migration text to it. Two legacy keys, no
 * syndication keys: the same rule as `classifyRawPayload`.
 */
export const LEGACY_PRICING_SQL_PREDICATE =
  "(mc_raw ? 'marketValue' AND mc_raw ? 'rawProvider') AND NOT (mc_raw ? 'build') AND NOT (mc_raw ? 'dealer')";
