// integration-health
//
// Read-only aggregates for the Super Admin Integration health view. Platform
// admin only (user_roles.role = 'admin', the same gate as autocurb-dealer-lookup).
// No provider calls and no writes. Empty tables report "not_configured", never
// "healthy". Dormant unless ROOFTOP_INTEGRATIONS_ENABLED === "true".

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { DIRECTIONS } from "../_shared/integrations/envelope.ts";
import { handleHealth, type HealthStore } from "../_shared/integrations/handlers/health.ts";

type Db = SupabaseClient;

const INBOX_STATUSES = ["received", "held", "applied", "superseded", "stale", "conflict", "rejected", "unmatched", "dead"] as const;
const OUTBOX_STATUSES = ["pending", "delivering", "delivered", "dead"] as const;

async function count(db: Db, table: string, filters: Array<[string, string, string]> = []): Promise<number> {
  let q = db.from(table).select("id", { count: "exact", head: true });
  for (const [op, col, val] of filters) {
    q = op === "eq" ? q.eq(col, val) : q.gte(col, val);
  }
  const { count: n, error } = await q;
  if (error) throw new Error("count_failed");
  return n ?? 0;
}

async function countsByStatus(db: Db, table: string, statuses: readonly string[], sinceIso: string | null) {
  const entries = await Promise.all(statuses.map(async (s) => {
    const base: Array<[string, string, string]> = [["eq", "status", s]];
    const [total, last24h] = await Promise.all([
      count(db, table, base),
      sinceIso ? count(db, table, [...base, ["gte", table === "integration_inbox" ? "received_at" : "created_at", sinceIso]]) : Promise.resolve(0),
    ]);
    return [s, { total, last24h }] as const;
  }));
  return Object.fromEntries(entries);
}

function supabaseStore(db: Db): HealthStore {
  return {
    async authenticate(jwt) {
      const { data } = await db.auth.getUser(jwt);
      return data?.user ? { userId: data.user.id } : null;
    },
    async isPlatformAdmin(userId) {
      const { data } = await db.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
      return !!data;
    },
    async snapshot(now) {
      const sinceIso = new Date(now - 24 * 3600 * 1000).toISOString();

      const [connRes, flagRes, inbox, outbox, oldestReceived, oldestPending] = await Promise.all([
        db.from("integration_connections")
          .select("id,tenant_id,app,display_name,status,scopes,last_success_at,last_error_at,last_error_code,created_at")
          .order("created_at", { ascending: true }).limit(500),
        db.from("integration_direction_flags").select("tenant_id,direction,enabled,updated_at").limit(2000),
        countsByStatus(db, "integration_inbox", INBOX_STATUSES, sinceIso),
        countsByStatus(db, "integration_outbox", OUTBOX_STATUSES, sinceIso),
        db.from("integration_inbox").select("received_at").eq("status", "received")
          .order("received_at", { ascending: true }).limit(1).maybeSingle(),
        db.from("integration_outbox").select("created_at").eq("status", "pending")
          .order("created_at", { ascending: true }).limit(1).maybeSingle(),
      ]);
      if (connRes.error || flagRes.error) throw new Error("read_failed");

      const connections = (connRes.data ?? []) as unknown as Array<{
        id: string; tenant_id: string; app: "autofilm" | "autocurb"; display_name: string; status: string;
        scopes: string[]; last_success_at: string | null; last_error_at: string | null; last_error_code: string | null;
      }>;
      const flags = (flagRes.data ?? []) as unknown as Array<{ tenant_id: string; direction: string; enabled: boolean }>;

      const tenantIds = [...new Set(connections.map((c) => c.tenant_id))];
      const names: Record<string, string> = {};
      if (tenantIds.length) {
        const { data: tenants } = await db.from("tenants").select("id,name").in("id", tenantIds);
        for (const t of (tenants ?? []) as unknown as Array<{ id: string; name: string }>) names[t.id] = t.name;
      }

      const oldestIso = (oldestReceived.data as { received_at?: string } | null)?.received_at ?? null;
      const oldestPendingIso = (oldestPending.data as { created_at?: string } | null)?.created_at ?? null;
      const ageSeconds = (iso: string | null) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null);

      const byApp = (app: "autofilm" | "autocurb") => {
        const list = connections.filter((c) => c.app === app);
        return {
          state: list.length === 0 ? "not_configured" : "configured",
          connections: list.map((c) => ({
            id: c.id,
            tenant_id: c.tenant_id,
            tenant_name: names[c.tenant_id] ?? null,
            display_name: c.display_name,
            status: c.status,
            scopes: c.scopes,
            last_success_at: c.last_success_at,
            last_error_at: c.last_error_at,
            last_error_code: c.last_error_code,
          })),
        };
      };

      const flagSummary = DIRECTIONS.map((direction) => {
        const rows = flags.filter((f) => f.direction === direction);
        return { direction, enabled_tenants: rows.filter((f) => f.enabled).length, configured_tenants: rows.length };
      });

      return {
        generated_at: new Date(now).toISOString(),
        state: connections.length === 0 ? "not_configured" : "configured",
        apps: { autofilm: byApp("autofilm"), autocurb: byApp("autocurb") },
        inbox: {
          by_status: inbox,
          oldest_received_age_seconds: ageSeconds(oldestIso),
          unmatched: inbox.unmatched?.total ?? 0,
          dead: inbox.dead?.total ?? 0,
        },
        outbox: {
          by_status: outbox,
          oldest_pending_age_seconds: ageSeconds(oldestPendingIso),
          pending: outbox.pending?.total ?? 0,
          dead: outbox.dead?.total ?? 0,
        },
        flags: flagSummary,
      };
    },
  };
}

Deno.serve((req: Request) => handleHealth(req, {
  enabled: () => Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") === "true",
  store: () => {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return null;
    return supabaseStore(createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));
  },
}));
