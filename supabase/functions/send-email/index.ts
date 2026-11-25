import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { htmlEscape } from "../_shared/http.ts";
import { constantTimeEquals } from "../_shared/functionAuth.ts";
import { isAllowedRedirectUrl, resolveAllowedOrigin } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUTHORIZED_SENDER_ROLES = new Set([
  "owner", "admin", "general_manager", "gsm", "manager",
  "sales_manager", "used_car_manager", "inventory_manager",
  "fni_manager", "finance", "finance_manager", "office_manager",
]);

const MAX_PDF_BASE64_LEN = 10 * 1024 * 1024;

// Supports Resend (recommended) or SendGrid
// Set RESEND_API_KEY or SENDGRID_API_KEY in Supabase secrets

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth gate ────────────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "missing bearer token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isServiceRole = Boolean(serviceKey && await constantTimeEquals(jwt, serviceKey));
    let callerUserId: string | null = null;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (!isServiceRole) {
      const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
      if (userErr || !userRes?.user) {
        return new Response(JSON.stringify({ error: "invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerUserId = userRes.user.id;
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    let to = body.to as string | string[] | undefined;
    let subject = typeof body.subject === "string" ? body.subject : "";
    let html = typeof body.html === "string" ? body.html : "";
    let from = isServiceRole && typeof body.from === "string" ? body.from : undefined;
    let replyTo = isServiceRole && typeof body.replyTo === "string" ? body.replyTo : undefined;
    let attachments = isServiceRole ? body.attachments : undefined;

    // ── Strict template + role + recipient enforcement for user-JWT callers ──
    // Arbitrary subject/HTML/from/attachments are restricted exclusively to
    // service-role callers. Interactive callers must hold an authorized
    // dealership manager/finance role and invoke a server-rendered template.
    if (!isServiceRole && callerUserId) {
      const template = typeof body.template === "string" ? body.template.trim() : "";
      if (!template) {
        return new Response(JSON.stringify({
          error: "template_required",
          message: "Direct arbitrary HTML email is restricted to server-side callers; use a supported template.",
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const [{ data: pa }, { data: memberships }] = await Promise.all([
        admin.from("user_roles").select("role").eq("user_id", callerUserId).eq("role", "admin").maybeSingle(),
        admin.from("tenant_members")
          .select("tenant_id, role")
          .eq("user_id", callerUserId)
          .not("accepted_at", "is", null),
      ]);
      const isPlatformAdmin = Boolean(pa);
      const authorizedTenantIds = (memberships || [])
        .filter((m: { role?: string }) => isPlatformAdmin || AUTHORIZED_SENDER_ROLES.has(String(m.role || "").trim().toLowerCase()))
        .map((m: { tenant_id: string }) => m.tenant_id);

      if (authorizedTenantIds.length === 0) {
        return new Response(JSON.stringify({ error: "insufficient_role_for_email" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recipients = (Array.isArray(to) ? to : [to])
        .map((e: unknown) => String(e || "").trim().toLowerCase())
        .filter(Boolean);
      if (recipients.length === 0) {
        return new Response(JSON.stringify({ error: "no recipients" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (recipients.length > 25) {
        return new Response(JSON.stringify({ error: "too many recipients (max 25 per call)" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allow = new Set<string>();
      const collect = (rows: Array<Record<string, unknown>> | null, field: string) => {
        for (const r of rows || []) {
          const v = r[field];
          if (typeof v === "string" && v.includes("@")) allow.add(v.trim().toLowerCase());
        }
      };
      const [recRes, leadsRes, memRes, signRes, dealRes] = await Promise.all([
        admin.from("email_recipients").select("email").in("tenant_id", authorizedTenantIds),
        admin.from("leads").select("email").in("tenant_id", authorizedTenantIds),
        admin.from("tenant_members").select("invited_email").in("tenant_id", authorizedTenantIds).not("accepted_at", "is", null),
        admin.from("addendum_signings").select("signer_email").in("tenant_id", authorizedTenantIds),
        admin.from("deal_signing_tokens").select("customer_email").in("tenant_id", authorizedTenantIds),
      ]);
      collect(recRes.data as Array<Record<string, unknown>> | null, "email");
      collect(leadsRes.data as Array<Record<string, unknown>> | null, "email");
      collect(memRes.data as Array<Record<string, unknown>> | null, "invited_email");
      collect(signRes.data as Array<Record<string, unknown>> | null, "signer_email");
      collect(dealRes.data as Array<Record<string, unknown>> | null, "customer_email");

      const blocked = recipients.filter((r) => !allow.has(r));
      if (blocked.length > 0) {
        return new Response(JSON.stringify({
          error: "recipient_not_allowed",
          message: "user-JWT senders may only email contacts within their tenants",
          blocked,
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
      const origin = resolveAllowedOrigin([req.headers.get("origin")], "https://autolabels.io");
      to = recipients;
      from = undefined;
      replyTo = undefined;
      attachments = undefined;

      if (template === "addendum_signing_link") {
        const addendumId = String(data.addendum_id || "").trim();
        if (!addendumId) {
          return new Response(JSON.stringify({ error: "addendum_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: addendum } = await admin
          .from("addendums")
          .select("id, tenant_id, vehicle_ymm, signing_token, dealer_snapshot")
          .eq("id", addendumId)
          .in("tenant_id", authorizedTenantIds)
          .maybeSingle();
        if (!addendum?.signing_token) {
          return new Response(JSON.stringify({ error: "addendum not found for tenant" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const ymm = String(addendum.vehicle_ymm || "your vehicle").slice(0, 120);
        const dealerSnap = (addendum.dealer_snapshot || {}) as Record<string, unknown>;
        const dealerName = String(dealerSnap.name || "Your dealership").slice(0, 120);
        const reviewLink = `${origin}/sign/${encodeURIComponent(String(addendum.signing_token))}`;
        subject = `Review & sign your addendum — ${ymm}`;
        html = `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#0e1f3d">
            <h2 style="font-weight:800">Review &amp; sign your addendum</h2>
            <p>${htmlEscape(dealerName)} has prepared your ${htmlEscape(ymm)} addendum for review.</p>
            <p style="margin:24px 0">
              <a href="${htmlEscape(reviewLink)}" style="background:#0f172a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Review &amp; sign</a>
            </p>
            <p style="font-size:12px;color:#64748b">Or open this link: ${htmlEscape(reviewLink)}</p>
          </div>`;
      } else if (template === "signed_addendum_packet") {
        const vin = String(data.vehicle_vin || "").trim().toUpperCase().slice(0, 20);
        const ymm = String(data.vehicle_ymm || "Vehicle").trim().slice(0, 120);
        const customerName = String(data.customer_name || "Customer").trim().slice(0, 120);
        const dealerName = String(data.dealer_name || "Dealership").trim().slice(0, 120);
        const signingDate = String(data.signing_date || "").trim().slice(0, 60);
        if (!vin) {
          return new Response(JSON.stringify({ error: "vehicle_vin required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const [{ data: vMatch }, { data: aMatch }] = await Promise.all([
          admin.from("vehicle_listings").select("id").in("tenant_id", authorizedTenantIds).eq("vin", vin).limit(1).maybeSingle(),
          admin.from("addendums").select("id").in("tenant_id", authorizedTenantIds).eq("vehicle_vin", vin).limit(1).maybeSingle(),
        ]);
        if (!vMatch && !aMatch) {
          return new Response(JSON.stringify({ error: "vehicle not found for tenant" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        subject = `Signed Addendum: ${ymm} — ${customerName}`;
        html = `
          <div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;color:#0e1f3d">
            <h2 style="font-weight:800;margin:0 0 8px">Signed Addendum Confirmation</h2>
            <p style="margin:0 0 12px">${htmlEscape(dealerName)} recorded a signed vehicle addendum.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
              <tr><td style="padding:6px 0;color:#64748b">Vehicle</td><td style="padding:6px 0;font-weight:600">${htmlEscape(ymm)}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">VIN</td><td style="padding:6px 0;font-family:monospace">${htmlEscape(vin)}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Customer</td><td style="padding:6px 0">${htmlEscape(customerName)}</td></tr>
              ${signingDate ? `<tr><td style="padding:6px 0;color:#64748b">Signed</td><td style="padding:6px 0">${htmlEscape(signingDate)}</td></tr>` : ""}
            </table>
          </div>`;
        if (typeof data.pdf_base64 === "string" && data.pdf_base64.length > 0) {
          if (data.pdf_base64.length > MAX_PDF_BASE64_LEN || !/^[A-Za-z0-9+/=\s]+$/.test(data.pdf_base64)) {
            return new Response(JSON.stringify({ error: "invalid_pdf_attachment" }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          attachments = [{ filename: `Addendum-${vin.replace(/[^A-Z0-9]/g, "")}.pdf`, content: data.pdf_base64 }];
        }
      } else if (template === "get_ready_complete") {
        const vin = String(data.vehicle_vin || "").trim().toUpperCase().slice(0, 20);
        const ymm = String(data.vehicle_ymm || "Vehicle").trim().slice(0, 120);
        const dealerName = String(data.dealer_name || "Dealership").trim().slice(0, 120);
        const stock = String(data.stock_number || "").trim().slice(0, 40);
        if (!vin) {
          return new Response(JSON.stringify({ error: "vehicle_vin required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: vMatch } = await admin
          .from("vehicle_listings")
          .select("id")
          .in("tenant_id", authorizedTenantIds)
          .eq("vin", vin)
          .limit(1)
          .maybeSingle();
        if (!vMatch) {
          return new Response(JSON.stringify({ error: "vehicle not found for tenant" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const safeDeepLink = isAllowedRedirectUrl(data.deep_link_url) ? String(data.deep_link_url) : "";
        const accessories = Array.isArray(data.accessories) ? (data.accessories as Array<Record<string, unknown>>).slice(0, 30) : [];
        const accRows = accessories.map((a) =>
          `<li>${htmlEscape(a.name || "Item")} — ${a.installed ? "Installed" : "Pending"}${a.signed ? " (signed)" : ""}</li>`
        ).join("");
        subject = `Get-Ready Complete: ${ymm} — ${vin.slice(-8)}`;
        html = `
          <div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;color:#0e1f3d">
            <h2 style="font-weight:800;margin:0 0 8px">Get-Ready Complete</h2>
            <p style="margin:0 0 8px">${htmlEscape(dealerName)}: <strong>${htmlEscape(ymm)}</strong></p>
            <p style="font-size:13px;color:#64748b;margin:0 0 12px">VIN ${htmlEscape(vin)}${stock ? ` &middot; Stock ${htmlEscape(stock)}` : ""}</p>
            ${accRows ? `<ul style="font-size:13px;padding-left:18px;margin:0 0 16px">${accRows}</ul>` : ""}
            ${safeDeepLink ? `<p><a href="${htmlEscape(safeDeepLink)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Get-Ready Record</a></p>` : ""}
          </div>`;
      } else {
        return new Response(JSON.stringify({ error: "unsupported_template" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!to || !subject) {
      return new Response(
        JSON.stringify({ error: "to and subject required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const sendgridKey = Deno.env.get("SENDGRID_API_KEY");

    if (resendKey) {
      // Resend API
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: from || "Autocurb <noreply@autocurb.io>",
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
          reply_to: replyTo,
          attachments,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "Resend error", details: data }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true, id: data.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (sendgridKey) {
      // SendGrid API
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sendgridKey}` },
        body: JSON.stringify({
          personalizations: [{ to: Array.isArray(to) ? to.map((e: string) => ({ email: e })) : [{ email: to }] }],
          from: { email: from || "noreply@autocurb.io", name: "Autocurb" },
          subject,
          content: [{ type: "text/html", value: html }],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        return new Response(JSON.stringify({ error: "SendGrid error", details: text }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ error: "No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY in Supabase secrets." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
