-- ──────────────────────────────────────────────────────────────────────
-- Per-VIN ingest outcome ledger.
--
-- What already existed, and why it is not enough:
--
--   * vehicle_exceptions (exception_type 'artifact_autogen_failed') records
--     FAILURES only — recordArtifactFailure() in
--     supabase/functions/_shared/intake-autoprovision.ts merges each failed
--     artifact into source_values.artifacts. A step that succeeded and a step
--     that never ran both leave no row, so "no exception" reads as success.
--   * factory_sticker_records is a genuine per-(tenant, vehicle) state
--     machine, so the sticker's own outcome IS recorded — but only while a
--     row exists.
--   * oem_brochure_links / oem_owners_manual_links are GLOBAL make/model/year
--     caches with no tenant_id and no vin. Nothing anywhere records whether a
--     brochure or owner's-manual harvest ran for a given VIN, missed, or was
--     never attempted.
--
-- This table closes that: one row per (tenant, vin, step) carrying the step's
-- own account of what happened, always with a reason string.
--
-- The deliberate absence: 'not_run' is NOT a storable status. A step that
-- never ran has no row. That keeps the write path honest — nothing can
-- record "did not run" as if it had run — and makes absence mean exactly one
-- thing to the reader.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vehicle_ingest_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id    uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  vin           text NOT NULL,
  step          text NOT NULL,
  status        text NOT NULL
                  CHECK (status IN ('running','succeeded','parked','failed','skipped')),
  reason        text NOT NULL CHECK (btrim(reason) <> ''),
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 1,
  first_run_at  timestamptz NOT NULL DEFAULT now(),
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  recorded_by   uuid REFERENCES auth.users(id),
  CONSTRAINT vehicle_ingest_ledger_step_key UNIQUE (tenant_id, vin, step)
);

COMMENT ON TABLE public.vehicle_ingest_ledger IS
  'Per-VIN outcome of each ingest pipeline step (window sticker, OEM brochure, owner''s manual). One row per (tenant, vin, step); every row carries a non-empty reason. No row means the step never ran — "not_run" is deliberately not a storable status.';
COMMENT ON COLUMN public.vehicle_ingest_ledger.status IS
  'running | succeeded | parked (ran, waiting on data or a human) | failed | skipped (deliberately not applicable).';
COMMENT ON COLUMN public.vehicle_ingest_ledger.reason IS
  'Why the step landed in this status, in words an operator can act on. Never empty — the CHECK enforces it.';

CREATE INDEX IF NOT EXISTS idx_vehicle_ingest_ledger_tenant_recent
  ON public.vehicle_ingest_ledger (tenant_id, last_run_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_ingest_ledger_tenant_step_status
  ON public.vehicle_ingest_ledger (tenant_id, step, status);

ALTER TABLE public.vehicle_ingest_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicle_ingest_ledger_read" ON public.vehicle_ingest_ledger;
CREATE POLICY "vehicle_ingest_ledger_read"
  ON public.vehicle_ingest_ledger FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- No client INSERT/UPDATE/DELETE policies on purpose: every write goes
-- through record_ingest_step below, which enforces the tenant check and the
-- non-empty reason, so no caller can quietly file a blank outcome.

GRANT SELECT ON public.vehicle_ingest_ledger TO authenticated;
GRANT ALL ON public.vehicle_ingest_ledger TO service_role;

-- ── The one write path ────────────────────────────────────────────────
-- Upserts on (tenant, vin, step) and bumps attempt_count, so a re-run
-- overwrites the verdict without losing how many times the step was tried.
-- Service role (auth.uid() IS NULL) writes on behalf of the pipeline; a user
-- JWT may only write its own tenant's rows.
CREATE OR REPLACE FUNCTION public.record_ingest_step(
  p_tenant_id  uuid,
  p_vin        text,
  p_step       text,
  p_status     text,
  p_reason     text,
  p_vehicle_id uuid  DEFAULT NULL,
  p_detail     jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin  text := upper(btrim(coalesce(p_vin, '')));
  v_step text := btrim(coalesce(p_step, ''));
  v_uid  uuid := (SELECT auth.uid());
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' OR v_step = '' THEN
    RAISE EXCEPTION 'record_ingest_step: tenant_id, vin and step are required';
  END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'record_ingest_step: every recorded outcome must carry a reason';
  END IF;
  IF v_uid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'record_ingest_step: not a member of this tenant';
  END IF;

  INSERT INTO public.vehicle_ingest_ledger AS l
    (tenant_id, vehicle_id, vin, step, status, reason, detail, recorded_by)
  VALUES
    (p_tenant_id, p_vehicle_id, v_vin, v_step, p_status, btrim(p_reason),
     coalesce(p_detail, '{}'::jsonb), v_uid)
  ON CONFLICT (tenant_id, vin, step) DO UPDATE SET
    status        = EXCLUDED.status,
    reason        = EXCLUDED.reason,
    detail        = EXCLUDED.detail,
    vehicle_id    = coalesce(EXCLUDED.vehicle_id, l.vehicle_id),
    attempt_count = l.attempt_count + 1,
    last_run_at   = now(),
    recorded_by   = EXCLUDED.recorded_by;
END; $$;

REVOKE ALL ON FUNCTION public.record_ingest_step(uuid, text, text, text, text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.record_ingest_step(uuid, text, text, text, text, uuid, jsonb)
  TO authenticated, service_role;
