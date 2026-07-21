// ──────────────────────────────────────────────────────────────────────
// marketcheck-title-report — dealer-initiated NMVTIS / AAMVA title report via
// MarketCheck's VINData API. Compliance-Pro only.
//
// VINData terms compliance (accepted third-party data agreement):
//   • "I will not cache or persist VINData responses beyond a single user
//     session." → We NEVER write the report or summary to our database. It is
//     returned to the open admin panel for the session and nowhere else.
//   • Re-viewing within 90 days uses VINData's own access-report (provider-side
//     retrieval of the already-generated report) — that is their cache, allowed.
//   • The dealer's later attestation (vehicle_listings.title_verification) is
//     the dealership's own conclusion (clean/branded + date), not a VINData
//     response, so it is a business record we may keep.
//   • title_report_pulls is our billing meter (tenant/vin/cost) — no VINData
//     data — so we may keep it.
//
// A generate is charged (~$0.49); access is cost-effective. Manual only.
//
// Body: { vin, tenant_id, action? }  action = load | generate | view
//   load     → no API call; returns the spend meter + whether a live report is
//              retrievable via access (a generate happened in the last 90 days).
//   generate → paid generate-report/aamva (fresh pull). Charged. Session-only.
//   view     → access-report/aamva (cheap; retrieves the 90-day report). If none
//              exists yet (422) the panel is told to generate. Session-only.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY } from "../_shared/supabase.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";
const REPORT_TTL_DAYS = 90;            // VINData keeps a generated report this long
const GENERATE_UNIT_COST = 0.49;       // USD per paid generate (provider list price)

// VIN: 17 chars, letters/digits, excluding I, O, Q.
const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

// deno-lint-ignore no-explicit-any
const str = (v: any) => (v == null ? "" : String(v));
// deno-lint-ignore no-explicit-any
const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

interface TitleSummary {
  status: "clean" | "branded" | "unknown";
  brandCount: number;
  junkCount: number;
  brands: { brand: string; description: string; state: string; date: string; severity: string }[];
  junkSalvage: { disposition: string; entity: string; date: string }[];
  latestTitle: { state: string; date: string; odometer: string; type: string } | null;
  highestOdometer: number | null;
  message: string;
  messageColor: string;
}

