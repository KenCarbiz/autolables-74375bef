// ──────────────────────────────────────────────────────────────────────
// lead-alert — pages the dealer the moment a passport lead is submitted.
//
// The packet-view notification already emails on a mere page view; a
// submitted lead is far hotter and previously landed silently in the
// leads table. Speed-to-lead is the strongest close-rate lever in
// automotive, so this fires immediately after the client inserts the
// lead row (fire-and-forget from LeadForm — never blocks the shopper).
//
// Body: { slug, vin?, intent?, name, phone?, email?, source? }
// Recipients: dealer_profiles.settings.lead_notify_email, falling back
// to view_notify_email when packet-view alerts are enabled.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY } from "../_shared/supabase.ts";

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
      .select("id, tenant_id, store_id, ymm, trim, price, vin, stock_number, slug")
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

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
        <p style="font-size:13px;font-weight:700;color:#16A34A;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em">${esc(label)}${viaQr ? " &middot; scanned the window sticker" : ""}</p>
        <h2 style="font-size:20px;margin:0 0 2px">${esc(name)}</h2>
        ${contactBits ? `<p style="font-size:14px;margin:2px 0 10px">${contactBits}</p>` : ""}
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
      store_id: row.store_id || null, details: { intent, source, recipients: recipients.length },
    });

    return json(200, { ok: true, sent: true });
  } catch (err) {
    return json(200, { ok: false, error: String((err as Error)?.message || err) });
  }
});
