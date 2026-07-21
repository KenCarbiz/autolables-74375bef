// ──────────────────────────────────────────────────────────────────────
// marketcheck-title-report — dealer-initiated NMVTIS / AAMVA title report via
// MarketCheck's VINData (NMVTIS) API. DEALER-FACING ONLY: the raw title record
// is cached in public.title_reports (never on the listing row, never shipped to
// a shopper). The customer passport only ever sees the dealer's later
// attestation (vehicle_listings.title_verification), written by the client.
//
// This is a PAID, manual tool — a generate call costs ~$0.49 and reports live
// 90 days, so:
//   action "load"     → return the cached report if present (no API cost).
//   action "generate" → paid generate-report/aamva (fresh pull). Charged.
//   action "refresh"  → access-report/aamva (cheap; reuses the 90-day report).
//
// Gated to the Compliance-Pro AutoLabels entitlement so the cost can't be
// triggered from a lower tier. Auth: tenant member or platform admin.
//
// Body: { vin, tenant_id, action? }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY } from "../_shared/supabase.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";
const REPORT_TTL_DAYS = 90;

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
  junkSalvage: { disposition: string; entity: string; date: string; state?: string }[];
  latestTitle: { state: string; date: string; odometer: string; type: string } | null;
  highestOdometer: number | null;
  message: string;
  messageColor: string;
}

// Normalize the AAMVA VINData payload into a compact, dealer-facing summary.
// "clean" ONLY when there are zero brand records AND zero junk/salvage/total-
// loss records — anything else is "branded" so the dealer never over-attests.
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
    state: undefined as string | undefined,
  }));

  // Latest title record by ISO date, when present.
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

  // ── Load the cached report (no external cost). Default action.
  const loadCached = async () => {
    const { data } = await admin.from("title_reports")
      .select("summary, generated_at, expires_at, provider")
      .eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
    return data as { summary: TitleSummary | null; generated_at: string; expires_at: string | null; provider: string } | null;
  };

  if (action === "load") {
    const cached = await loadCached();
    if (!cached) return json(200, { available: false, reason: "no_report" });
    const expired = !!cached.expires_at && new Date(cached.expires_at).getTime() < Date.now();
    return json(200, { available: true, summary: cached.summary, generatedAt: cached.generated_at, expiresAt: cached.expires_at, expired, provider: cached.provider });
  }

  if (action !== "generate" && action !== "refresh") {
    return json(400, { error: "invalid_action", note: "action must be load, generate, or refresh" });
  }

  // ── Paid path (generate/refresh) is Compliance-Pro only. A service-role
  // caller (cron/back-office) is exempt from the tier gate.
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

  // refresh reuses the existing 90-day report (cheap access-report); generate
  // always mints a fresh one (charged).
  const kind: "generate" | "access" = action === "generate" ? "generate" : "access";
  let res: Response;
  try {
    res = await fetch(endpoint(kind, vin), { signal: AbortSignal.timeout(20000) });
  } catch (_e) {
    return json(200, { available: false, reason: "provider_unreachable" });
  }

  // 422 on access = no report generated yet for this VIN → tell the dealer to generate.
  if (kind === "access" && res.status === 422) {
    return json(200, { available: false, reason: "no_report", note: "No report on file yet — generate one." });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(200, { available: false, reason: `provider_${res.status}`, detail: detail.slice(0, 300) });
  }

  // deno-lint-ignore no-explicit-any
  const raw: any = await res.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json(200, { available: false, reason: "empty_response" });

  const summary = summarize(raw);
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + REPORT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await admin.from("title_reports").upsert({
    tenant_id: tenantId,
    vin,
    provider: "vindata_nmvtis",
    report: raw,
    summary,
    generated_at: nowIso,
    expires_at: expiresIso,
    generated_by: userId,
    updated_at: nowIso,
  }, { onConflict: "tenant_id,vin" });

  return json(200, { available: true, summary, generatedAt: nowIso, expiresAt: expiresIso, charged: kind === "generate", provider: "vindata_nmvtis" });
});
