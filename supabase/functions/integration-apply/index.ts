// integration-apply
//
// Inbox worker. Claims received/held rows, checks the tenant's direction flag,
// resolves the active vehicle instance and applies the fact. Delivery (inbox)
// and application (here) stay separate. Dormant unless
// ROOFTOP_INTEGRATIONS_ENABLED === "true"; flags default off so rows stay held.
//
// Several workers may overlap: effects are idempotent upserts keyed on the
// source record, the version watermark only moves forward, and the final status
// write is guarded on the status the row was claimed with.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { json, preflight } from "../_shared/http.ts";
import { MAX_ATTEMPTS } from "../_shared/integrations/backoff.ts";
import { inboundDirection, type Direction, type Producer } from "../_shared/integrations/envelope.ts";
import { decideApply, type ApplyEffect, type InboxRowForApply } from "../_shared/integrations/applyDecision.ts";
import { isServiceOrCron } from "../_shared/supabase.ts";

type Db = SupabaseClient;

interface ClaimedRow extends InboxRowForApply {
  status: "received" | "held";
  attempts: number;
  event_id: string;
}

const COLUMNS =
  "id,tenant_id,connection_id,producer,event_type,event_id,source_record_id,source_version,vin,visibility,envelope,status,attempts";

async function writeEffect(db: Db, effect: ApplyEffect): Promise<void> {
  const table = effect.kind === "inspection_evidence_upsert" ? "inspection_evidence" : "repair_items";
  const { error } = await db.from(table).upsert(effect.row, { onConflict: "tenant_id,source_app,source_record_id" });
  if (error) throw new Error(`effect_write_failed`);
}

async function audit(db: Db, row: ClaimedRow, status: string, outcome: string): Promise<void> {
  await db.from("audit_log").insert({
    action: `integration_event_${status}`,
    entity_type: "integration_inbox",
    entity_id: row.id,
    details: {
      tenant_id: row.tenant_id,
      connection_id: row.connection_id,
      event_id: row.event_id,
      event_type: row.event_type,
      source_record_id: row.source_record_id,
      source_version: row.source_version,
      outcome_code: outcome,
    },
  });
}

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (Deno.env.get("ROOFTOP_INTEGRATIONS_ENABLED") !== "true") return json(503, { ok: false, error: "integrations_disabled" });
  if (!isServiceOrCron(req)) return json(401, { ok: false, error: "not authorized" });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "unavailable" });

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);

  const { data, error } = await db
    .from("integration_inbox")
    .select(COLUMNS)
    .in("status", ["received", "held"])
    .order("received_at", { ascending: true })
    .limit(limit);
  if (error) return json(503, { ok: false, error: "unavailable" });

  const rows = (data ?? []) as unknown as ClaimedRow[];
  const flagCache = new Map<string, boolean>();
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  const directionEnabled = async (tenantId: string, direction: Direction | null): Promise<boolean> => {
    if (!direction) return false;
    const key = `${tenantId}:${direction}`;
    if (!flagCache.has(key)) {
      const { data: flag } = await db
        .from("integration_direction_flags").select("enabled")
        .eq("tenant_id", tenantId).eq("direction", direction).maybeSingle();
      flagCache.set(key, (flag as { enabled?: boolean } | null)?.enabled === true);
    }
    return flagCache.get(key) === true;
  };

  for (const row of rows) {
    try {
      if (!(await directionEnabled(row.tenant_id, inboundDirection(row.producer as Producer)))) {
        if (row.status === "received") {
          await db.from("integration_inbox").update({ status: "held", outcome_code: "direction_disabled" })
            .eq("id", row.id).eq("status", "received");
        }
        bump("held");
        continue;
      }

      const [instanceRes, versionRes] = await Promise.all([
        db.from("vehicle_instances").select("id,tenant_id")
          .eq("tenant_id", row.tenant_id).eq("vin", row.vin).eq("status", "active").maybeSingle(),
        db.from("integration_source_versions").select("latest_version")
          .eq("connection_id", row.connection_id).eq("source_record_id", row.source_record_id).maybeSingle(),
      ]);
      if (instanceRes.error || versionRes.error) throw new Error("lookup_failed");

      const decision = decideApply({
        row,
        latestVersion: (versionRes.data as { latest_version: number } | null)?.latest_version ?? null,
        instance: (instanceRes.data as { id: string; tenant_id: string } | null) ?? null,
      });

      if (decision.effect) await writeEffect(db, decision.effect);
      if (decision.recordVersion) {
        const { error: vErr } = await db.rpc("integration_record_source_version", {
          p_connection_id: row.connection_id,
          p_source_record_id: row.source_record_id,
          p_version: row.source_version,
        });
        if (vErr) throw new Error("version_write_failed");
      }

      const { error: sErr } = await db.from("integration_inbox").update({
        status: decision.status,
        outcome_code: decision.outcomeCode,
        attempts: row.attempts + 1,
        applied_at: decision.status === "applied" ? new Date().toISOString() : null,
      }).eq("id", row.id).eq("status", row.status);
      if (sErr) throw new Error("status_write_failed");

      await audit(db, row, decision.status, decision.outcomeCode).catch(() => {});
      bump(decision.status);
    } catch (_err) {
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await db.from("integration_inbox").update({
        attempts,
        outcome_code: "apply_error",
        ...(dead ? { status: "dead" } : {}),
      }).eq("id", row.id).eq("status", row.status).then(() => {}, () => {});
      if (dead) await audit(db, row, "dead", "apply_error").catch(() => {});
      bump(dead ? "dead" : "retry");
    }
  }

  return json(200, { ok: true, claimed: rows.length, outcomes: counts });
});
