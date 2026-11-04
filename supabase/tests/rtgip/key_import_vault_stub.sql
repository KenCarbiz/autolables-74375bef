-- Test-only stand-in for Supabase Vault's vault.create_secret(text, text, text, uuid), on top of
-- whichever plaintext Vault stub the node was built with: the vault.secrets table behind the
-- vault.decrypted_secrets view (AutoLabels rooftopos_stubs.sql) or a vault.decrypted_secrets table
-- (AutoCurb and AutoFrame stand-ins), given an id column so a write can be read back by id as on
-- hosted Vault. With the database setting test.vault_fail = 'on' it raises an error whose text
-- CONTAINS the secret, so a test can show a failed write never reaches a reply, the audit or a log.
-- Throwaway clusters only.
DO $stub$
DECLARE v_target text;
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = 'vault.decrypted_secrets'::regclass) = 'r' THEN
    ALTER TABLE vault.decrypted_secrets ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
    CREATE UNIQUE INDEX IF NOT EXISTS decrypted_secrets_id ON vault.decrypted_secrets (id);
    v_target := 'vault.decrypted_secrets (name, decrypted_secret)';
  ELSE
    v_target := 'vault.secrets (name, secret)';
  END IF;
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
    RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $b$
    DECLARE v uuid;
    BEGIN
      IF current_setting('test.vault_fail', true) = 'on' THEN
        RAISE EXCEPTION 'vault write failed for %%', new_secret;
      END IF;
      INSERT INTO %s VALUES (new_name, new_secret) RETURNING id INTO v;
      RETURN v;
    END $b$ $f$, v_target);
END $stub$;
REVOKE ALL ON SCHEMA vault FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vault.create_secret(text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA vault TO service_role;
GRANT SELECT ON vault.decrypted_secrets TO service_role;
GRANT EXECUTE ON FUNCTION vault.create_secret(text, text, text, uuid) TO service_role;
