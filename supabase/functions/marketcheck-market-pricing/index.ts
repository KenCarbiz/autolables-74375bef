// ──────────────────────────────────────────────────────────────────────
// marketcheck-market-pricing — RETIRED. Compatibility proxy only.
//
// This function used to own a market decision, and it owned it badly:
//
//   • it described a certified car to the provider as an ordinary used one,
//     because certification had nowhere to go in the legacy prediction
//     request — which is how a CPO QX50 came to be valued as an ordinary one;
//   • it compared `vehicle_listings.price`, a fee-INCLUSIVE number, against a
//     prediction of the vehicle alone, charging the customer's $895 conveyance
//     fee to the car before any valuation question was asked;
//   • it classified the result with its own -6%/-2%/+3% thresholds, a private
//     opinion about "great deal" that nothing else in the product shared;
//   • it wrote market_value, market_position and market_payload directly, so
//     it raced vehicle-enrich for the same columns every night.
//
// All of that now lives in `market-valuation-write`, which is the single
// writer. This endpoint stays only so existing callers keep working, and it
// does exactly one thing: forward the request and return the canonical
// MarketView. It performs no arithmetic, holds no thresholds, and writes no
// column of its own.
//
// Body: { vin, tenant_id, batch?, force? }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY } from "../_shared/supabase.ts";
import { constantTimeEquals } from "../_shared/functionAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

/** Forward one VIN to the single writer and hand back what it decided. */
async function delegate(vin: string, tenantId: string, force: boolean): Promise<Response> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/market-valuation-write`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ vin, tenant_id: tenantId, force }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  return json(res.status, body);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id || null;

  // Auth gate unchanged in CONTRACT: service role passes, otherwise tenant
  // membership or platform admin is required. What changed is how the service
  // credential is compared.
  //
  // `auth !== SERVICE_KEY` is a variable-time comparison against a secret:
  // JavaScript string equality returns at the first differing byte, so the
  // time it takes leaks how much of a guess was correct. Gate 14D removed this
  // exact shape from the writer and left it standing here. Same secret, same
  // exposure, so it gets the same reviewed comparison: both operands are
  // digested under a per-process random key and compared over the full
  // fixed-width digest.
  //
  // Deliberately still Authorization-only. `readCredentials` would also accept
  // an `apikey` header as a service credential, and widening which header can
  // carry a service credential is not a timing fix.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!SERVICE_KEY || !auth || !(await constantTimeEquals(auth, SERVICE_KEY))) {
    const { data: ures } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (!userId) return json(401, { error: "authentication required" });
    if (!tenantId) return json(400, { error: "tenant_id required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
      if (!membership) return json(403, { error: "not a member of this tenant" });
    }
  }

  if (!tenantId) return json(400, { error: "tenant_id required" });

  // A batch is a queue instruction, not a licence to spend. Each VIN goes
  // through the writer, which reserves and budgets every paid call itself.
  if (body.batch) {
    return json(400, {
      error: "batch_retired",
      note: "Batch valuation is scheduled through market-valuation-write, which enforces the"
        + " per-tenant provider budget and one live reservation per request fingerprint.",
    });
  }

  const vin = String(body.vin || "").toUpperCase().trim();
  if (!validVin(vin)) return json(400, { error: "invalid_vin" });

  return await delegate(vin, tenantId, body.force === true);
});
