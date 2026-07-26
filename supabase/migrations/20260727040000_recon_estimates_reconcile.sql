-- ──────────────────────────────────────────────────────────────────────
-- Reconcile the auto-generated recon-estimate backlog.
--
-- ingest-orchestrate (supabase/functions/ingest-orchestrate/index.ts,
-- orchestrateOne → seed_recon_estimate_for_ingest, defined in
-- 20260629081000_ingest_orchestration.sql) seeds one 'ingest'-origin
-- recon estimate for EVERY ingested vehicle whose dealer has required
-- canned services configured — regardless of whether that individual car
-- needs any work. In the default 'manual' dispatch mode those estimates
-- land as status = 'submitted' and wait for a UCM decision that, for the
-- auto-seeded backlog, never came: per-line repair authorization now runs
-- through the service_requests approval loop (/service/approvals Work
-- Authorization, decide_service_request + service_request_lines,
-- 20260727010000_service_request_lines.sql), so the stale seeds only
-- inflate the "Recon Approvals" nav badge without representing a pending
-- decision. The seeding behavior itself is intentionally NOT changed here;
-- only the historic backlog is closed out.
--
-- The status CHECK from 20260629060000_recon_estimates.sql already
-- permits the terminal value 'voided' ('submitted','partially_approved',
-- 'approved','declined','completed','voided'), so no constraint change is
-- needed — a plain UPDATE is the least invasive path. Scope: auto-
-- generated (ingest-origin / system-submitted) estimates still
-- 'submitted' and older than 48 hours; newer seeds and every human-
-- submitted estimate are untouched.

DO $$
DECLARE n int;
BEGIN
  UPDATE public.recon_estimates
     SET status = 'voided',
         updated_at = now()
   WHERE status = 'submitted'
     AND (origin = 'ingest' OR submitted_role = 'system')
     AND created_at < now() - interval '48 hours';
  GET DIAGNOSTICS n = ROW_COUNT;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, details)
    VALUES ('recon_estimates_reconciled', 'system', 'ingest_backlog',
            jsonb_build_object(
              'voided', n,
              'reason', 'auto-seeded at ingest with no decision workflow; superseded by the service_requests approval loop'));
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;
