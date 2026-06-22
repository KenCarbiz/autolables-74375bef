import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type DeliveryOutboxRow = {
  id: string;
  request_id: string;
  tenant_id: string | null;
  channel: "email" | "sms" | "crm" | "sales_notification" | "autocurb_trade";
  recipient: string | null;
  subject: string | null;
  payload: Record<string, unknown>;
};

type DeliveryRequest = {
  id: string;
  tenant_id: string | null;
  store_id: string | null;
  vehicle_id: string | null;
  vin: string | null;
  stock: string | null;
  packet_id: string | null;
  customer_name: string | null;
  customer_email: string;
  customer_phone: string | null;
  verification_required: boolean;
  verification_status: string;
  delivery_status: string;
  vehicle_of_interest: Record<string, unknown> | null;
  requested_documents: Array<{ documentType?: string; documentId?: string; documentTitle?: string }> | null;
  autocurb_handoff: Record<string, unknown> | null;
};

type PassportSettings = {
  tenant_id: string;
  email_subject_template?: string | null;
  email_intro_template?: string | null;
  allow_trade_value_cta?: boolean | null;
  autocurb_trade_enabled?: boolean | null;
  autocurb_trade_url?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const htmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const template = (value: string, variables: Record<string, string>) =>
  Object.entries(variables).reduce((out, [key, val]) => out.replaceAll(`{{${key}}}`, val), value);

const getVehicleLabel = (request: DeliveryRequest) => {
  const voi = request.vehicle_of_interest || {};
  return String(voi.title || voi.vehicleTitle || voi.ymm || voi.label || request.vin || "this vehicle");
};

const buildDocumentLinks = (request: DeliveryRequest) => {
  const baseUrl = Deno.env.get("APP_BASE_URL") || "https://app.autolabels.io";
  const docs = Array.isArray(request.requested_documents) ? request.requested_documents : [];

  if (docs.length === 0) {
    return [{ title: "Vehicle Passport", url: `${baseUrl}/vehicle/${encodeURIComponent(request.vin || request.vehicle_id || "")}` }];
  }

  return docs.map((doc, index) => {
    const params = new URLSearchParams();
    if (request.vehicle_id) params.set("vehicleId", request.vehicle_id);
    if (request.vin) params.set("vin", request.vin);
    if (request.packet_id) params.set("packetId", request.packet_id);
    if (doc.documentType) params.set("documentType", doc.documentType);
    if (doc.documentId) params.set("documentId", doc.documentId);
    return {
      title: doc.documentTitle || doc.documentType || `Document ${index + 1}`,
      url: `${baseUrl}/vehicle/${encodeURIComponent(request.vin || request.vehicle_id || "")}?${params.toString()}`,
    };
  });
};

const buildTradeUrl = (settings: PassportSettings | null, request: DeliveryRequest) => {
  const handoffUrl = request.autocurb_handoff?.trade_url;
  if (typeof handoffUrl === "string" && handoffUrl) return handoffUrl;
  if (!settings?.autocurb_trade_enabled || !settings.autocurb_trade_url) return null;
  const url = new URL(settings.autocurb_trade_url);
  if (request.vehicle_id) url.searchParams.set("interest_vehicle_id", request.vehicle_id);
  if (request.vin) url.searchParams.set("interest_vin", request.vin);
  if (request.stock) url.searchParams.set("interest_stock", request.stock);
  if (request.tenant_id) url.searchParams.set("tenant_id", request.tenant_id);
  url.searchParams.set("passport_request_id", request.id);
  return url.toString();
};

const buildHtml = (request: DeliveryRequest, settings: PassportSettings | null) => {
  const vehicleLabel = getVehicleLabel(request);
  const docLinks = buildDocumentLinks(request);
  const tradeUrl = buildTradeUrl(settings, request);
  const intro = template(settings?.email_intro_template || "Here is the vehicle information packet you requested.", {
    customer_name: request.customer_name || "",
    vehicle: vehicleLabel,
  });

  return `<!doctype html>
<html>
  <body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a;">
    <div style="max-width:720px;margin:0 auto;background:white;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
      <div style="padding:24px;background:#eff6ff;border-bottom:1px solid #bfdbfe;">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#1d4ed8;letter-spacing:.08em;">Vehicle Passport</div>
        <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2;">Your packet for ${htmlEscape(vehicleLabel)}</h1>
        <p style="margin:8px 0 0;color:#475569;">${htmlEscape(intro)}</p>
      </div>
      <div style="padding:20px;">
        <div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:18px;">
          <div style="font-size:12px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em;">Vehicle of interest</div>
          <div style="font-size:18px;font-weight:900;margin-top:6px;">${htmlEscape(vehicleLabel)}</div>
          <div style="font-family:monospace;color:#64748b;font-size:12px;margin-top:4px;">VIN: ${htmlEscape(request.vin || "-")} · Stock: ${htmlEscape(request.stock || "-")}</div>
        </div>
        <h2 style="font-size:16px;margin:0 0 10px;">Your documents</h2>
        <div style="display:grid;gap:10px;">
          ${docLinks.map((doc) => `<a href="${doc.url}" style="display:block;border:1px solid #dbeafe;background:#eff6ff;color:#1d4ed8;text-decoration:none;border-radius:12px;padding:14px;font-weight:800;">${htmlEscape(doc.title)}</a>`).join("")}
        </div>
        ${tradeUrl ? `<div style="margin-top:22px;padding:18px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:14px;"><h2 style="margin:0 0 6px;font-size:16px;color:#166534;">Have a trade?</h2><p style="margin:0 0 12px;color:#166534;font-size:13px;">Get a trade value with AutoCurb. We will carry over the vehicle you are interested in so the store has the full context.</p><a href="${tradeUrl}" style="display:inline-block;background:#16a34a;color:white;text-decoration:none;border-radius:10px;padding:12px 16px;font-weight:900;">Get My Trade Value</a></div>` : ""}
        <p style="margin-top:22px;color:#64748b;font-size:12px;line-height:1.5;">You received this because you requested vehicle information from a vehicle passport or window sticker QR code.</p>
      </div>
    </div>
  </body>
</html>`;
};

const sendEmail = async (request: DeliveryRequest, settings: PassportSettings | null, row: DeliveryOutboxRow) => {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) throw new Error("RESEND_API_KEY is not configured");

  const from = Deno.env.get("PASSPORT_DELIVERY_FROM") || Deno.env.get("COMPLIANCE_DIGEST_FROM") || "AutoLabels Passport <passport@autolabels.io>";
  const dealerName = String(request.vehicle_of_interest?.dealerName || request.vehicle_of_interest?.dealer_name || "the dealership");
  const subjectTemplate = row.subject || settings?.email_subject_template || "Your vehicle information packet from {{dealer_name}}";
  const subject = template(subjectTemplate, {
    dealer_name: dealerName,
    vehicle: getVehicleLabel(request),
    customer_name: request.customer_name || "",
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: row.recipient || request.customer_email,
      subject,
      html: buildHtml(request, settings),
      text: `${subject}\n\n${buildDocumentLinks(request).map((doc) => `${doc.title}: ${doc.url}`).join("\n")}`,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase service credentials are not configured");

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit || 25), 100);

    const { data: rows, error } = await supabase
      .from("passport_document_delivery_outbox")
      .select("id,request_id,tenant_id,channel,recipient,subject,payload")
      .eq("status", "queued")
      .eq("channel", "email")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;

    const sent: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const row of (rows || []) as DeliveryOutboxRow[]) {
      try {
        const { data: requestRow, error: requestError } = await supabase
          .from("passport_document_delivery_requests")
          .select("id,tenant_id,store_id,vehicle_id,vin,stock,packet_id,customer_name,customer_email,customer_phone,verification_required,verification_status,delivery_status,vehicle_of_interest,requested_documents,autocurb_handoff")
          .eq("id", row.request_id)
          .maybeSingle();
        if (requestError) throw requestError;
        if (!requestRow) throw new Error("Delivery request not found");

        const requestRecord = requestRow as DeliveryRequest;
        if (requestRecord.verification_required && requestRecord.verification_status !== "verified") {
          throw new Error("Request is not SMS verified yet");
        }

        let settings: PassportSettings | null = null;
        if (requestRecord.tenant_id) {
          const { data: settingsRow } = await supabase
            .from("passport_delivery_settings")
            .select("tenant_id,email_subject_template,email_intro_template,allow_trade_value_cta,autocurb_trade_enabled,autocurb_trade_url")
            .eq("tenant_id", requestRecord.tenant_id)
            .maybeSingle();
          settings = settingsRow as PassportSettings | null;
        }

        const result = await sendEmail(requestRecord, settings, row);
        const now = new Date().toISOString();

        await supabase
          .from("passport_document_delivery_outbox")
          .update({ status: "sent", sent_at: now, error: null, provider: "resend", provider_message_id: result.id || null, payload: { ...row.payload, resend: result } })
          .eq("id", row.id);

        await supabase
          .from("passport_document_delivery_requests")
          .update({ delivery_status: "sent", delivered_at: now, lead_status: "created" })
          .eq("id", requestRecord.id);

        await supabase.from("customer_engagement_events").insert({
          tenant_id: requestRecord.tenant_id,
          store_id: requestRecord.store_id,
          vehicle_id: requestRecord.vehicle_id,
          vin: requestRecord.vin,
          stock: requestRecord.stock,
          session_id: `delivery_${requestRecord.id}`,
          source: "email",
          surface: "document_packet",
          event_type: "document_downloaded",
          packet_id: requestRecord.packet_id,
          metadata: { request_id: requestRecord.id, delivery_outbox_id: row.id, delivered_to: requestRecord.customer_email },
        });

        sent.push(row.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        await supabase.from("passport_document_delivery_outbox").update({ status: "failed", error: message }).eq("id", row.id);
        failed.push({ id: row.id, error: message });
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
