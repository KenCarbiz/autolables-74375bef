// ──────────────────────────────────────────────────────────────────────
// lead-alert — pages the dealer the moment a passport lead is submitted.
//
// The packet-view notification already emails on a mere page view; a
// submitted lead is far hotter and previously landed silently in the
// leads table. Speed-to-lead is the strongest close-rate lever in
// automotive, so this fires immediately after the client inserts the
// lead row (fire-and-forget from LeadForm — never blocks the shopper).
//
// Contact routing: this function is the lead-time authority. It
// re-resolves the Customer Passport routing WITH the shopper's identity
// (CRM ownership = a prior lead from the same email/phone routed to an
// agent), stamps the routing decision onto the fresh lead row, advances
// the sales rotation memory, and addresses the alert email to the routed
// target (agent → their inbox, BDC → the BDC inbox, otherwise the
// store's configured lead recipients).
//
// Body: { slug, vin?, intent?, name, phone?, email?, source?, sub_source? }
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY } from "../_shared/supabase.ts";
import { resolveCustomerPassportRouting, type PassportAgent, type PassportRoutingResult } from "../_shared/passport-routing.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

const esc = (s: unknown) =>
  String(s ?? "").slice(0, 200).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const INTENT_LABEL: Record<string, string> = {
  reserve: "Reserve request", trade: "Trade-in inquiry", test_drive: "Test drive request",
  todays_price: "Today's price request", contact: "Contact request", offers: "Best-offer request",
  text: "Text-back request", protect: "Protection inquiry", check_availability: "Availability check",
};

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  try {
    const body = await req.json().catch(() => ({}));
    const slug = String(body.slug || "").trim();
    const name = String(body.name || "").trim();
    if (!slug || !name) return json(400, { ok: false, error: "slug and name required" });

    const admin = adminClient();
    const { data: rows } = await admin
      .from("vehicle_listings")
      .select("id, tenant_id, store_id, ymm, trim, price, vin, stock_number, slug, assigned_agent_id")
      .eq("slug", slug)
      .limit(1);
    const row = rows?.[0];
    if (!row?.tenant_id) return json(200, { ok: false, error: "listing_not_found" });

    const { data: prof } = await admin
      .from("dealer_profiles").select("settings").eq("tenant_id", row.tenant_id).maybeSingle();
    const s = (prof?.settings ?? {}) as Record<string, unknown>;
    const parse = (v: unknown) => String(v || "").split(/[\n,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
    let recipients = parse(s.lead_notify_email);
    if (!recipients.length && (s.view_notify_enabled === true || String(s.view_notify_enabled) === "true")) {
      recipients = parse(s.view_notify_email);
    }

    // ── Resolve contact routing at lead time (identity now known).
    const leadEmail = String(body.email || "").trim().toLowerCase();
    const leadPhone = String(body.phone || "").replace(/[^\d]/g, "");
    let routing: PassportRoutingResult | null = null;
    let routedEmail: string | null = null;
    try {
      const agents = (Array.isArray(s.passport_agents) ? s.passport_agents : []) as PassportAgent[];
      // CRM ownership: the most recent prior lead from this shopper at this
      // store that was routed to a specific agent. Never re-assign someone
      // who is already working with a person.
      let crmOwnerAgentId: string | null = null;
      if ((leadEmail || leadPhone) && agents.length > 0) {
        const q = admin.from("leads")
          .select("routed_agent_id, created_at, email, phone")
          .eq("store_id", row.store_id)
          .not("routed_agent_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(25);
        const { data: prior } = await q;
        const match = (prior || []).find((l: Record<string, unknown>) =>
          (leadEmail && String(l.email || "").toLowerCase() === leadEmail) ||
          (leadPhone && String(l.phone || "").replace(/[^\d]/g, "") === leadPhone));
        if (match?.routed_agent_id && agents.some((a) => a.id === match.routed_agent_id)) {
          crmOwnerAgentId = String(match.routed_agent_id);
        }
      }
      const assignments = (s.vehicle_agent_assignments ?? {}) as Record<string, string>;
      routing = resolveCustomerPassportRouting(s.passport_contact_routing, {
        agents,
        assignedAgentId: (row.assigned_agent_id as string) || assignments[String(row.vin || "").toUpperCase()] || null,
        crmOwnerAgentId,
        rotationState: (s.passport_rotation_state ?? {}) as Record<string, string>,
        now: new Date(),
      });
      if (routing.email) routedEmail = routing.email.toLowerCase();

      // Stamp the freshest matching lead row (client inserts anonymously and
      // can't read the id back) and advance rotation memory.
      const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data: fresh } = await admin.from("leads")
        .select("id").eq("store_id", row.store_id).eq("vehicle_vin", row.vin)
        .eq("name", name).gte("created_at", twoMinAgo)
        .order("created_at", { ascending: false }).limit(1);
      const leadId = fresh?.[0]?.id || null;
      if (leadId) {
        const isAgentTarget = ["crm_owner", "vehicle_assigned_agent", "sales_rotation"].includes(routing.routingTargetType);
        await admin.from("leads").update({
          routed_agent_id: isAgentTarget ? routing.routingTargetId ?? null : null,
          routing: {
            source: "customer_passport",
            routingTargetType: routing.routingTargetType,
            routingTargetId: routing.routingTargetId ?? null,
            routingReason: routing.routingReason,
            displayMode: routing.displayMode,
            afterHours: routing.afterHours,
          },
          sub_source: String(body.sub_source || "") || null,
        }).eq("id", leadId).then(() => {}, () => {});
      }
      if (routing.routingTargetType === "sales_rotation" && routing.routingTargetId) {
        const state = { ...((s.passport_rotation_state ?? {}) as Record<string, string>), [routing.routingTargetId]: new Date().toISOString() };
        await admin.from("dealer_profiles")
          .update({ settings: { ...s, passport_rotation_state: state } })
          .eq("tenant_id", row.tenant_id).then(() => {}, () => {});
      }
    } catch { /* routing must never block the alert */ }

    // Routed agent/BDC/manager email leads the recipient list; store
    // recipients stay CC'd so nothing dead-ends on a stale roster.
    if (routedEmail && !recipients.includes(routedEmail)) recipients = [routedEmail, ...recipients];
    if (!recipients.length) return json(200, { ok: true, sent: false, note: "no recipients configured" });

    const intent = String(body.intent || "contact");
    const label = INTENT_LABEL[intent] || "New lead";
    const source = String(body.source || "website");
    const viaQr = source === "qr_scan";
    const title = esc(`${row.ymm || "Vehicle"}${row.trim ? ` ${row.trim}` : ""}`);
    const priceNum = Number(row.price);
    const priceStr = Number.isFinite(priceNum) && priceNum > 0 ? `$${Math.round(priceNum).toLocaleString("en-US")}` : "";
    const origin = (req.headers.get("origin") || "").replace(/\/$/, "");
    const packetUrl = `${origin || "https://autolabels.io"}/v/${encodeURIComponent(row.slug)}`;
    const contactBits = [body.phone ? `<a href="tel:${esc(body.phone)}">${esc(body.phone)}</a>` : "", esc(body.email)].filter(Boolean).join(" &middot; ");
    const routedLine = routing && routing.routingTargetType !== "dealership_default"
      ? `<p style="font-size:12px;color:#64748B;margin:0 0 10px">Routed to: <b>${esc(routing.routingTargetType.replace(/_/g, " "))}</b>${routing.routingTargetId ? ` (${esc(routing.routingTargetId)})` : ""}</p>`
      : "";

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
        <p style="font-size:13px;font-weight:700;color:#16A34A;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em">${esc(label)}${viaQr ? " &middot; scanned the window sticker" : ""}</p>
        <h2 style="font-size:20px;margin:0 0 2px">${esc(name)}</h2>
        ${contactBits ? `<p style="font-size:14px;margin:2px 0 10px">${contactBits}</p>` : ""}
        ${routedLine}
        <p style="font-size:15px;margin:0 0 2px">${title}${priceStr ? ` &middot; <b>${priceStr}</b>` : ""}</p>
        <p style="font-size:13px;color:#475569;margin:0 0 16px">VIN ${esc(row.vin)}${row.stock_number ? ` &middot; Stock ${esc(row.stock_number)}` : ""}</p>
        <a href="${packetUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:11px 18px;border-radius:12px;font-weight:600;font-size:14px">Open the vehicle packet</a>
        <p style="font-size:12px;color:#94A3B8;margin:18px 0 0">Respond fast — this shopper just raised their hand on your vehicle.</p>
      </div>`;

    await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to: recipients, subject: `Lead${viaQr ? " (QR scan)" : ""}: ${name} — ${row.ymm || "vehicle"}`, html }),
    }).catch(() => {});

    await admin.from("audit_log").insert({
      action: "lead_alert_sent", entity_type: "vehicle_listing", entity_id: row.id,
      store_id: row.store_id || null,
      details: {
        intent, source, recipients: recipients.length,
        routing_target_type: routing?.routingTargetType ?? null,
        routing_target_id: routing?.routingTargetId ?? null,
        routing_reason: routing?.routingReason ?? null,
      },
    });

    return json(200, { ok: true, sent: true, routed: routing?.routingTargetType ?? null });
  } catch (err) {
    return json(200, { ok: false, error: String((err as Error)?.message || err) });
  }
});
