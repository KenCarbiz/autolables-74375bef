-- ──────────────────────────────────────────────────────────────────────
-- MarketCheck nightly inventory sync — per-tenant, super-admin governed.
--
-- Each tenant can be GRANTED the capability by a super admin (allowed), then
-- turned on/off (enabled), pointed at the dealer's website domain (source),
-- and given a schedule (frequency + day_of_week + run_hour UTC) and a cap
-- (max_vehicles). The marketcheck-sync edge function runs hourly and syncs
-- only the tenants that are allowed, enabled, and due this hour.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketcheck_sync_config (
  tenant_id     uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  allowed       boolean NOT NULL DEFAULT false,   -- super-admin grant of capability
  enabled       boolean NOT NULL DEFAULT false,   -- tenant on/off
  source        text    NOT NULL DEFAULT '',      -- dealer website domain (MarketCheck `source`)
  max_vehicles  integer NOT NULL DEFAULT 1000 CHECK (max_vehicles BETWEEN 1 AND 10000),
  frequency     text    NOT NULL DEFAULT 'nightly'
                  CHECK (frequency IN ('nightly','weekly','biweekly','monthly')),
  day_of_week   integer NOT NULL DEFAULT 0 CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday (UTC)
  run_hour      integer NOT NULL DEFAULT 3 CHECK (run_hour BETWEEN 0 AND 23),    -- UTC hour
  last_run_at   timestamptz,
  last_status   jsonb   NOT NULL DEFAULT '{}'::jsonb,
  updated_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketcheck_sync_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketcheck_config_read" ON public.marketcheck_sync_config;
CREATE POLICY "marketcheck_config_read" ON public.marketcheck_sync_config
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

-- Writes only via the definer RPCs below (column-level authority is split:
-- only a super admin may set `allowed`).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.marketcheck_sync_config FROM authenticated, anon;
GRANT SELECT ON public.marketcheck_sync_config TO authenticated;
GRANT ALL ON public.marketcheck_sync_config TO service_role;

-- Super admin grants / revokes a tenant's capability.
CREATE OR REPLACE FUNCTION public.set_marketcheck_allowed(_tenant_id uuid, _allowed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'only a platform admin can grant MarketCheck access';
  END IF;
  INSERT INTO public.marketcheck_sync_config (tenant_id, allowed, updated_by, updated_at)
  VALUES (_tenant_id, _allowed, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET allowed = EXCLUDED.allowed, updated_by = auth.uid(), updated_at = now();
END; $$;
GRANT EXECUTE ON FUNCTION public.set_marketcheck_allowed(uuid, boolean) TO authenticated;

-- Tenant owner/admin (or a super admin) configures the sync. Cannot set
-- `allowed`; that stays whatever the super admin granted.
CREATE OR REPLACE FUNCTION public.save_marketcheck_config(
  _tenant_id uuid, _enabled boolean, _source text, _max_vehicles integer,
  _frequency text, _day_of_week integer, _run_hour integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id = _tenant_id AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin') AND m.accepted_at IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'not authorized to configure MarketCheck for this tenant';
  END IF;
  INSERT INTO public.marketcheck_sync_config
    (tenant_id, enabled, source, max_vehicles, frequency, day_of_week, run_hour, updated_by, updated_at)
  VALUES
    (_tenant_id, _enabled, COALESCE(_source,''), COALESCE(_max_vehicles,1000),
     COALESCE(_frequency,'nightly'), COALESCE(_day_of_week,0), COALESCE(_run_hour,3), auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    enabled = EXCLUDED.enabled, source = EXCLUDED.source, max_vehicles = EXCLUDED.max_vehicles,
    frequency = EXCLUDED.frequency, day_of_week = EXCLUDED.day_of_week, run_hour = EXCLUDED.run_hour,
    updated_by = auth.uid(), updated_at = now();
END; $$;
GRANT EXECUTE ON FUNCTION public.save_marketcheck_config(uuid, boolean, text, integer, text, integer, integer)
  TO authenticated;

CREATE TRIGGER update_marketcheck_config_updated_at
  BEFORE UPDATE ON public.marketcheck_sync_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Hourly cron helper (mirrors schedule_crawl_advertised_prices). Runs the
-- edge function every hour at :07; the function decides which tenants are due
-- this hour from their run_hour + frequency + last_run_at. ──
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.schedule_marketcheck_sync(
  _cron_expr TEXT DEFAULT '7 * * * *',
  _supabase_url TEXT DEFAULT NULL,
  _service_key TEXT DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url TEXT; key TEXT; job_id BIGINT;
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
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'marketcheck-sync';
  SELECT cron.schedule('marketcheck-sync', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $job$,
    url || '/functions/v1/marketcheck-sync',
    'Bearer ' || key
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_marketcheck_sync(TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.unschedule_marketcheck_sync()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN DELETE FROM cron.job WHERE jobname = 'marketcheck-sync'; END $$;
GRANT EXECUTE ON FUNCTION public.unschedule_marketcheck_sync() TO service_role;
