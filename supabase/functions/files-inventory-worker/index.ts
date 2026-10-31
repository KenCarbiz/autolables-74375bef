import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { matchesLegacyServiceRole, readCredentials } from "../_shared/functionAuth.ts";
import { PipelineError, processImportJob, reconcile, type Db } from "../_shared/filescom/pipeline.ts";

// Files.com inventory worker. Invoked by pg_cron (schedule_files_inventory_worker)
// with the service-role credential, never by a browser. Each run optionally
// reconciles the folder against processed versions, then drains a few due
// jobs from the durable queue. Pause and emergency stop are enforced by the
// claim functions and again by the per-store apply.

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const TIME_BUDGET_MS = 100_000;
const MAX_JOBS = 3;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!(await matchesLegacyServiceRole(readCredentials(req), serviceKey))) return json(401, { error: "unauthorized" });
  const key = Deno.env.get("FILESCOM_API_KEY");
  if (!key) return json(409, { error: "FILESCOM_API_KEY_missing" });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is a plain drain */ }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } }) as unknown as Db;
  const deps = { db, key, fetchFn: fetch };
  const started = Date.now();

  const { data: controls, error: cerr } = await db.from("inventory_feed_controls").select("ingestion_paused,emergency_stop,reconcile_enabled").eq("id", 1).maybeSingle();
  if (cerr || !controls) return json(503, { error: "controls_unavailable" });
  const c = controls as { ingestion_paused: boolean; emergency_stop: boolean; reconcile_enabled: boolean };
  if (c.emergency_stop) return json(200, { ok: true, skipped: "emergency_stop" });
  if (c.ingestion_paused) return json(200, { ok: true, skipped: "ingestion_paused" });

  let reconciled: unknown = null;
  if (body.reconcile === true && c.reconcile_enabled) {
    try { reconciled = await reconcile(deps); }
    catch (e) { reconciled = { error: e instanceof PipelineError ? e.code : "reconcile_failed" }; }
  }

  const processed: Array<{ jobId: string; status: string; error?: string }> = [];
  while (processed.length < MAX_JOBS && Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await db.rpc("inventory_feed_claim_jobs", { p_limit: 1, p_lock_seconds: 600 });
    if (error) { console.error("files-inventory-worker claim failed"); break; }
    const job = (Array.isArray(data) ? data[0] : null) as { id: string; path: string; lock_token: string; attempts: number; max_attempts: number } | null;
    if (!job) break;
    try {
      const out = await processImportJob(deps, job);
      processed.push({ jobId: job.id, status: out.status, error: out.error });
    } catch (e) {
      const code = e instanceof PipelineError ? e.code : "worker_error";
      await db.rpc("inventory_feed_finish_job", { p_job_id: job.id, p_lock_token: job.lock_token, p_status: "failed", p_error: code, p_retryable: true, p_result: null, p_run_id: null, p_version_key: null });
      processed.push({ jobId: job.id, status: "failed", error: code });
    }
  }
  return json(200, { ok: true, reconciled, processed });
});
