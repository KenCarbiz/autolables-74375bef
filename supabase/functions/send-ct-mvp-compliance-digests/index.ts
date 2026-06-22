import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type DigestOutboxRow = {
  id: string;
  tenant_id: string;
  subject: string;
  summary_text: string;
  digest: Record<string, unknown>;
  recipient_email: string | null;
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

const buildHtml = (row: DigestOutboxRow) => {
  const digest = row.digest as {
    needsReview?: number;
    missingFtc?: number;
    missingK208?: number;
    missingSignatures?: number;
    certifiedVehicles?: number;
    totalVehicles?: number;
    vehicles?: Array<{ stock?: string; vehicleTitle?: string; vin?: string; labels?: string[]; issues?: string[] }>;
  };
  const vehicles = Array.isArray(digest.vehicles) ? digest.vehicles.slice(0, 25) : [];
  const actionUrl = `${Deno.env.get("APP_BASE_URL") || "https://app.autolabels.io"}/compliance-center?filter=needs_review`;

  return `<!doctype html>
<html>
  <body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a;">
    <div style="max-width:720px;margin:0 auto;background:white;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
      <div style="padding:24px;background:#eff6ff;border-bottom:1px solid #bfdbfe;">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;color:#1d4ed8;letter-spacing:.08em;">AutoLabels Compliance</div>
        <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2;">${htmlEscape(row.subject)}</h1>
        <p style="margin:8px 0 0;color:#475569;">${htmlEscape(row.summary_text).replace(/\n/g, "<br />")}</p>
      </div>
      <div style="padding:20px;">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px;">
          <div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:14px;padding:14px;"><strong style="font-size:22px;color:#15803d;">${digest.certifiedVehicles || 0}</strong><br><span style="font-size:12px;color:#166534;font-weight:700;">Certified</span></div>
          <div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:14px;padding:14px;"><strong style="font-size:22px;color:#c2410c;">${digest.needsReview || 0}</strong><br><span style="font-size:12px;color:#9a3412;font-weight:700;">Needs Review</span></div>
          <div style="border:1px solid #fde68a;background:#fffbeb;border-radius:14px;padding:14px;"><strong style="font-size:22px;color:#b45309;">${digest.missingFtc || 0}</strong><br><span style="font-size:12px;color:#92400e;font-weight:700;">Missing FTC</span></div>
          <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:14px;padding:14px;"><strong style="font-size:22px;color:#b91c1c;">${digest.missingSignatures || 0}</strong><br><span style="font-size:12px;color:#991b1b;font-weight:700;">Missing Signatures</span></div>
        </div>
        <a href="${actionUrl}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;border-radius:10px;padding:12px 16px;font-weight:800;">Open Compliance Action Center</a>
        <h2 style="font-size:16px;margin:24px 0 10px;">Vehicles needing attention</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="text-align:left;color:#64748b;border-bottom:1px solid #e2e8f0;"><th style="padding:8px;">Stock</th><th style="padding:8px;">Vehicle</th><th style="padding:8px;">VIN</th><th style="padding:8px;">Issues</th></tr></thead>
          <tbody>
            ${vehicles.map((vehicle) => `<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px;font-family:monospace;">${htmlEscape(vehicle.stock || "-")}</td><td style="padding:8px;font-weight:700;">${htmlEscape(vehicle.vehicleTitle || "Vehicle")}</td><td style="padding:8px;font-family:monospace;font-size:11px;">${htmlEscape(vehicle.vin || "-")}</td><td style="padding:8px;">${htmlEscape((vehicle.labels || vehicle.issues || []).join(", "))}</td></tr>`).join("")}
          </tbody>
        </table>
        ${Array.isArray(digest.vehicles) && digest.vehicles.length > 25 ? `<p style="color:#64748b;font-size:12px;">Plus ${digest.vehicles.length - 25} more vehicles in the Action Center.</p>` : ""}
      </div>
    </div>
  </body>
</html>`;
};

const sendEmail = async (row: DigestOutboxRow) => {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("COMPLIANCE_DIGEST_FROM") || "AutoLabels Compliance <compliance@autolabels.io>";
  const to = row.recipient_email || Deno.env.get("COMPLIANCE_DIGEST_FALLBACK_EMAIL");
  if (!resendApiKey) throw new Error("RESEND_API_KEY is not configured");
  if (!to) throw new Error("No recipient email configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: row.subject,
      text: row.summary_text,
      html: buildHtml(row),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend failed: ${response.status} ${body}`);
  }

  return await response.json();
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
      .from("ct_mvp_compliance_digest_outbox")
      .select("id,tenant_id,subject,summary_text,digest,recipient_email")
      .eq("status", "queued")
      .in("channel", ["manager_digest", "email"])
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;

    const sent: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const row of (rows || []) as DigestOutboxRow[]) {
      try {
        const result = await sendEmail(row);
        await supabase
          .from("ct_mvp_compliance_digest_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString(), error: null, digest: { ...row.digest, resend: result } })
          .eq("id", row.id);
        sent.push(row.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        await supabase
          .from("ct_mvp_compliance_digest_outbox")
          .update({ status: "failed", error: message })
          .eq("id", row.id);
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
