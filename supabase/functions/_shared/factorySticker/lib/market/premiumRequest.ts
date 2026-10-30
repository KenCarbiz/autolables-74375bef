// GENERATED — do not edit.
// Mirror of src/lib/market/premiumRequest.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── MarketCheck Price Premium / Premium Plus request ───────────────────────
//
// The provider fills an omitted `miles` with 50,000, `zip` with 50501 (Iowa),
// `dealer_type` with franchise and `is_certified` with false. A request that
// leaves any of them out is silently priced as a different car in a different
// market (change order §4). This builder refuses to produce such a request:
// every parameter in the registry's `alwaysSend` list must be present and
// valid, or there is no request at all.

import { capability } from "./providerRegistry.ts";

export type PremiumTier = "premium" | "premium_plus";

export interface PremiumRequestInput {
  tier: PremiumTier;
  vin: string;
  miles: number | null | undefined;
  zip: string | null | undefined;
  dealerType: "franchise" | "independent" | null | undefined;
  isCertified: boolean | null | undefined;
}

export type PremiumRequest =
  | { ok: true; capabilityKey: string; path: string; params: Record<string, string> }
  | { ok: false; capabilityKey: string; missing: string[] };

const CAPABILITY: Record<PremiumTier, string> = { premium: "price_premium", premium_plus: "price_premium_plus" };

export function buildPremiumRequest(input: PremiumRequestInput): PremiumRequest {
  const key = CAPABILITY[input.tier];
  const cap = capability(key);
  const missing: string[] = [];
  const vin = String(input.vin || "").toUpperCase().trim();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) missing.push("vin");
  if (input.miles == null || !Number.isFinite(input.miles) || input.miles < 0) missing.push("miles");
  const zip = String(input.zip ?? "").trim();
  if (!/^\d{5}$/.test(zip)) missing.push("zip");
  if (input.dealerType !== "franchise" && input.dealerType !== "independent") missing.push("dealer_type");
  if (typeof input.isCertified !== "boolean") missing.push("is_certified");
  if (!cap || missing.length) return { ok: false, capabilityKey: key, missing: cap ? missing : ["capability"] };
  return {
    ok: true,
    capabilityKey: key,
    path: cap.path,
    params: {
      vin,
      miles: String(Math.round(input.miles as number)),
      zip,
      dealer_type: input.dealerType as string,
      is_certified: String(input.isCertified),
    },
  };
}
