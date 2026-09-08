DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'schedule_compliance_forms_sweep(text,text,text)',
    'schedule_factory_sticker_sweep(text,text,text)',
    'schedule_ingest_orchestrate_sweep(text,text,text)',
    'schedule_oem_document_copy_sweep(text,text,text)',
    'schedule_packet_backfill(text,text,text)',
    'schedule_passport_delivery_flush(text,text,text)',
    'schedule_description_reconcile(text)',
    'advertised_price_crawl_queue(uuid,integer)',
    'claim_listing_orchestration(uuid)',
    'marketcheck_revive_listing(uuid,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated, PUBLIC', fn);
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE WARNING 'hardening: no such function public.%, grant not revoked', fn;
    END;
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_install_token(text, text, text)
  FROM anon, PUBLIC;

CREATE INDEX IF NOT EXISTS idx_description_feature_selections_tenant
  ON public.description_feature_selections (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_description_feature_selections_vehicle
  ON public.description_feature_selections (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_audit_store_created
  ON public.audit_log (store_id, created_at DESC);

DO $$
DECLARE
  still_open text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO still_open
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'schedule_compliance_forms_sweep','schedule_factory_sticker_sweep',
      'schedule_ingest_orchestrate_sweep','schedule_oem_document_copy_sweep',
      'schedule_packet_backfill','schedule_passport_delivery_flush',
      'schedule_description_reconcile','advertised_price_crawl_queue',
      'claim_listing_orchestration','marketcheck_revive_listing',
      'get_or_create_install_token')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF still_open IS NOT NULL THEN
    RAISE EXCEPTION 'hardening failed: still anon-executable: %', still_open;
  END IF;
END $$;