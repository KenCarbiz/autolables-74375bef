// ──────────────────────────────────────────────────────────────────────
// trade-appraisal — the server side of the passport's "Value My Trade".
//
// The passport used to open a page asking for name, email, phone and a message
// and call that a trade appraisal. It never asked what the shopper drives, so
// it could not be one.
//
// Three actions, in the order the shopper moves through them:
//
//   decode  { vin }                    -> year/make/model/trim from NHTSA vPIC
//   value   { vin, mileage, condition} -> a real range, or available:false
//   lead    { ...appraisal, contact }  -> a lead carrying the PURCHASE vehicle
//
// The valuation is Black Book's, called server-side through the existing
// blackbook-values function so the provider key never reaches a browser. When
// Black Book is not configured for this deployment the response says
// available:false and the passport degrades to "Ask About My Trade" — it does
// NOT invent a number, and it does not keep offering "Get My Trade Value" for
// a valuation it cannot produce.
//
// Anonymous callers reach this (shoppers are not signed in), so: input is
// strictly validated, the provider's raw payload is never echoed back, and the
// response carries only the fields the drawer renders.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const CONDITIONS = ["xclean", "clean", "average", "rough"] as const;
type Condition = (typeof CONDITIONS)[number];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const clean = (v: unknown, max = 120): string => String(v ?? "").trim().slice(0, max);
const num = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

interface DecodedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
}

// NHTSA vPIC — a free, public, federal decoder. No key, no contract, and it is
// the same authority the recall checks already use.
async function decodeVin(vin: string): Promise<DecodedVehicle | null> {
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as { Results?: Record<string, string>[] } | null;
    const r = body?.Results?.[0];
    if (!r) return null;
    const year = Number(r.ModelYear);
    const decoded: DecodedVehicle = {
      year: Number.isFinite(year) && year > 1900 ? year : null,
      make: r.Make || null,
      model: r.Model || null,
      trim: r.Trim || r.Series || null,
      bodyClass: r.BodyClass || null,
    };
    // A decode that produced neither make nor model is a failed decode, not a
    // vehicle with blank fields.
    return decoded.make || decoded.model ? decoded : null;
  } catch {
    return null;
  }
}

interface ValuationRange {
  available: boolean;
  low: number | null;
  high: number | null;
  condition: Condition | null;
  provider: string | null;
  checkedAt: string | null;
  reason?: string;
}

/**
 * Ask Black Book, through the internal function, for this trade's values.
 *
 * Returns a RANGE rather than a single number: a desk appraisal is a range
 * until someone has physically seen the car, and printing one exact figure
 * would promise a number the dealer has not agreed to.
 */
async function valueTrade(vin: string, mileage: number, condition: Condition, zip: string | null): Promise<ValuationRange> {
  const empty: ValuationRange = { available: false, low: null, high: null, condition, provider: null, checkedAt: null };
  if (!SUPABASE_URL || !SERVICE_KEY) return { ...empty, reason: "not_configured" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/blackbook-values`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ vin, mileage, zip: zip || undefined }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ...empty, reason: `provider_${res.status}` };
    const raw = await res.json().catch(() => null) as
      | { available?: boolean; reason?: string; tradein?: Record<string, number | null> }
      | null;
    if (!raw?.available || !raw.tradein) return { ...empty, reason: raw?.reason || "unavailable" };

    // Band the shopper's stated condition between the next grade down and the
    // stated grade, so the range brackets the real desk outcome.
    const t = raw.tradein;
    const order: Condition[] = ["rough", "average", "clean", "xclean"];
    const idx = order.indexOf(condition);
    const hi = t[condition] ?? null;
    const lo = idx > 0 ? (t[order[idx - 1]] ?? null) : hi;
    if (hi == null && lo == null) return { ...empty, reason: "no_values" };

    const low = Math.min(...[lo, hi].filter((n): n is number => n != null));
    const high = Math.max(...[lo, hi].filter((n): n is number => n != null));
    return {
      available: true,
      low: Math.round(low),
      high: Math.round(high),
      condition,
      provider: "Black Book",
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ...empty, reason: e instanceof Error ? e.message : "unknown" };
  }
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = clean(body.action, 16);

  // ── decode ────────────────────────────────────────────────────────
  if (action === "decode") {
    const vin = clean(body.vin, 17).toUpperCase();
    if (!VIN_RE.test(vin)) return json(400, { error: "valid_vin_required" });
    const decoded = await decodeVin(vin);
    return json(200, { ok: true, decoded, vin });
  }

  // ── value ─────────────────────────────────────────────────────────
  if (action === "value") {
    const vin = clean(body.vin, 17).toUpperCase();
    const mileage = num(body.mileage);
    const condition = CONDITIONS.includes(clean(body.condition, 10) as Condition)
      ? (clean(body.condition, 10) as Condition)
      : "average";
    if (!VIN_RE.test(vin)) return json(400, { error: "valid_vin_required" });
    if (mileage == null || mileage > 1_000_000) return json(400, { error: "valid_mileage_required" });
    const valuation = await valueTrade(vin, mileage, condition, clean(body.zip, 10) || null);
    return json(200, { ok: true, valuation });
  }

  // ── lead ──────────────────────────────────────────────────────────
  // Contact details are asked for LAST, once the shopper has seen what their
  // car is worth. The purchase vehicle travels with the appraisal so the
  // dealership knows which deal the trade belongs to.
  if (action === "lead") {
    const storeId = clean(body.store_id, 64) || null;
    const purchaseVin = clean(body.purchase_vin, 17).toUpperCase();
    const name = clean(body.name, 120);
    const email = clean(body.email, 160);
    const phone = clean(body.phone, 40);
    if (!name || (!email && !phone)) return json(400, { error: "name_and_contact_required" });

    const tradeVin = clean(body.trade_vin, 17).toUpperCase();
    const plate = clean(body.plate, 12).toUpperCase();
    const plateState = clean(body.plate_state, 2).toUpperCase();
    const mileage = num(body.trade_mileage);
    const condition = clean(body.condition, 10);
    const decoded = clean(body.decoded_label, 120);
    const valuationLow = num(body.valuation_low);
    const valuationHigh = num(body.valuation_high);

    const identity = tradeVin ? `VIN ${tradeVin}` : plate ? `Plate ${plate}${plateState ? ` (${plateState})` : ""}` : "not provided";
    const valuationLine = valuationLow != null && valuationHigh != null
      ? `Desk range $${valuationLow.toLocaleString()}–$${valuationHigh.toLocaleString()} (Black Book, ${condition})`
      : "No provider valuation returned — dealer appraisal required";

    const notes = [
      "[intent=trade]",
      `Trade: ${decoded || "vehicle not decoded"}`,
      `Identified by: ${identity}`,
      `Mileage: ${mileage != null ? mileage.toLocaleString() : "not provided"}`,
      `Condition: ${condition || "not stated"}`,
      valuationLine,
      `Shopping: ${purchaseVin || "unknown VIN"}`,
      clean(body.source_page, 200) ? `Source: ${clean(body.source_page, 200)}` : "",
      clean(body.campaign, 120) ? `Campaign: ${clean(body.campaign, 120)}` : "",
    ].filter(Boolean).join(" · ");

    const admin = adminClient();
    const { error } = await admin.from("leads").insert({
      store_id: storeId,
      name,
      email,
      phone,
      vehicle_interest: `${clean(body.purchase_label, 120) || "Vehicle"} (trade-in)`,
      vehicle_vin: purchaseVin || null,
      source: "website",
      status: "new",
      notes,
    });
    if (error) return json(500, { error: "lead_insert_failed", detail: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown_action" });
});
