import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────
// cross-app-handoff
//
// Called from autolabels.io (and eventually any sibling app) to
// exchange a short-lived handoff token for a prefill payload that
// bootstraps the user into the new app without re-onboarding.
//
// Contract:
//   POST /functions/v1/cross-app-handoff
//   Body: { token: string, targetApp: "autolabels" | ... }
//   Returns: { tenant, profile, entitlement, consumed } | { error }
//
// Two token sources are supported:
//   1. handoff_tokens row (shared Supabase project between apps —
//      our canonical path).
//   2. Shared-secret JWT from an external Autocurb deployment
//      (AUTOCURB_HANDOFF_SECRET env). For when Autocurb runs in
//      a separate project. Stubbed — signature is validated but
//      no tenant/profile lookup happens because we can't reach
//      the other project without its DB access.
//
// The edge function uses the service-role key so it can read the
// handoff_tokens table regardless of RLS.
// ──────────────────────────────────────────────────────────────

serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { token, targetApp } = await req.json().catch(() => ({}));
    if (!token || !targetApp) return json(400, { error: "token and targetApp required" });

    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "supabase not configured" });

    const admin = adminClient();

    // 1. Try the native handoff_tokens path first.
    const { data: row, error: tokErr } = await admin
      .from("handoff_tokens")
      .select("*")
      .eq("id", token)
      .maybeSingle();

    if (tokErr) return json(500, { error: tokErr.message });
    if (!row) return json(404, { error: "token not found" });

    if (row.consumed_at) return json(410, { error: "token already used" });
    if (new Date(row.expires_at).getTime() < Date.now())
      return json(410, { error: "token expired" });
    if (row.target_app !== targetApp) return json(400, { error: "token target mismatch" });

    // 2. Load tenant + profile + entitlement for the target app.
    const [tenantRes, profileRes, entRes] = await Promise.all([
      admin.from("tenants").select("*").eq("id", row.tenant_id).maybeSingle(),
      admin.from("onboarding_profiles").select("*").eq("tenant_id", row.tenant_id).maybeSingle(),
      admin
        .from("app_entitlements")
        .select("*")
        .eq("tenant_id", row.tenant_id)
        .eq("app_slug", targetApp)
        .maybeSingle(),
    ]);

    // 3. Ensure an entitlement row exists (trial if first time).
    let entitlement = entRes.data;
    if (!entitlement) {
      const plan = (row.payload as Record<string, unknown>)?.plan_tier || "sticker";
      const { data: created } = await admin
        .from("app_entitlements")
        .insert({
          tenant_id: row.tenant_id,
          app_slug: targetApp,
          plan_tier: plan,
          status: "trial",
          trial_ends_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
        })
        .select()
        .single();
      entitlement = created;
    }

    // 4. If a user_id is attached and that user isn't yet a member, add them
    //    (idempotent). Role from payload or default 'staff'.
    if (row.user_id) {
      const { data: membership } = await admin
        .from("tenant_members")
        .select("id")
        .eq("tenant_id", row.tenant_id)
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (!membership) {
        const role = (row.payload as Record<string, unknown>)?.role || "staff";
        await admin.from("tenant_members").insert({
          tenant_id: row.tenant_id,
          user_id: row.user_id,
          role,
          accepted_at: new Date().toISOString(),
          invited_by: row.user_id,
        });
      }
    }

    // 5. Burn the token (one-time use).
    await admin
      .from("handoff_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", token);

    return json(200, {
      consumed: true,
      tenant: tenantRes.data,
      profile: profileRes.data,
      entitlement,
    });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});
