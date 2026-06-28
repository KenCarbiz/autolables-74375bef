import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────
// claim-platform
//
// Self-service first-run bootstrap for a fresh AutoLabels deployment
// where the operator does not have SQL-editor access to Supabase.
//
// Flow:
//   1. Caller is signed in (JWT present).
//   2. Function uses the service-role key to check whether ANY
//      public.user_roles row with role='admin' exists.
//   3. If zero admins exist: this is an un-claimed deployment.
//      Grant the caller the 'admin' role, create the "AutoLabels.io"
//      house tenant if missing, attach the caller as tenant owner,
//      activate the autolabels entitlement. Audit-log everything.
//   4. If at least one admin already exists: refuse with
//      "already_claimed" so a second person can't self-elevate.
//
// Idempotent for the caller: if the caller is already the admin,
// re-running returns { already_admin: true } and confirms the
// house-tenant membership.
// ──────────────────────────────────────────────────────────────

serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "supabase not configured" });

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });

    const admin = adminClient();
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json(401, { error: "invalid token" });
    const user = userRes.user;
    const email = user.email || "";

    // Count existing admins.
    const { count: adminCount, error: countErr } = await admin
      .from("user_roles")
      .select("*", { head: true, count: "exact" })
      .eq("role", "admin");
    if (countErr) {
      return json(500, { error: "user_roles table missing or unreadable — confirm migrations were applied", detail: countErr.message });
    }

    // Is the caller already the admin?
    const { data: existingRole } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if ((adminCount ?? 0) > 0 && !existingRole) {
      return json(403, {
        error: "already_claimed",
        message: "An admin already exists on this platform. Ask them to add your email as a tenant member.",
      });
    }

    // Grant admin if not already granted.
    if (!existingRole) {
      const { error: roleErr } = await admin
        .from("user_roles")
        .insert({ user_id: user.id, role: "admin" });
      if (roleErr && !roleErr.message.toLowerCase().includes("duplicate")) {
        return json(500, { error: "role grant failed", detail: roleErr.message });
      }
    }

    // Find or create the house tenant.
    let tenantId: string | null = null;
    {
      const { data: house } = await admin
        .from("tenants")
        .select("id")
        .eq("slug", "autolabels")
        .maybeSingle();
      if (house?.id) {
        tenantId = house.id;
      } else {
        const { data: created, error: tenantErr } = await admin
          .from("tenants")
          .insert({
            name: "AutoLabels.io",
            slug: "autolabels",
            domain: "autolabels.io",
            primary_email: email,
            source: "manual",
            is_active: true,
          })
          .select("id")
          .single();
        if (tenantErr) return json(500, { error: "tenant create failed", detail: tenantErr.message });
        tenantId = created.id;
      }
    }

    // Ensure onboarding profile exists + marked complete.
    await admin
      .from("onboarding_profiles")
      .upsert({
        tenant_id: tenantId,
        display_name: "AutoLabels.io",
        tagline: "Clear. Compliant. Consistent.",
        source: "manual",
        completed_at: new Date().toISOString(),
      }, { onConflict: "tenant_id" });

    // Ensure entitlement exists + active/unlimited.
    await admin
      .from("app_entitlements")
      .upsert({
        tenant_id: tenantId,
        app_slug: "autolabels",
        plan_tier: "unlimited",
        status: "active",
        expires_at: null,
        metadata: { source: "claim_platform", claimed_by: user.id },
      }, { onConflict: "tenant_id,app_slug" });

    // Ensure owner membership.
    const { data: existingMember } = await admin
      .from("tenant_members")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existingMember) {
      await admin.from("tenant_members").insert({
        tenant_id: tenantId,
        user_id: user.id,
        invited_email: email,
        role: "owner",
        accepted_at: new Date().toISOString(),
        invited_by: user.id,
      });
    }

    await admin.from("audit_log").insert({
      action: "platform_claimed",
      entity_type: "platform",
      entity_id: tenantId,
      user_id: user.id,
      user_email: email,
      details: {
        already_admin: !!existingRole,
        admin_count_before: adminCount ?? 0,
      },
    });

    return json(200, {
      ok: true,
      already_admin: !!existingRole,
      tenant_id: tenantId,
      message: existingRole
        ? "You were already the admin. Membership + entitlement refreshed."
        : "Platform claimed. You are now the admin of the AutoLabels.io house tenant.",
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
