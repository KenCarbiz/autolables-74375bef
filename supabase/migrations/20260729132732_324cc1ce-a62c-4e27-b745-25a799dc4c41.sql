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
  'Per-VIN outcome of each ingest pipeline step (window sticker, OEM brochure, owner''s manual). One row per (tenant, vin, step); every row carries a non-empty reason. No row means the step never ran.';

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

GRANT SELECT ON public.vehicle_ingest_ledger TO authenticated;
GRANT ALL ON public.vehicle_ingest_ledger TO service_role;

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

CREATE TABLE IF NOT EXISTS public.oem_packet_backfill_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('brochure', 'owners_manual')),
  make_key        TEXT NOT NULL,
  model_key       TEXT NOT NULL,
  year_key        INTEGER NOT NULL DEFAULT 0,
  make            TEXT NOT NULL,
  model           TEXT NOT NULL,
  year            INTEGER,
  outcome         TEXT NOT NULL CHECK (outcome IN ('found', 'not_found', 'unsupported', 'error')),
  detail          TEXT,
  attempts        INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_oem_packet_backfill_attempts UNIQUE (kind, make_key, model_key, year_key)
);

COMMENT ON TABLE public.oem_packet_backfill_attempts IS
  'What the OEM packet backfill has already asked for and what came back. Stops a triple with no brochure/manual being re-searched, and re-billed, every night.';

CREATE INDEX IF NOT EXISTS idx_oem_packet_backfill_attempts_open
  ON public.oem_packet_backfill_attempts (last_attempt_at)
  WHERE outcome IN ('not_found', 'error');

ALTER TABLE public.oem_packet_backfill_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read packet backfill attempts" ON public.oem_packet_backfill_attempts;
CREATE POLICY "Authenticated read packet backfill attempts"
  ON public.oem_packet_backfill_attempts FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

GRANT SELECT ON public.oem_packet_backfill_attempts TO authenticated;
GRANT ALL ON public.oem_packet_backfill_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.record_packet_backfill_attempt(
  _kind    TEXT,
  _make    TEXT,
  _model   TEXT,
  _year    INTEGER,
  _outcome TEXT,
  _detail  TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempts INTEGER;
BEGIN
  INSERT INTO public.oem_packet_backfill_attempts
    (kind, make_key, model_key, year_key, make, model, year, outcome, detail)
  VALUES (
    _kind,
    lower(btrim(_make)), lower(btrim(_model)), COALESCE(_year, 0),
    btrim(_make), btrim(_model), _year,
    _outcome, left(COALESCE(_detail, ''), 500)
  )
  ON CONFLICT ON CONSTRAINT uq_oem_packet_backfill_attempts DO UPDATE
    SET outcome         = EXCLUDED.outcome,
        detail          = EXCLUDED.detail,
        attempts        = public.oem_packet_backfill_attempts.attempts + 1,
        last_attempt_at = now()
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts;
END $$;

REVOKE ALL ON FUNCTION public.record_packet_backfill_attempt(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_packet_backfill_attempt(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.schedule_packet_backfill(
  _cron_expr TEXT DEFAULT '40 9 * * *',
  _supabase_url TEXT DEFAULT NULL,
  _service_key TEXT DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url TEXT; key TEXT; secret TEXT; hdrs JSONB; job_id BIGINT;
BEGIN
  IF _supabase_url IS NULL THEN
    SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  ELSE url := _supabase_url; END IF;
  IF _service_key IS NULL THEN
    SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  ELSE key := _service_key; END IF;
  IF url IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'supabase_url and service_role_key required (via args or Vault entries)';
  END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'marketcheck_cron_secret' LIMIT 1;

  hdrs := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key);
  IF secret IS NOT NULL AND secret <> '' THEN
    hdrs := hdrs || jsonb_build_object('x-cron-secret', secret);
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'packet-backfill';
  SELECT cron.schedule('packet-backfill', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"limit": 500, "sticker_limit": 20, "link_limit": 8}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/packet-backfill',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_packet_backfill(TEXT, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  PERFORM public.schedule_packet_backfill();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'packet-backfill not scheduled yet (%); call schedule_packet_backfill(cron, url, key) once Vault is set', SQLERRM;
END $$;