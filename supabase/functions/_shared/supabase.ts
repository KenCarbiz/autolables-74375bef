// ──────────────────────────────────────────────────────────────────────
// Shared Supabase wiring for edge functions: the env handles, a service-role
// client factory, and the cron/service auth gate. One import site so the
// supabase-js version and the privileged-call contract live in one place.
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Service-role client (RLS-bypassing). Sessions disabled — these run headless.
export const adminClient = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Gate for cron-driven sweeps: a service-role bearer OR the shared cron
// secret. These functions fan out emails, so they must not be publicly
// triggerable. The SERVICE_KEY presence check guards the degenerate case
// where both the env and an inbound empty bearer are "".
export const isServiceOrCron = (req: Request): boolean => {
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!!SERVICE_KEY && auth === SERVICE_KEY) return true;
  const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
  return !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;
};
