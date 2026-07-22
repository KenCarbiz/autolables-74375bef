import { json, preflight, htmlEscape } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient, isServiceOrCron } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// process-deal — the used-car manager's "Process this deal" action (FLOW #5).
// Assembles the vehicle's finished documents by VIN — accepted addendum, K-208
// safety inspection, Get-Ready record, FTC Buyers Guide — emails the office /
// deal desk a summary with links, stamps deal_processed_at on the listing, and
// records the event. No deals table: the deal record is assembled live from the
// tables that already carry tenant_id + vin.
//
// Body: { tenant_id, vin }
// Recipients: settings.deal_desk_email, then settings.title_clerk_email, then
//   the dealership primary_email.
// Auth: service-role / cron, OR a signed-in MANAGER member of the tenant.
// ──────────────────────────────────────────────────────────────────────

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://autolabels.io";
const splitEmails = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter((x) => /.+@.+\..+/.test(x));

// Roles that hold can_approve_print (mirrors dealerRoleCapabilities.ts).
const MANAGER_ROLES = new Set([
  "owner", "general_manager", "gsm", "admin", "manager",
  "sales_manager", "used_car_manager", "inventory_manager",
]);

// deno-lint-ignore no-explicit-any
async function isManagerMember(admin: any, req: Request, tenantId: string): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: u } = await admin.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return false;
  const { data: pa } = await admin.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
  if (pa) return true;
  const { data: m } = await admin.from("tenant_members")
    .select("role").eq("tenant_id", tenantId).eq("user_id", uid).not("accepted_at", "is", null).maybeSingle();
  return !!m && MANAGER_ROLES.has(String(m.role));
}

const yes = (b: boolean) => (b ? "&#10003;" : "&mdash;");

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").toUpperCase().trim();
  if (!tenantId || !vin) return json(400, { error: "tenant_id and vin required" });

  const admin = adminClient();
  if (!isServiceOrCron(req) && !(await isManagerMember(admin, req, tenantId))) {
    return json(401, { error: "unauthorized" });
  }

  // Vehicle + the four source documents, assembled by tenant_id + vin.
  const { data: listing } = await admin.from("vehicle_listings")
    .select("id, ymm, condition, price").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  if (!listing?.id) return json(404, { error: "vehicle not found" });
  const listingId = listing.id as string;
  const ymm = (listing.ymm as string) || "Vehicle";

  const [add, k208, gr, detail, bg] = await Promise.all([
    admin.from("addendums").select("id, accepted_at, selling_price, status, signed_at")
      .eq("tenant_id", tenantId).eq("vehicle_vin", vin).not("accepted_at", "is", null)
      .order("accepted_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("safety_inspections").select("id, status, result, signed_at")
      .eq("tenant_id", tenantId).eq("vin", vin).eq("status", "signed")
      .order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("get_ready_records").select("id, get_ready_complete_date, inspection_complete")
      .eq("tenant_id", tenantId).eq("vin", vin).limit(1).maybeSingle(),
    admin.from("detail_signoffs").select("id").eq("tenant_id", tenantId).eq("vin", vin).eq("status", "signed").limit(1).maybeSingle(),
    admin.from("generated_documents").select("id, document_status, data_snapshot")
      .eq("tenant_id", tenantId).eq("vehicle_id", listingId).eq("document_type", "buyers_guide")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const hasAddendum = !!add.data?.accepted_at;
  const hasK208 = !!k208.data?.id;
  const hasGetReady = !!gr.data?.id && (!!gr.data?.get_ready_complete_date || !!detail.data?.id);
  const bgStatus = String(bg.data?.document_status || "");
  const hasBuyersGuide = !!bg.data?.id && ["approved", "printed", "published"].includes(bgStatus);
  const isUsed = ["used", "cpo", "certified"].includes(String(listing.condition || "used").toLowerCase());

  // Recipients: deal desk → office/title clerk → dealership primary email.
  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, string>;
  let recipients = splitEmails(settings.deal_desk_email || settings.title_clerk_email || "");
  if (recipients.length === 0) {
    const { data: ten } = await admin.from("tenants").select("primary_email").eq("id", tenantId).maybeSingle();
    recipients = splitEmails((ten?.primary_email as string) || "");
  }
  recipients = recipients.slice(0, 3);

  // Always stamp the deal as processed (the office may pick it up in-app even if
  // no email is configured); the email is best-effort.
  await admin.from("vehicle_listings")
    .update({ deal_processed_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", listingId);
  try {
    await admin.from("audit_log").insert({
      action: "deal_processed", entity_type: "vehicle", entity_id: vin, store_id: tenantId,
      details: { addendum: hasAddendum, k208: hasK208, get_ready: hasGetReady, buyers_guide: hasBuyersGuide, recipients: recipients.length },
    });
  } catch { /* best-effort */ }

  if (recipients.length === 0) return json(200, { ok: true, emailed: false, error: "no_recipient" });

  const dealUrl = `${APP_BASE}/vehicle-file/${listingId}`;
  const priceLine = add.data?.selling_price != null ? `$${Number(add.data.selling_price).toLocaleString()}`
    : (listing.price != null ? `$${Number(listing.price).toLocaleString()}` : "");

  const row = (label: string, ok: boolean, note = "") =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">${htmlEscape(label)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #E6E8EC;color:${ok ? "#16A34A" : "#B45309"};font-weight:bold">${ok ? "Complete" : "Missing"} ${yes(ok)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #E6E8EC;color:#64748B">${htmlEscape(note)}</td></tr>`;

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0F172A">
    <h2 style="margin:0 0 2px">Deal ready to file — ${htmlEscape(ymm)}</h2>
    <p style="color:#64748B;margin:0 0 4px">VIN ${htmlEscape(vin)}${priceLine ? ` · ${priceLine}` : ""}</p>
    <p style="margin:12px 0">The used-car manager processed this deal. Here is the document record:</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      ${row("Signed addendum (accepted)", hasAddendum)}
      ${isUsed ? row("Safety inspection (K-208)", hasK208) : ""}
      ${row("Get-Ready record", hasGetReady)}
      ${isUsed ? row("FTC Buyers Guide", hasBuyersGuide, hasBuyersGuide ? "" : "confirm & publish in the Buyers Guide") : ""}
    </table>
    <p style="margin:18px 0"><a href="${dealUrl}" style="display:inline-block;background:#2563EB;color:#fff;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:10px">Open the deal record</a></p>
    <p style="color:#94A3B8;font-size:12px;margin:8px 0 0">Every document is retained per VIN as part of the dealer's compliance record.</p>
  </div>`;

  const sent = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ to: recipients, subject: `Deal filed: ${ymm}`, html }),
  }).catch(() => null);

  return json(200, { ok: true, emailed: !!(sent && sent.ok), recipients: recipients.length });
});
