-- Forward recovery for E (rtgip_labels_effects): inbound rtgip/2 events are refused (no_consumer, so the
-- shared inbox quarantines them) and the consumer role can no longer run the AutoLabels effect. Keeps every
-- applied, evidence, review, media and revocation row (append-only). Re-running E restores the effect.
DO $$
BEGIN
  IF to_regprocedure('rtgip_fx.labels_apply(jsonb)') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_labels_consumer') THEN
    REVOKE EXECUTE ON FUNCTION rtgip_fx.labels_apply(jsonb) FROM rtgip_labels_consumer;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_labels_consumer') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_inbox_receiver') THEN
    REVOKE rtgip_labels_consumer FROM rtgip_inbox_receiver;
  END IF;
  IF to_regprocedure('rtgip.consumer_effect(jsonb)') IS NOT NULL THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION rtgip.consumer_effect(e jsonb) RETURNS jsonb
      LANGUAGE sql SET search_path = '' AS 'SELECT ''{"ok":false,"reason":"no_consumer"}''::jsonb'$f$;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