// Normalize the AAMVA VINData payload into a compact, dealer-facing summary,
// returned for the session only. "clean" ONLY when there are zero brand records
// AND zero junk/salvage/total-loss records, so the dealer never over-attests.
// deno-lint-ignore no-explicit-any
function summarize(raw: any): TitleSummary {
  const brandsRaw = arr(raw?.titleBrandReported);
  const junkRaw = arr(raw?.junkSalvageTotalLoss);
  const titles = arr(raw?.titleInformation);
  const odos = arr(raw?.odometerInformation);

  const brands = brandsRaw.map((b) => ({
    brand: str(b?.brand || b?.description || b?.code) || "Title brand",
    description: str(b?.description),
    state: str(b?.state),
    date: str(b?.date),
    severity: str(b?.color),
  }));
  const junkSalvage = junkRaw.map((j) => ({
    disposition: str(j?.disposition) || "Junk / salvage / total loss",
    entity: str(j?.reportedEntity),
    date: str(j?.date),
  }));

  const sortedTitles = [...titles].sort((a, b) => str(b?.date).localeCompare(str(a?.date)));
  const t0 = sortedTitles[0];
  const latestTitle = t0
    ? { state: str(t0?.state), date: str(t0?.date), odometer: str(t0?.reportedOdometer), type: str(t0?.type) }
    : null;

  const odoNums = odos
    .map((o) => Number(String(o?.reportedOdometer ?? "").replace(/[^0-9.]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const highestOdometer = odoNums.length ? Math.max(...odoNums) : null;

  const hasIssue = brands.length > 0 || junkSalvage.length > 0;
  return {
    status: hasIssue ? "branded" : "clean",
    brandCount: brands.length,
    junkCount: junkSalvage.length,
    brands,
    junkSalvage,
    latestTitle,
    highestOdometer,
    message: str(raw?.reportSummary?.message),
    messageColor: str(raw?.reportSummary?.color),
  };
}

const endpoint = (kind: "generate" | "access", vin: string) =>
  `${MC_BASE}/vindata/${kind}-report/aamva/${encodeURIComponent(vin)}?api_key=${encodeURIComponent(MC_KEY)}`;

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!MC_KEY) return json(200, { error: "not_configured", note: "Set MARKETCHECK_API_KEY_1 with VINData (NMVTIS) access" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id || null;
  const action: string = String(body.action || "load");
  const vin = String(body.vin || "").toUpperCase().trim();

  if (!tenantId) return json(400, { error: "tenant_id required" });
  if (!vin) return json(400, { error: "vin required" });
  if (!validVin(vin)) return json(400, { error: "invalid_vin", note: "VIN must be 17 chars with no I, O, or Q" });

  // ── Auth: service-role bypasses; otherwise require a member of this tenant
  // or a platform admin.
  const authHeader = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let userId: string | null = null;
  if (authHeader !== SERVICE_KEY) {
    const { data: ures, error: uerr } = await admin.auth.getUser(authHeader);
    userId = ures?.user?.id ?? null;
    if (uerr || !userId) return json(401, { error: "authentication required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
      if (!membership) return json(403, { error: "not a member of this tenant" });
    }
  }

  // Running spend meter (our billing metadata — no VINData data): charged pulls
  // this calendar month + all-time, plus the most recent generate so the panel
  // can pick access vs generate and show "last checked".
  const pullStats = async () => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const [monthRes, totalRes, lastGenRes] = await Promise.all([
      admin.from("title_report_pulls").select("unit_cost")
        .eq("tenant_id", tenantId).eq("charged", true).gte("created_at", monthStart),
      admin.from("title_report_pulls").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("charged", true),
      admin.from("title_report_pulls").select("created_at")
        .eq("tenant_id", tenantId).eq("vin", vin).eq("action", "generate")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const monthRows = (monthRes.data || []) as { unit_cost: number | null }[];
    const monthCost = monthRows.reduce((s, r) => s + Number(r.unit_cost || 0), 0);
    const lastGeneratedAt = (lastGenRes.data as { created_at?: string } | null)?.created_at || null;
    const withinWindow = !!lastGeneratedAt && (Date.now() - new Date(lastGeneratedAt).getTime()) < REPORT_TTL_DAYS * 864e5;
    return {
      monthCount: monthRows.length,
      monthCost: Math.round(monthCost * 100) / 100,
      totalCount: totalRes.count ?? 0,
      unitCost: GENERATE_UNIT_COST,
      lastGeneratedAt,
      withinWindow,
    };
  };

  // ── load: no external call, no VINData data. Just the meter + retrievability.
  if (action === "load") {
    const stats = await pullStats();
    return json(200, { stats });
  }

  if (action !== "generate" && action !== "view") {
    return json(400, { error: "invalid_action", note: "action must be load, generate, or view" });
  }

  // ── Paid path is Compliance-Pro only. Service-role callers are exempt.
  if (authHeader !== SERVICE_KEY) {
    const { data: ent } = await admin.from("app_entitlements")
      .select("plan_tier, status").eq("tenant_id", tenantId).eq("app_slug", "autolabels").maybeSingle();
    const tier = str((ent as { plan_tier?: string } | null)?.plan_tier);
    const status = str((ent as { status?: string } | null)?.status);
    const active = status === "active" || status === "trial";
    if (tier !== "compliance_pro" || !active) {
      return json(403, { error: "plan_required", plan: "compliance_pro", note: "Title verification is a Compliance Pro feature." });
    }
  }

  const kind: "generate" | "access" = action === "generate" ? "generate" : "access";
  let res: Response;
  try {
    res = await fetch(endpoint(kind, vin), { signal: AbortSignal.timeout(20000) });
  } catch (_e) {
    return json(200, { available: false, reason: "provider_unreachable" });
  }

  // 422 on access = no report generated yet for this VIN → tell the dealer to generate.
  if (kind === "access" && res.status === 422) {
    return json(200, { available: false, reason: "no_report", note: "No report on file yet — generate one.", stats: await pullStats() });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(200, { available: false, reason: `provider_${res.status}`, detail: detail.slice(0, 300), stats: await pullStats() });
  }

  // deno-lint-ignore no-explicit-any
  const raw: any = await res.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json(200, { available: false, reason: "empty_response", stats: await pullStats() });

  const summary = summarize(raw);
  const charged = kind === "generate";

  // Meter the pull ONLY (append-only, no VINData data), then read the total.
  await admin.from("title_report_pulls").insert({
    tenant_id: tenantId, vin, action, charged,
    unit_cost: charged ? GENERATE_UNIT_COST : 0, pulled_by: userId,
  }).then(() => undefined, () => undefined);
  const stats = await pullStats();

  // Session-only response. Nothing here is written to our database.
  return json(200, {
    available: true,
    summary,
    charged,
    checkedAt: new Date().toISOString(),
    provider: "vindata_nmvtis",
    attribution: "Title data provided by VINData, LLC via MarketCheck (NMVTIS).",
    disclaimer: "Title-history data is provided “as is” and is not a substitute for a full title search.",
    stats,
  });
});
