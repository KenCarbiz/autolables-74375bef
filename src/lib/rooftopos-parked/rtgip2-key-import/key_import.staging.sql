-- rtgip/2 one-time Vault key import (C-S4 Alternative S1). STAGING ONLY, NEVER PRODUCTION.
-- Byte-identical in AutoLabels, AutoCurb and AutoFrame (PROVENANCE.json next to this file).
--
-- What it adds: a single-use import ticket that the database owner issues for one approved key id and
-- its approved SHA-256 fingerprint, and two functions the rtgip-key-import Edge Function calls as the
-- NOLOGIN role rtgip_key_importer: claim (checks and burns the ticket) and finish (re-checks the
-- material against the fingerprint, calls vault.create_secret, reads the value back and compares its
-- hash). The secret reaches the database only as a bind parameter of the finish call; no function here
-- returns, stores outside Vault, logs or raises it. Audit rows go to the existing append-only
-- rtgip.audit_log. rtgip_v2_delivery is not touched: after the import inbox_admit and
-- receipt_check_signature read rtgip:<key_id> from vault.decrypted_secrets exactly as before.
--
-- Applied only inside a guarded wrapper that pins the staging server address, and only after the
-- frozen delivery SQL. Idempotent. key_import.removal.sql removes the functions and the role and keeps
-- the ticket and audit rows.

DO $$
BEGIN
  IF to_regclass('rtgip.delivery_config') IS NULL OR to_regclass('rtgip.audit_log') IS NULL OR to_regclass('rtgip.signing_keys') IS NULL THEN
    RAISE EXCEPTION 'key_import_install: the rtgip/2 delivery schema is not installed';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'key_import_install: vault.create_secret(text,text,text,uuid) is not available';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_key_importer') THEN
    CREATE ROLE rtgip_key_importer NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA rtgip TO rtgip_key_importer;

