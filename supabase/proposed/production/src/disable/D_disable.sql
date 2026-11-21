-- Forward recovery for D (rtgip_v2_delivery, shared and frozen): every delivery role loses its EXECUTE and
-- the operator loses read access; the inbox effect goes back to the refusing default. Transport is already
-- pinned off by a CHECK constraint and stays off. No table, row, trigger or audit record is touched.
-- Re-running D restores the grants.
DO $$
DECLARE g record;
BEGIN
  FOR g IN SELECT * FROM (VALUES
      ('rtgip.outbox_enqueue(text)','rtgip_outbox_writer'),
      ('rtgip.outbox_claim(text,integer,integer)','rtgip_dispatcher'),
      ('rtgip.outbox_advance(uuid,text,integer,text[])','rtgip_dispatcher'),
      ('rtgip.outbox_fail(uuid,text,integer,text,integer,integer)','rtgip_dispatcher'),
      ('rtgip.inbox_admit(jsonb,text,text,jsonb)','rtgip_inbox_receiver'),
      ('rtgip.inbox_record_receipts(text,text[])','rtgip_inbox_receiver'),
      ('rtgip.purge_expired_nonces()','rtgip_operator'),
      ('rtgip.outbox_redrive(uuid,text,text)','rtgip_operator')) v(fn, role) LOOP
    IF to_regprocedure(g.fn) IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = g.role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', g.fn, g.role);
    END IF;
  END LOOP;
  IF to_regclass('rtgip.audit_log') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_operator') THEN
    REVOKE SELECT ON rtgip.connections, rtgip.signing_keys, rtgip.outbox, rtgip.receipts, rtgip.inbox, rtgip.inbox_deliveries,
      rtgip.inbox_conflicts, rtgip.admissions, rtgip.watermarks, rtgip.audit_log FROM rtgip_operator;
  END IF;
  IF to_regprocedure('rtgip.consumer_effect(jsonb)') IS NOT NULL THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION rtgip.consumer_effect(e jsonb) RETURNS jsonb
      LANGUAGE sql SET search_path = '' AS 'SELECT ''{"ok":false,"reason":"no_consumer"}''::jsonb'$f$;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
