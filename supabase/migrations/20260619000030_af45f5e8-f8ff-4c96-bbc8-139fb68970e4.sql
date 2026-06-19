ALTER TABLE public.marketcheck_sync_config
  ADD COLUMN IF NOT EXISTS dealer_id text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.save_marketcheck_config(
  _tenant_id uuid, _enabled boolean, _source text, _max_vehicles integer,
  _frequency text, _day_of_week integer, _run_hour integer, _dealer_id text
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
    (tenant_id, enabled, source, max_vehicles, frequency, day_of_week, run_hour, dealer_id, updated_by, updated_at)
  VALUES
    (_tenant_id, _enabled, COALESCE(_source,''), COALESCE(_max_vehicles,1000),
     COALESCE(_frequency,'nightly'), COALESCE(_day_of_week,0), COALESCE(_run_hour,3), COALESCE(_dealer_id,''), auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    enabled = EXCLUDED.enabled, source = EXCLUDED.source, max_vehicles = EXCLUDED.max_vehicles,
    frequency = EXCLUDED.frequency, day_of_week = EXCLUDED.day_of_week, run_hour = EXCLUDED.run_hour,
    dealer_id = EXCLUDED.dealer_id, updated_by = auth.uid(), updated_at = now();
END; $$;

GRANT EXECUTE ON FUNCTION public.save_marketcheck_config(uuid, boolean, text, integer, text, integer, integer, text)
  TO authenticated;