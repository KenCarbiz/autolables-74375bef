import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// autocurb-pull
//
// Cold-start lookup: when a user signs in to autolabels.io for the
// first time and has no local tenant_members row, this function asks
// Autocurb whether the same email is registered there. If yes, it:
//   1. Bootstraps the tenant locally (source='autocurb', linked
//      via autocurb_tenant_id).
//   2. Mirrors the dealer profile into onboarding_profiles.
//   3. Creates an autolabels app_entitlement using the bundled
//      tier when Autocurb says they get it free, or 'essential'
//      trial otherwise.
//   4. Marks the caller as the tenant owner.
//
// Two operating modes:
//
//   A. SHARED-PROJECT MODE (default per CLAUDE.md):
//      Autocurb writes into the same Supabase project we read.
//      In this mode the user's tenant_members row already exists
//      from when they signed up on Autocurb, and EntitlementGate
//      never invokes us at all. We're a no-op safety net.
//
//   B. EXTERNAL-PROJECT MODE:
//      Autocurb runs in its own Supabase deployment. We must call
//      its profile-by-email API with a service token. Activate by
//      setting AUTOCURB_API_BASE + AUTOCURB_API_TOKEN env. If those
//      are unset we return { matched: false } so EntitlementGate
//      falls through to the local onboarding wizard.
//
// Contract:
//   POST /functions/v1/autocurb-pull
//   Headers: Authorization: Bearer <user JWT>
//   Body: { app_slug: AppSlug }
//   Returns: { matched: boolean, tenant_id?: string, source?: string }
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface AutocurbDealerProfile {
  autocurb_tenant_id: string;
  name: string;
  domain?: string;
  primary_email?: string;
  display_name?: string;
  tagline?: string;
  primary_color?: string;
  secondary_color?: string;
  logo_url?: string;
  website?: string;
  phone?: string;
  stores?: Array<Record<string, unknown>>;
  billing?: Record<string, unknown>;
  lead_preferences?: Record<string, unknown>;
  bundles_autolabels?: boolean;
  bundle_tier?: string;
}

const fetchAutocurbProfileByEmail = async (
  email: string
): Promise<AutocurbDealerProfile | null> => {
  const base = Deno.env.get("AUTOCURB_API_BASE");
  const apiToken = Deno.env.get("AUTOCURB_API_TOKEN");
  if (!base || !apiToken) return null;

  const url = `${base.replace(/\/+$/, "")}/api/v1/dealers/by-email?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as AutocurbDealerProfile | null;
  return data;
};

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") +
  "-" +
  Math.random().toString(36).slice(2, 6);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });

    const { app_slug = "autolabels" } = await req.json().catch(() => ({}));

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userRes } = await admin.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json(401, { error: "invalid token" });
    if (!user.email_confirmed_at) {
      return json(403, { matched: false, error: "email_not_confirmed" });
    }

    // 1. If the user already has a tenant_members row, this function
    //    is a no-op. Return matched=true so the client refreshes.
    const { data: existing } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (existing?.tenant_id) {
      return json(200, { matched: true, tenant_id: existing.tenant_id, source: "shared-project" });
    }

    // 2. Look the user up in Autocurb by email.
    const email = user.email || "";
    if (!email) return json(200, { matched: false });
    const profile = await fetchAutocurbProfileByEmail(email);
    if (!profile) return json(200, { matched: false });

    // 3. Reuse the local tenant if we've already linked this autocurb_tenant_id.
    const { data: linked } = await admin
      .from("tenants")
      .select("id")
      .eq("autocurb_tenant_id", profile.autocurb_tenant_id)
      .maybeSingle();

    let tenantId = linked?.id as string | undefined;
    const createdTenant = !tenantId;
    if (!tenantId) {
      const primaryEmail = (profile.primary_email || "").trim().toLowerCase();
      if (primaryEmail && primaryEmail !== email.trim().toLowerCase()) {
        return json(403, { matched: false, error: "email_mismatch" });
      }
      const { data: created, error: createErr } = await admin
        .from("tenants")
        .insert({
          name: profile.name,
          slug: slugify(profile.name),
          domain: profile.domain || null,
          primary_email: profile.primary_email || email,
          source: "autocurb",
          autocurb_tenant_id: profile.autocurb_tenant_id,
        })
        .select("id")
        .single();
      if (createErr || !created) {
        return json(500, { error: createErr?.message || "tenant create failed" });
      }
      tenantId = created.id;

      await admin.from("onboarding_profiles").insert({
        tenant_id: tenantId,
        display_name: profile.display_name || profile.name,
        tagline: profile.tagline || null,
        primary_color: profile.primary_color || null,
        secondary_color: profile.secondary_color || null,
        logo_url: profile.logo_url || null,
        website: profile.website || null,
        phone: profile.phone || null,
        stores: profile.stores || [],
        billing: profile.billing || {},
        lead_preferences: profile.lead_preferences || {},
        source: "autocurb",
        last_synced_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
    }

    // 4. Only assign owner when creating the tenant for the first time; never
    //    elevate a new account to owner on an already-linked tenant unless an
    //    existing pending invitation matches their confirmed email.
    const { data: m } = await admin
      .from("tenant_members")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!m) {
      if (createdTenant) {
        await admin.from("tenant_members").insert({
          tenant_id: tenantId,
          user_id: user.id,
          invited_email: email,
          role: "owner",
          accepted_at: new Date().toISOString(),
          invited_by: user.id,
        });
      } else {
        const { data: invite } = await admin
          .from("tenant_members")
          .select("id")
          .eq("tenant_id", tenantId)
          .ilike("invited_email", email)
          .is("user_id", null)
          .maybeSingle();
        if (!invite) {
          return json(403, { matched: false, error: "tenant_already_linked" });
        }
        await admin
          .from("tenant_members")
          .update({ user_id: user.id, accepted_at: new Date().toISOString() })
          .eq("id", invite.id);
      }
    }

    // 5. Provision an entitlement for the requested app. If Autocurb
    //    says this dealer's plan bundles AutoLabels, mark it as
    //    'active' (no trial) at the bundled tier.
    const { data: existingEnt } = await admin
      .from("app_entitlements")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("app_slug", app_slug)
      .maybeSingle();
    if (!existingEnt) {
      const bundled = Boolean(profile.bundles_autolabels);
      await admin.from("app_entitlements").insert({
        tenant_id: tenantId,
        app_slug,
        plan_tier: bundled ? (profile.bundle_tier || "essential") : "essential",
        status: bundled ? "active" : "trial",
        trial_ends_at: bundled
          ? null
          : new Date(Date.now() + 14 * 86400_000).toISOString(),
        metadata: { source: "autocurb-pull", bundled },
      });
    }

    await admin.from("audit_log").insert({
      action: "autocurb_pull_completed",
      entity_type: "tenant",
      entity_id: tenantId,
      user_id: user.id,
      user_email: email,
      details: { autocurb_tenant_id: profile.autocurb_tenant_id, app_slug },
    });

    return json(200, { matched: true, tenant_id: tenantId, source: "autocurb" });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