-- The server this was installed on; claim and finish refuse anywhere else (a restored copy, a clone).
CREATE TABLE IF NOT EXISTS rtgip.key_import_install (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  server_addr inet,
  database_name text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  installed_by text NOT NULL DEFAULT current_user
);
INSERT INTO rtgip.key_import_install (id, server_addr, database_name)
VALUES (true, inet_server_addr(), current_database()) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS rtgip.key_import_tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id text NOT NULL CHECK (key_id IN ('stg-gateway-1','stg-autolabels-1','stg-autocurb-1','stg-autoframe-1')),
  vault_name text GENERATED ALWAYS AS ('rtgip:' || key_id) STORED,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$' AND fingerprint <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  approval_ref text NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$'),
  issued_by text NOT NULL DEFAULT current_user,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  finished_at timestamptz,
  outcome text CHECK (outcome ~ '^(imported|key_import_[a-z_]{1,40})$'),
  vault_secret_id uuid,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '15 minutes'),
  CHECK ((finished_at IS NULL) = (outcome IS NULL)),
  CHECK ((outcome = 'imported') = (vault_secret_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS key_import_one_imported_per_key ON rtgip.key_import_tickets (key_id) WHERE outcome = 'imported';
CREATE UNIQUE INDEX IF NOT EXISTS key_import_one_open_per_key ON rtgip.key_import_tickets (key_id) WHERE finished_at IS NULL;

-- A ticket only moves forward: claimed once, finished once, and nothing else about it ever changes.
CREATE OR REPLACE FUNCTION rtgip.key_import_tickets_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'rtgip.key_import_tickets is append-only';
  END IF;
  IF (NEW.ticket_id, NEW.key_id, NEW.fingerprint, NEW.token_sha256, NEW.approval_ref, NEW.issued_by, NEW.issued_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.ticket_id, OLD.key_id, OLD.fingerprint, OLD.token_sha256, OLD.approval_ref, OLD.issued_by, OLD.issued_at, OLD.expires_at)
     OR OLD.finished_at IS NOT NULL
     OR (OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at) THEN
    RAISE EXCEPTION 'rtgip.key_import_tickets: a ticket only moves forward';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS key_import_tickets_forward ON rtgip.key_import_tickets;
CREATE TRIGGER key_import_tickets_forward BEFORE UPDATE OR DELETE ON rtgip.key_import_tickets
  FOR EACH ROW EXECUTE FUNCTION rtgip.key_import_tickets_guard();
DROP TRIGGER IF EXISTS key_import_tickets_no_truncate ON rtgip.key_import_tickets;
CREATE TRIGGER key_import_tickets_no_truncate BEFORE TRUNCATE ON rtgip.key_import_tickets
  FOR EACH STATEMENT EXECUTE FUNCTION rtgip.audit_log_immutable();

-- NULL when every path that could write a bind parameter, a plan or a statement into a server log is
-- closed for this session; otherwise the first open path. Only the importer session's own settings
-- count, because they are the ones the import statements run under.
CREATE OR REPLACE FUNCTION rtgip.key_import_unsafe_logging() RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name = 'statement_timeout');
  v_explain_ms bigint := (SELECT setting::bigint FROM pg_catalog.pg_settings WHERE name = 'auto_explain.log_min_duration');
  v_pgaudit text := lower(coalesce(current_setting('pgaudit.log', true), 'none'));
BEGIN
  IF current_setting('log_statement') NOT IN ('none', 'ddl') THEN RETURN 'log_statement'; END IF;
  IF current_setting('log_min_duration_statement') <> '-1' THEN RETURN 'log_min_duration_statement'; END IF;
  IF current_setting('log_min_duration_sample', true) IS DISTINCT FROM '-1' AND current_setting('log_min_duration_sample', true) IS NOT NULL THEN RETURN 'log_min_duration_sample'; END IF;
  IF current_setting('log_transaction_sample_rate', true) IS DISTINCT FROM '0' AND current_setting('log_transaction_sample_rate', true) IS NOT NULL THEN RETURN 'log_transaction_sample_rate'; END IF;
  IF current_setting('log_parameter_max_length_on_error', true) IS DISTINCT FROM '0' AND current_setting('log_parameter_max_length_on_error', true) IS NOT NULL THEN RETURN 'log_parameter_max_length_on_error'; END IF;
  IF current_setting('debug_print_parse') <> 'off' OR current_setting('debug_print_rewritten') <> 'off' OR current_setting('debug_print_plan') <> 'off' THEN RETURN 'debug_print'; END IF;
  IF v_timeout_ms IS NULL OR v_timeout_ms < 1 OR v_timeout_ms > 5000 THEN RETURN 'statement_timeout'; END IF;
  IF v_explain_ms IS NOT NULL AND v_explain_ms >= 0 AND v_explain_ms <= v_timeout_ms THEN RETURN 'auto_explain'; END IF;
  IF v_pgaudit NOT IN ('none', '') THEN RETURN 'pgaudit'; END IF;
  RETURN NULL;
END $$;

-- Owner only. Issues one ticket for one approved key id and its approved fingerprint and returns the
-- single-use token once. Only the token's sha256 is stored.
CREATE OR REPLACE FUNCTION rtgip.key_import_issue(p_key_id text, p_fingerprint text, p_approval_ref text, p_ttl interval DEFAULT interval '10 minutes')
RETURNS TABLE (ticket_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_install rtgip.key_import_install%ROWTYPE;
  v_token text := encode(pg_catalog.sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
  v_id uuid;
BEGIN
  SELECT * INTO v_install FROM rtgip.key_import_install WHERE id;
  IF NOT FOUND OR inet_server_addr() IS DISTINCT FROM v_install.server_addr OR current_database() <> v_install.database_name THEN
    RAISE EXCEPTION 'key_import_wrong_server';
  END IF;
  IF p_key_id IS NULL OR p_key_id NOT IN ('stg-gateway-1','stg-autolabels-1','stg-autocurb-1','stg-autoframe-1') THEN
    RAISE EXCEPTION 'key_import_key_not_approved';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '15 minutes' THEN RAISE EXCEPTION 'key_import_bad_ttl'; END IF;
  IF EXISTS (SELECT 1 FROM rtgip.delivery_config WHERE transport_enabled IS DISTINCT FROM false) THEN RAISE EXCEPTION 'key_import_transport_on'; END IF;
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = 'rtgip:' || p_key_id) THEN RAISE EXCEPTION 'key_import_vault_name_taken'; END IF;
  IF EXISTS (SELECT 1 FROM rtgip.key_import_tickets t WHERE t.key_id = p_key_id AND t.outcome = 'imported') THEN RAISE EXCEPTION 'key_import_already_imported'; END IF;
  -- An earlier ticket for the key that expired, or was claimed and never finished, is closed first.
  UPDATE rtgip.key_import_tickets t SET finished_at = clock_timestamp(), outcome = 'key_import_abandoned'
   WHERE t.key_id = p_key_id AND t.finished_at IS NULL
     AND (t.expires_at < clock_timestamp() OR t.claimed_at < clock_timestamp() - interval '60 seconds');
  INSERT INTO rtgip.key_import_tickets (key_id, fingerprint, token_sha256, approval_ref, expires_at)
  VALUES (p_key_id, p_fingerprint, encode(pg_catalog.sha256(convert_to(v_token, 'UTF8')), 'hex'), p_approval_ref, clock_timestamp() + p_ttl)
  RETURNING key_import_tickets.ticket_id INTO v_id;
  INSERT INTO rtgip.audit_log (actor, action, detail)
  VALUES ('key_import', 'ticket_issued', jsonb_build_object('ticket_id', v_id, 'key_id', p_key_id, 'fingerprint', p_fingerprint, 'approval_ref', p_approval_ref, 'issued_by', session_user));
  ticket_id := v_id; token := v_token;
  RETURN NEXT;
END $$;

-- Importer only. Checks the ticket and the session and claims it. Inside these SECURITY DEFINER
-- functions current_user is the owner, so the caller's SET ROLE is read from the role setting. Every refusal burns the ticket and is
-- returned (not raised) so that the burn commits; the fingerprint is returned only with 'claimed'.
CREATE OR REPLACE FUNCTION rtgip.key_import_claim(p_ticket uuid, p_token text)
RETURNS TABLE (status text, key_id text, fingerprint text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t rtgip.key_import_tickets%ROWTYPE;
  v_install rtgip.key_import_install%ROWTYPE;
  v_status text;
  v_unsafe text;
BEGIN
  SELECT * INTO t FROM rtgip.key_import_tickets k WHERE k.ticket_id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO rtgip.audit_log (actor, action, detail) VALUES ('key_import', 'claim_refused', jsonb_build_object('reason', 'key_import_ticket_unknown'));
    status := 'key_import_ticket_unknown'; RETURN NEXT; RETURN;
  END IF;
  IF t.claimed_at IS NOT NULL OR t.finished_at IS NOT NULL THEN
    INSERT INTO rtgip.audit_log (actor, action, detail) VALUES ('key_import', 'claim_refused', jsonb_build_object('ticket_id', t.ticket_id, 'key_id', t.key_id, 'reason', 'key_import_ticket_used'));
    status := 'key_import_ticket_used'; RETURN NEXT; RETURN;
  END IF;
  SELECT * INTO v_install FROM rtgip.key_import_install WHERE id;
  v_unsafe := rtgip.key_import_unsafe_logging();
  v_status := CASE
    WHEN p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex') <> t.token_sha256 THEN 'key_import_token_mismatch'
    WHEN clock_timestamp() > t.expires_at THEN 'key_import_ticket_expired'
    WHEN v_install.id IS NULL OR inet_server_addr() IS DISTINCT FROM v_install.server_addr OR current_database() <> v_install.database_name THEN 'key_import_wrong_server'
    WHEN current_setting('role') <> 'rtgip_key_importer' THEN 'key_import_wrong_role'
    WHEN v_unsafe IS NOT NULL THEN 'key_import_unsafe_logging'
    WHEN EXISTS (SELECT 1 FROM rtgip.delivery_config WHERE transport_enabled IS DISTINCT FROM false) THEN 'key_import_transport_on'
    WHEN EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = t.vault_name) THEN 'key_import_vault_name_taken'
    WHEN EXISTS (SELECT 1 FROM rtgip.key_import_tickets k WHERE k.key_id = t.key_id AND k.outcome = 'imported') THEN 'key_import_already_imported'
    ELSE 'claimed' END;
  IF v_status = 'claimed' THEN
    UPDATE rtgip.key_import_tickets k SET claimed_at = clock_timestamp() WHERE k.ticket_id = t.ticket_id;
    INSERT INTO rtgip.audit_log (actor, action, detail) VALUES ('key_import', 'ticket_claimed', jsonb_build_object('ticket_id', t.ticket_id, 'key_id', t.key_id));
    status := 'claimed'; key_id := t.key_id; fingerprint := t.fingerprint;
  ELSE
    UPDATE rtgip.key_import_tickets k SET claimed_at = clock_timestamp(), finished_at = clock_timestamp(), outcome = v_status WHERE k.ticket_id = t.ticket_id;
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('key_import', 'claim_refused', jsonb_build_object('ticket_id', t.ticket_id, 'key_id', t.key_id, 'reason', v_status, 'unsafe_setting', v_unsafe));
    status := v_status;
  END IF;
  RETURN NEXT;
END $$;

-- Importer only. Finishes a claimed ticket once. p_local_reason is the function's own refusal (secret
-- missing, malformed or not matching), sent with p_secret NULL. Returns 'imported' or a refusal code.
CREATE OR REPLACE FUNCTION rtgip.key_import_finish(p_ticket uuid, p_token text, p_secret text, p_local_reason text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t rtgip.key_import_tickets%ROWTYPE;
  v_outcome text;
  v_id uuid;
  v_check text;
BEGIN
  SELECT * INTO t FROM rtgip.key_import_tickets k WHERE k.ticket_id = p_ticket FOR UPDATE;
  IF NOT FOUND OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex') <> t.token_sha256 THEN
    INSERT INTO rtgip.audit_log (actor, action, detail) VALUES ('key_import', 'finish_refused', jsonb_build_object('reason', 'key_import_not_claimed'));
    RETURN 'key_import_not_claimed';
  END IF;
  IF t.claimed_at IS NULL OR t.finished_at IS NOT NULL THEN
    INSERT INTO rtgip.audit_log (actor, action, detail) VALUES ('key_import', 'finish_refused', jsonb_build_object('ticket_id', t.ticket_id, 'key_id', t.key_id, 'reason', 'key_import_not_claimed'));
    RETURN 'key_import_not_claimed';
  END IF;
  v_outcome := CASE
    WHEN p_local_reason IS NOT NULL THEN
      CASE WHEN p_local_reason IN ('key_import_secret_missing','key_import_secret_malformed','key_import_fingerprint_mismatch') THEN p_local_reason ELSE 'key_import_bad_local_reason' END
    WHEN clock_timestamp() > t.claimed_at + interval '60 seconds' THEN 'key_import_finish_late'
    WHEN current_setting('role') <> 'rtgip_key_importer' THEN 'key_import_wrong_role'
    WHEN rtgip.key_import_unsafe_logging() IS NOT NULL THEN 'key_import_unsafe_logging'
    WHEN p_secret IS NULL THEN 'key_import_secret_missing'
    WHEN p_secret !~ '^[0-9a-f]{64}$' THEN 'key_import_secret_malformed'
    WHEN encode(pg_catalog.sha256(convert_to(p_secret, 'UTF8')), 'hex') <> t.fingerprint THEN 'key_import_fingerprint_mismatch'
    WHEN EXISTS (SELECT 1 FROM rtgip.delivery_config WHERE transport_enabled IS DISTINCT FROM false) THEN 'key_import_transport_on'
    WHEN EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = t.vault_name) THEN 'key_import_vault_name_taken'
    ELSE NULL END;
  IF v_outcome IS NULL THEN
    BEGIN
      v_id := vault.create_secret(p_secret, t.vault_name, 'rtgip/2 staging key ' || t.key_id || ', ticket ' || t.ticket_id::text, NULL);
      SELECT encode(pg_catalog.sha256(convert_to(s.decrypted_secret, 'UTF8')), 'hex') INTO v_check FROM vault.decrypted_secrets s WHERE s.id = v_id;
      IF v_check IS DISTINCT FROM t.fingerprint OR (SELECT count(*) FROM vault.decrypted_secrets s WHERE s.name = t.vault_name) <> 1 THEN
        RAISE EXCEPTION 'key_import_vault_verify_failed';
      END IF;
      v_outcome := 'imported';
    EXCEPTION WHEN OTHERS THEN
      -- The Vault write is rolled back with this block. Only the code is kept: the error text of a
      -- failed write is never recorded.
      v_outcome := CASE WHEN SQLERRM = 'key_import_vault_verify_failed' THEN 'key_import_vault_verify_failed'
                        WHEN SQLSTATE = '23505' THEN 'key_import_vault_name_taken'
                        ELSE 'key_import_vault_write_failed' END;
      v_id := NULL;
    END;
  END IF;
  UPDATE rtgip.key_import_tickets k SET finished_at = clock_timestamp(), outcome = v_outcome, vault_secret_id = CASE WHEN v_outcome = 'imported' THEN v_id END
   WHERE k.ticket_id = t.ticket_id;
  INSERT INTO rtgip.audit_log (actor, action, detail)
  VALUES ('key_import', CASE WHEN v_outcome = 'imported' THEN 'key_imported' ELSE 'finish_refused' END,
          jsonb_build_object('ticket_id', t.ticket_id, 'key_id', t.key_id, 'vault_name', t.vault_name, 'reason', v_outcome,
                             'fingerprint_verified', v_outcome = 'imported', 'vault_secret_id', CASE WHEN v_outcome = 'imported' THEN v_id END));
  RETURN v_outcome;
END $$;

-- Deny by default. The owner keeps issue; only rtgip_key_importer may claim and finish; nobody else
-- may read the tickets.
DO $$
DECLARE r text;
BEGIN
  ALTER TABLE rtgip.key_import_tickets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE rtgip.key_import_install ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON rtgip.key_import_tickets, rtgip.key_import_install FROM PUBLIC;
  REVOKE ALL ON FUNCTION rtgip.key_import_issue(text, text, text, interval), rtgip.key_import_claim(uuid, text),
    rtgip.key_import_finish(uuid, text, text, text), rtgip.key_import_unsafe_logging(), rtgip.key_import_tickets_guard() FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator','sandbox_exec','supabase_read_only_user','supabase_etl_admin',
                           'rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator','rtgip_key_importer'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON rtgip.key_import_tickets, rtgip.key_import_install FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION rtgip.key_import_issue(text, text, text, interval), rtgip.key_import_claim(uuid, text), rtgip.key_import_finish(uuid, text, text, text), rtgip.key_import_unsafe_logging(), rtgip.key_import_tickets_guard() FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION rtgip.key_import_claim(uuid, text), rtgip.key_import_finish(uuid, text, text, text) TO rtgip_key_importer;
-- The Edge Function connects as the database owner (SUPABASE_DB_URL) and runs every import statement
-- under SET LOCAL ROLE rtgip_key_importer.
GRANT rtgip_key_importer TO current_user;

NOTIFY pgrst, 'reload schema';
