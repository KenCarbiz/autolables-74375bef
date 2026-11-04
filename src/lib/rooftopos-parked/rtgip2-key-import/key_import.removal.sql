-- Removes the rtgip/2 one-time Vault key import after provisioning (C-S4 Alternative S1, cleanup).
-- STAGING ONLY. Byte-identical in AutoLabels, AutoCurb and AutoFrame (PROVENANCE.json).
--
-- Drops the issue, claim and finish functions, the logging check and the rtgip_key_importer role, and
-- closes any ticket still open. Keeps rtgip.key_import_tickets (no secret: token sha256, fingerprint,
-- outcome) and rtgip.key_import_install as the nonsecret record, and appends a removal row to
-- rtgip.audit_log. The Vault secrets it imported and rtgip_v2_delivery are not touched. Idempotent.

DO $$
BEGIN
  IF to_regclass('rtgip.key_import_tickets') IS NOT NULL THEN
    UPDATE rtgip.key_import_tickets SET claimed_at = coalesce(claimed_at, clock_timestamp()), finished_at = clock_timestamp(), outcome = 'key_import_removed'
     WHERE finished_at IS NULL;
  END IF;
END $$;

DROP FUNCTION IF EXISTS rtgip.key_import_issue(text, text, text, interval);
DROP FUNCTION IF EXISTS rtgip.key_import_claim(uuid, text);
DROP FUNCTION IF EXISTS rtgip.key_import_finish(uuid, text, text, text);
DROP FUNCTION IF EXISTS rtgip.key_import_unsafe_logging();

DO $$
DECLARE m record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_key_importer') THEN
    FOR m IN SELECT r.rolname FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.member
              WHERE a.roleid = (SELECT oid FROM pg_roles WHERE rolname = 'rtgip_key_importer') LOOP
      EXECUTE format('REVOKE rtgip_key_importer FROM %I', m.rolname);
    END LOOP;
    REVOKE ALL ON SCHEMA rtgip FROM rtgip_key_importer;
    DROP ROLE rtgip_key_importer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rtgip.audit_log WHERE actor = 'key_import' AND action = 'import_removed') THEN
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('key_import', 'import_removed', jsonb_build_object(
      'imported', (SELECT coalesce(jsonb_agg(key_id ORDER BY key_id), '[]'::jsonb) FROM rtgip.key_import_tickets WHERE outcome = 'imported'),
      'tickets', (SELECT count(*) FROM rtgip.key_import_tickets), 'by', session_user));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
