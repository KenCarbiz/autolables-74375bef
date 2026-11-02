-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- rtgip/2 durable delivery ledger: service identity, nonce claims, outbox, signed receipts,
-- inbox, per-aggregate watermarks and an append-only audit log.
-- Shared byte-for-byte by AutoLabels and AutoCurb. Idempotent. Never applied anywhere, so
-- this revision redefines the tables rather than altering them. External transport is
-- pinned OFF by a CHECK constraint; turning it on requires a reviewed schema change.
--
-- Least privilege: every entry point is a SECURITY DEFINER function with an empty
-- search_path, EXECUTE is revoked from PUBLIC, anon, authenticated and service_role, and is
-- granted only to one NOLOGIN role per duty. A deployment grants one role to one login.
--   rtgip_outbox_writer   outbox_enqueue (inside the business transaction)
--   rtgip_dispatcher      outbox_claim, outbox_advance, outbox_fail
--   rtgip_inbox_receiver  claim_nonce, inbox_receive, inbox_quarantine
--   rtgip_operator        read-only SELECT on the ledger, purge_expired_nonces
-- Receipt secrets are read from Supabase Vault (vault.decrypted_secrets) by name; they are
-- never stored in rtgip tables and never returned.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS rtgip;
REVOKE ALL ON SCHEMA rtgip FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA rtgip TO rtgip_outbox_writer, rtgip_dispatcher, rtgip_inbox_receiver, rtgip_operator;

CREATE TABLE IF NOT EXISTS rtgip.delivery_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  transport_enabled boolean NOT NULL DEFAULT false CHECK (transport_enabled = false),
  -- The one app this database speaks for. NULL (the default) refuses every enqueue and receive.
  local_app text CHECK (local_app IN ('autolabels','autocurb','autoframe')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO rtgip.delivery_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS rtgip.connections (
  connection_id text PRIMARY KEY,
  source_app text NOT NULL CHECK (source_app IN ('autolabels','autocurb','autoframe','autofilm')),
  target_app text NOT NULL CHECK (target_app IN ('autolabels','autocurb','autoframe','autofilm')),
  tenant_id text NOT NULL,
  rooftop_ids text[] NOT NULL,
  event_types text[] NOT NULL,
  purposes text[] NOT NULL,
  producer_enabled boolean NOT NULL DEFAULT false,
  reader_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'suspended' CHECK (status IN ('active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_app <> target_app)
);

-- Secrets are never stored here: secret_ref names a Vault secret.
CREATE TABLE IF NOT EXISTS rtgip.signing_keys (
  key_id text PRIMARY KEY,
  owner text NOT NULL CHECK (owner IN ('autolabels','autocurb','autoframe','autofilm','gateway')),
  dialect text NOT NULL CHECK (dialect IN ('rtgip/2','autolabels.rooftopos/1','gateway.operator/1','autoframe.raw-hash/1')),
  connection_ids text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('current','previous','revoked')),
  not_before timestamptz NOT NULL,
  not_after timestamptz NOT NULL,
  secret_ref text NOT NULL,
  CHECK (not_after > not_before)
);

CREATE TABLE IF NOT EXISTS rtgip.nonce_claims (
  key_id text NOT NULL,
  nonce text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, nonce)
);

CREATE TABLE IF NOT EXISTS rtgip.outbox (
  event_id uuid PRIMARY KEY,
  route text NOT NULL,
  tenant_id text NOT NULL,
  -- Resolved once at enqueue; every receipt must name this connection.
  connection_id text NOT NULL REFERENCES rtgip.connections(connection_id),
  envelope jsonb NOT NULL,
  body text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending','in_flight','retry_wait','gateway_admitted','target_persisted',
    'consumer_committed','target_quarantined','dead_letter')),
  last_inbox_outcome text CHECK (last_inbox_outcome IN ('applied','duplicate','stale_ignored','held','quarantined')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON rtgip.outbox (next_attempt_at)
  WHERE state IN ('pending','retry_wait','in_flight','gateway_admitted','target_persisted');

-- One row per verified receipt per attempt. The exact signed bytes are retained.
CREATE TABLE IF NOT EXISTS rtgip.receipts (
  event_id uuid NOT NULL REFERENCES rtgip.outbox(event_id),
  attempt integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('gateway_admission','target_inbox','consumer_commit')),
  issuer text NOT NULL,
  outcome text NOT NULL,
  key_id text NOT NULL,
  signing_text text NOT NULL,
  signature text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, attempt, kind)
);

CREATE TABLE IF NOT EXISTS rtgip.inbox (
  tenant_id text NOT NULL,
  origin_app text NOT NULL,
  event_id uuid NOT NULL,
  wm_key text NOT NULL,
  revision bigint NOT NULL,
  prev_revision bigint,
  payload_sha256 text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied','stale_ignored','held','quarantined')),
  reason text,
  envelope jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  PRIMARY KEY (tenant_id, origin_app, event_id)
);
CREATE INDEX IF NOT EXISTS inbox_held_idx ON rtgip.inbox (wm_key, prev_revision) WHERE outcome = 'held';

CREATE TABLE IF NOT EXISTS rtgip.inbox_conflicts (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  origin_app text NOT NULL,
  event_id uuid NOT NULL,
  payload_sha256 text NOT NULL,
  envelope jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, origin_app, event_id, payload_sha256)
);

CREATE TABLE IF NOT EXISTS rtgip.watermarks (
  wm_key text PRIMARY KEY,
  revision bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rtgip.audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor text NOT NULL,
  action text NOT NULL,
  event_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION rtgip.audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'rtgip.audit_log is append-only';
END $$;
DROP TRIGGER IF EXISTS audit_log_no_update ON rtgip.audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE OR TRUNCATE ON rtgip.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION rtgip.audit_log_immutable();

-- The outbox state machine is enforced on the table itself, whoever writes to it.
CREATE OR REPLACE FUNCTION rtgip.outbox_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rtgip.outbox rows are retained'; END IF;
  IF NEW.event_id <> OLD.event_id OR NEW.body <> OLD.body OR NEW.body_sha256 <> OLD.body_sha256
     OR NEW.envelope <> OLD.envelope OR NEW.connection_id <> OLD.connection_id
     OR NEW.route <> OLD.route OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'outbox_row_immutable';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state IN ('pending','retry_wait') AND NEW.state = 'in_flight') OR
    (OLD.state = 'in_flight' AND NEW.state IN ('gateway_admitted','retry_wait','dead_letter')) OR
    (OLD.state = 'gateway_admitted' AND NEW.state IN ('target_persisted','target_quarantined','retry_wait','dead_letter','in_flight')) OR
    (OLD.state = 'target_persisted' AND NEW.state IN ('consumer_committed','retry_wait','dead_letter','in_flight'))
  ) THEN
    RAISE EXCEPTION 'illegal_outbox_transition:%->%', OLD.state, NEW.state;
  END IF;
  IF OLD.state IN ('consumer_committed','target_quarantined','dead_letter') THEN
    RAISE EXCEPTION 'illegal_outbox_transition:%->%', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outbox_guard ON rtgip.outbox;
CREATE TRIGGER outbox_guard BEFORE UPDATE OR DELETE ON rtgip.outbox
  FOR EACH ROW EXECUTE FUNCTION rtgip.outbox_guard();

CREATE OR REPLACE FUNCTION rtgip.local_app() RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT local_app FROM rtgip.delivery_config WHERE id
$$;

-- Same key as watermarkKey() in rtgip2/delivery.ts (route, instance and episode scoped).
CREATE OR REPLACE FUNCTION rtgip.watermark_key(p_envelope jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT array_to_string(ARRAY[
    p_envelope->>'tenant_id', p_envelope->>'rooftop_id', p_envelope->>'route', p_envelope#>>'{origin,app}',
    p_envelope#>>'{aggregate,domain}', p_envelope#>>'{aggregate,type}', p_envelope#>>'{aggregate,id}',
    p_envelope#>>'{vehicle,instance_id}',
    CASE WHEN p_envelope#>>'{aggregate,type}' = 'vehicle_instance' THEN '*' ELSE p_envelope#>>'{vehicle,episode_id}' END
  ], '|', '')
$$;

-- Nonce claim: 'claimed' | 'exact_retry' | 'conflict'. Safe under concurrent sessions.
CREATE OR REPLACE FUNCTION rtgip.claim_nonce(p_key_id text, p_nonce text, p_sha text, p_expires_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sha text;
BEGIN
  INSERT INTO rtgip.nonce_claims (key_id, nonce, body_sha256, expires_at)
  VALUES (p_key_id, p_nonce, p_sha, p_expires_at)
  ON CONFLICT (key_id, nonce) DO NOTHING;
  IF FOUND THEN RETURN 'claimed'; END IF;
  SELECT body_sha256 INTO v_sha FROM rtgip.nonce_claims WHERE key_id = p_key_id AND nonce = p_nonce;
  RETURN CASE WHEN v_sha = p_sha THEN 'exact_retry' ELSE 'conflict' END;
END $$;

-- Enqueue inside the caller's business transaction. The envelope is parsed from the exact
-- body bytes, its hash is computed here, its source must be this database's app and its
-- connection is resolved and pinned. Identical bytes are a no-op; any other reuse raises.
DROP FUNCTION IF EXISTS rtgip.outbox_enqueue(jsonb, text, text);
CREATE OR REPLACE FUNCTION rtgip.outbox_enqueue(p_body text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e jsonb; v_id uuid; v_sha text; v_prior text; v_conn text; v_n integer;
BEGIN
  BEGIN e := p_body::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'envelope_malformed'; END;
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'protocol' IS DISTINCT FROM 'rtgip/2' THEN RAISE EXCEPTION 'envelope_malformed'; END IF;
  BEGIN v_id := (e->>'event_id')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'envelope_malformed'; END;
  IF v_id IS NULL OR e->>'tenant_id' IS NULL OR e->>'rooftop_id' IS NULL OR e->>'event_type' IS NULL THEN RAISE EXCEPTION 'envelope_malformed'; END IF;
  IF rtgip.local_app() IS NULL OR e->>'source_app' IS DISTINCT FROM rtgip.local_app() THEN RAISE EXCEPTION 'source_not_local_app'; END IF;
  IF e->>'route' IS DISTINCT FROM (e->>'source_app') || '->' || (e->>'target_app') THEN RAISE EXCEPTION 'route_mismatch'; END IF;
  v_sha := encode(extensions.digest(convert_to(p_body, 'UTF8'), 'sha256'), 'hex');
  SELECT min(c.connection_id), count(*) INTO v_conn, v_n FROM rtgip.connections c
  WHERE c.source_app = e->>'source_app' AND c.target_app = e->>'target_app' AND c.tenant_id = e->>'tenant_id'
    AND (e->>'rooftop_id') = ANY (c.rooftop_ids) AND (e->>'event_type') = ANY (c.event_types)
    AND c.producer_enabled AND c.status <> 'revoked';
  IF v_n = 0 THEN RAISE EXCEPTION 'no_connection_for_event'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'ambiguous_connection'; END IF;
  INSERT INTO rtgip.outbox (event_id, route, tenant_id, connection_id, envelope, body, body_sha256)
  VALUES (v_id, e->>'route', e->>'tenant_id', v_conn, e, p_body, v_sha)
  ON CONFLICT (event_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES ('outbox', 'enqueued', v_id, jsonb_build_object('connection_id', v_conn));
    RETURN 'enqueued';
  END IF;
  SELECT body_sha256 INTO v_prior FROM rtgip.outbox WHERE event_id = v_id;
  IF v_prior <> v_sha THEN RAISE EXCEPTION 'event_id_conflict' USING ERRCODE = 'unique_violation'; END IF;
  RETURN 'duplicate';
END $$;

-- Lease due rows. SKIP LOCKED lets concurrent workers partition the queue. A row whose
-- lease expired mid-delivery is re-leased as a new attempt.
CREATE OR REPLACE FUNCTION rtgip.outbox_claim(p_worker text, p_limit integer, p_lease_seconds integer)
RETURNS SETOF rtgip.outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_worker IS NULL OR p_worker = '' OR p_lease_seconds NOT BETWEEN 1 AND 3600 OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT o.event_id FROM rtgip.outbox o
    WHERE (o.state IN ('pending','retry_wait') AND o.next_attempt_at <= now())
       OR (o.state IN ('in_flight','gateway_admitted','target_persisted') AND o.lease_until <= now())
    ORDER BY o.next_attempt_at, o.event_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE rtgip.outbox o SET state = 'in_flight', lease_owner = p_worker,
    lease_until = now() + make_interval(secs => p_lease_seconds), attempts = o.attempts + 1,
    last_inbox_outcome = NULL
  FROM due WHERE o.event_id = due.event_id
  RETURNING o.*;
END $$;

-- Advance only on a receipt this function verifies itself: HMAC over the exact signed
-- bytes with the issuer's Vault secret, every bound field equal to the outbox row and its
-- pinned connection, a key owned by the issuer, of dialect rtgip/2, not revoked, inside its
-- validity window and bound to the connection, an outcome the receipt kind may carry, and a
-- legal transition from the row's current state. Returns the new state, 'held' (receipt
-- recorded, row not advanced; the worker then calls outbox_fail), or 'rejected:<reason>'
-- (nothing changes except an audit entry).
DROP FUNCTION IF EXISTS rtgip.outbox_advance(uuid, text, text, jsonb);
CREATE OR REPLACE FUNCTION rtgip.outbox_advance(p_event_id uuid, p_worker text, p_signing_text text, p_signature text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o rtgip.outbox%ROWTYPE; k rtgip.signing_keys%ROWTYPE; c rtgip.connections%ROWTYPE;
  r jsonb; want jsonb; f text; v_kind text; v_outcome text; v_issuer text; v_iat bigint;
  v_secret text; v_mac text; v_to text;
  fields constant text[] := ARRAY['event_id','route','source_app','target_app','tenant_id','rooftop_id','connection_id','payload_sha256'];
  shape constant text[] := ARRAY['connection_id','event_id','issued_at','issuer','key_id','kind','outcome','payload_sha256','protocol','rooftop_id','route','source_app','target_app','tenant_id'];
BEGIN
  BEGIN
    SELECT * INTO o FROM rtgip.outbox WHERE event_id = p_event_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'unknown_event'; END IF;
    IF o.state IN ('consumer_committed','target_quarantined','dead_letter') THEN RAISE EXCEPTION 'illegal_transition:terminal:%', o.state; END IF;
    IF o.lease_owner IS DISTINCT FROM p_worker OR o.lease_until IS NULL OR o.lease_until <= now() THEN RAISE EXCEPTION 'not_lease_holder'; END IF;
    BEGIN r := p_signing_text::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'ack_malformed'; END;
    IF jsonb_typeof(r) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(r) x) IS DISTINCT FROM shape THEN
      RAISE EXCEPTION 'ack_malformed';
    END IF;
    v_kind := r->>'kind'; v_outcome := r->>'outcome';
    IF r->>'protocol' IS DISTINCT FROM 'rtgip/2' OR v_kind NOT IN ('gateway_admission','target_inbox','consumer_commit') THEN
      RAISE EXCEPTION 'ack_wrong_kind';
    END IF;
    want := jsonb_build_object('event_id', o.event_id::text, 'route', o.route, 'source_app', o.envelope->>'source_app',
      'target_app', o.envelope->>'target_app', 'tenant_id', o.tenant_id, 'rooftop_id', o.envelope->>'rooftop_id',
      'connection_id', o.connection_id, 'payload_sha256', o.envelope->>'payload_sha256');
    FOREACH f IN ARRAY fields LOOP
      IF jsonb_typeof(r->f) IS DISTINCT FROM 'string' OR r->>f IS DISTINCT FROM want->>f THEN RAISE EXCEPTION 'ack_wrong_%', f; END IF;
    END LOOP;
    v_issuer := CASE WHEN v_kind = 'gateway_admission' THEN 'gateway' ELSE o.envelope->>'target_app' END;
    IF r->>'issuer' IS DISTINCT FROM v_issuer THEN RAISE EXCEPTION 'ack_wrong_issuer'; END IF;
    IF NOT ((v_kind = 'gateway_admission' AND v_outcome = 'admitted')
         OR (v_kind = 'target_inbox' AND v_outcome IN ('applied','duplicate','stale_ignored','held','quarantined'))
         OR (v_kind = 'consumer_commit' AND v_outcome IN ('applied','stale_ignored'))) THEN
      RAISE EXCEPTION 'ack_outcome_not_allowed';
    END IF;
    IF jsonb_typeof(r->'issued_at') IS DISTINCT FROM 'number' OR (r->'issued_at')::text !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'ack_malformed'; END IF;
    v_iat := (r->>'issued_at')::bigint;
    IF to_timestamp(v_iat) > now() + interval '300 seconds' THEN RAISE EXCEPTION 'ack_issued_in_future'; END IF;
    SELECT * INTO k FROM rtgip.signing_keys WHERE key_id = r->>'key_id';
    IF NOT FOUND OR k.owner <> v_issuer THEN RAISE EXCEPTION 'ack_bad_key'; END IF;
    IF k.dialect <> 'rtgip/2' THEN RAISE EXCEPTION 'ack_key_dialect_mismatch'; END IF;
    IF k.status = 'revoked' THEN RAISE EXCEPTION 'ack_key_revoked'; END IF;
    IF to_timestamp(v_iat) < k.not_before OR to_timestamp(v_iat) > k.not_after THEN RAISE EXCEPTION 'ack_key_outside_validity'; END IF;
    IF NOT (o.connection_id = ANY (k.connection_ids)) THEN RAISE EXCEPTION 'ack_key_not_bound_to_connection'; END IF;
    SELECT * INTO c FROM rtgip.connections WHERE connection_id = o.connection_id;
    IF NOT FOUND OR c.source_app <> o.envelope->>'source_app' OR c.target_app <> o.envelope->>'target_app'
       OR c.tenant_id <> o.tenant_id OR NOT ((o.envelope->>'rooftop_id') = ANY (c.rooftop_ids)) THEN
      RAISE EXCEPTION 'ack_connection_mismatch';
    END IF;
    IF c.status <> 'active' THEN RAISE EXCEPTION 'ack_connection_inactive'; END IF;
    SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = k.secret_ref;
    IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'ack_key_secret_unavailable'; END IF;
    v_mac := encode(extensions.hmac(convert_to('rtgip/2-receipt' || chr(10) || p_signing_text, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
    IF p_signature IS NULL OR p_signature !~ '^[0-9a-f]{64}$' OR v_mac <> p_signature THEN RAISE EXCEPTION 'ack_bad_signature'; END IF;

    IF v_kind = 'gateway_admission' THEN
      IF o.state <> 'in_flight' THEN RAISE EXCEPTION 'illegal_transition:%:%', o.state, v_kind; END IF;
      v_to := 'gateway_admitted';
    ELSIF v_kind = 'target_inbox' THEN
      IF o.state <> 'gateway_admitted' THEN RAISE EXCEPTION 'illegal_transition:%:%', o.state, v_kind; END IF;
      v_to := CASE v_outcome WHEN 'quarantined' THEN 'target_quarantined' WHEN 'held' THEN 'held' ELSE 'target_persisted' END;
    ELSE
      IF o.state <> 'target_persisted' THEN RAISE EXCEPTION 'illegal_transition:%:%', o.state, v_kind; END IF;
      IF o.last_inbox_outcome NOT IN ('applied','stale_ignored','duplicate') THEN RAISE EXCEPTION 'ack_commit_contradicts_inbox'; END IF;
      IF o.last_inbox_outcome <> 'duplicate' AND o.last_inbox_outcome <> v_outcome THEN RAISE EXCEPTION 'ack_commit_contradicts_inbox'; END IF;
      v_to := 'consumer_committed';
    END IF;

    INSERT INTO rtgip.receipts (event_id, attempt, kind, issuer, outcome, key_id, signing_text, signature)
    VALUES (o.event_id, o.attempts, v_kind, v_issuer, v_outcome, k.key_id, p_signing_text, p_signature);
    UPDATE rtgip.outbox SET
      state = CASE WHEN v_to = 'held' THEN state ELSE v_to END,
      last_inbox_outcome = CASE WHEN v_kind = 'target_inbox' THEN v_outcome ELSE last_inbox_outcome END,
      lease_owner = CASE WHEN v_to IN ('consumer_committed','target_quarantined') THEN NULL ELSE lease_owner END,
      lease_until = CASE WHEN v_to IN ('consumer_committed','target_quarantined') THEN NULL ELSE lease_until END
    WHERE event_id = o.event_id;
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES (p_worker, 'advance:' || v_to, o.event_id, jsonb_build_object('kind', v_kind, 'outcome', v_outcome, 'key_id', k.key_id, 'attempt', o.attempts));
    RETURN v_to;
  EXCEPTION WHEN raise_exception OR invalid_text_representation THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES (coalesce(p_worker, '?'), 'receipt_rejected', p_event_id, jsonb_build_object('reason', SQLERRM));
    RETURN 'rejected:' || SQLERRM;
  END;
END $$;

CREATE OR REPLACE FUNCTION rtgip.outbox_fail(p_event_id uuid, p_worker text, p_reason text, p_backoff_seconds integer, p_max_attempts integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text;
BEGIN
  UPDATE rtgip.outbox SET
    state = CASE WHEN attempts >= p_max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
    next_attempt_at = now() + make_interval(secs => greatest(1, p_backoff_seconds)),
    lease_owner = NULL, lease_until = NULL, last_error = left(p_reason, 200)
  WHERE event_id = p_event_id AND lease_owner = p_worker
    AND state IN ('in_flight','gateway_admitted','target_persisted')
  RETURNING state INTO v_state;
  IF v_state IS NOT NULL THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES (p_worker, 'fail:' || v_state, p_event_id, jsonb_build_object('reason', left(p_reason, 200)));
  END IF;
  RETURN v_state;
END $$;

-- Receive one verified envelope. Returns every event that became 'applied' in revision
-- order (the received one plus any held successors it unblocked). The caller applies each
-- effect in the SAME transaction; any error rolls back the inbox rows too. A duplicate of a
-- held or quarantined event repeats that outcome with committed = false, so the caller can
-- never issue a consumer_commit receipt for it.
DROP FUNCTION IF EXISTS rtgip.inbox_receive(jsonb, text);
CREATE OR REPLACE FUNCTION rtgip.inbox_receive(p_envelope jsonb, p_receiver text)
RETURNS TABLE (event_id uuid, outcome text, reason text, committed boolean, envelope jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_tenant text := p_envelope->>'tenant_id';
  v_origin text := p_envelope#>>'{origin,app}';
  v_id uuid := (p_envelope->>'event_id')::uuid;
  v_sha text := p_envelope->>'payload_sha256';
  v_rev bigint := (p_envelope#>>'{aggregate,revision}')::bigint;
  v_prev bigint := (p_envelope#>>'{aggregate,prev_revision}')::bigint;
  v_wm text := rtgip.watermark_key(p_envelope);
  v_mark bigint;
  v_prior rtgip.inbox%ROWTYPE;
  v_next rtgip.inbox%ROWTYPE;
BEGIN
  IF rtgip.local_app() IS NULL OR p_receiver IS DISTINCT FROM rtgip.local_app() THEN RAISE EXCEPTION 'receiver_not_local_app'; END IF;
  IF p_envelope->>'target_app' IS DISTINCT FROM p_receiver THEN RAISE EXCEPTION 'wrong_destination'; END IF;
  IF v_tenant IS NULL OR v_origin IS NULL OR v_id IS NULL OR v_sha IS NULL OR v_rev IS NULL THEN RAISE EXCEPTION 'envelope_malformed'; END IF;
  -- Serialize per aggregate so concurrent deliveries cannot interleave watermark updates.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_wm, 0));

  SELECT * INTO v_prior FROM rtgip.inbox i WHERE i.tenant_id = v_tenant AND i.origin_app = v_origin AND i.event_id = v_id;
  IF FOUND THEN
    IF v_prior.payload_sha256 <> v_sha THEN
      INSERT INTO rtgip.inbox_conflicts (tenant_id, origin_app, event_id, payload_sha256, envelope)
      VALUES (v_tenant, v_origin, v_id, v_sha, p_envelope) ON CONFLICT DO NOTHING;
      RETURN QUERY SELECT v_id, 'quarantined'::text, 'conflicting_duplicate'::text, false, p_envelope;
    ELSIF v_prior.outcome IN ('held','quarantined') THEN
      RETURN QUERY SELECT v_id, v_prior.outcome, ('duplicate_of:' || v_prior.outcome)::text, false, p_envelope;
    ELSE
      RETURN QUERY SELECT v_id, 'duplicate'::text, ('duplicate_of:' || v_prior.outcome)::text, v_prior.committed_at IS NOT NULL, p_envelope;
    END IF;
    RETURN;
  END IF;

  SELECT w.revision INTO v_mark FROM rtgip.watermarks w WHERE w.wm_key = v_wm;
  IF v_mark IS NOT NULL AND v_rev <= v_mark THEN
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'stale_ignored', 'watermark:' || v_mark, p_envelope, now(), now());
    RETURN QUERY SELECT v_id, 'stale_ignored'::text, ('watermark:' || v_mark)::text, true, p_envelope;
    RETURN;
  END IF;
  IF v_prev IS DISTINCT FROM v_mark THEN
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'held', 'awaiting_revision:' || coalesce(v_prev::text, 'null'), p_envelope, now(), NULL);
    RETURN QUERY SELECT v_id, 'held'::text, ('awaiting_revision:' || coalesce(v_prev::text, 'null'))::text, false, p_envelope;
    RETURN;
  END IF;

  INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'applied', NULL, p_envelope, now(), now());
  INSERT INTO rtgip.watermarks AS w (wm_key, revision) VALUES (v_wm, v_rev)
    ON CONFLICT (wm_key) DO UPDATE SET revision = EXCLUDED.revision, updated_at = now();
  RETURN QUERY SELECT v_id, 'applied'::text, NULL::text, true, p_envelope;

  LOOP
    SELECT * INTO v_next FROM rtgip.inbox i WHERE i.wm_key = v_wm AND i.outcome = 'held' AND i.prev_revision = v_rev
      ORDER BY i.received_at LIMIT 1;
    EXIT WHEN NOT FOUND;
    UPDATE rtgip.inbox i SET outcome = 'applied', reason = NULL, committed_at = now()
      WHERE i.tenant_id = v_next.tenant_id AND i.origin_app = v_next.origin_app AND i.event_id = v_next.event_id;
    v_rev := v_next.revision;
    UPDATE rtgip.watermarks w SET revision = v_rev, updated_at = now() WHERE w.wm_key = v_wm;
    RETURN QUERY SELECT v_next.event_id, 'applied'::text, 'released_from_hold'::text, true, v_next.envelope;
  END LOOP;
END $$;

-- Consumer-level rejection after inbox_receive said 'applied' (e.g. unknown episode):
-- the caller rolls back to a savepoint and records the quarantine instead.
CREATE OR REPLACE FUNCTION rtgip.inbox_quarantine(p_envelope jsonb, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF rtgip.local_app() IS NULL OR p_envelope->>'target_app' IS DISTINCT FROM rtgip.local_app() THEN RAISE EXCEPTION 'receiver_not_local_app'; END IF;
  INSERT INTO rtgip.inbox (tenant_id, origin_app, event_id, wm_key, revision, prev_revision, payload_sha256, outcome, reason, envelope)
  VALUES (p_envelope->>'tenant_id', p_envelope#>>'{origin,app}', (p_envelope->>'event_id')::uuid, 'quarantine',
          (p_envelope#>>'{aggregate,revision}')::bigint, (p_envelope#>>'{aggregate,prev_revision}')::bigint,
          p_envelope->>'payload_sha256', 'quarantined', left(p_reason, 200), p_envelope)
  ON CONFLICT DO NOTHING;
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES ('inbox', 'quarantined', (p_envelope->>'event_id')::uuid, jsonb_build_object('reason', left(p_reason, 200)));
END $$;

-- Only expired nonce claims are ever purged; inbox, outbox, receipts and audit are retained.
CREATE OR REPLACE FUNCTION rtgip.purge_expired_nonces() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH d AS (DELETE FROM rtgip.nonce_claims WHERE expires_at < now() - interval '1 hour' RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;

-- Deny by default, then grant one duty per role. Tables are reachable only through the
-- functions above, except read-only SELECT for the operator role.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_config','connections','signing_keys','nonce_claims','outbox','receipts','inbox','inbox_conflicts','watermarks','audit_log'] LOOP
    EXECUTE format('ALTER TABLE rtgip.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA rtgip FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA rtgip FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip FROM PUBLIC';
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA rtgip FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA rtgip FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA rtgip FROM service_role';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION rtgip.outbox_enqueue(text) TO rtgip_outbox_writer;
GRANT EXECUTE ON FUNCTION rtgip.outbox_claim(text, integer, integer) TO rtgip_dispatcher;
GRANT EXECUTE ON FUNCTION rtgip.outbox_advance(uuid, text, text, text) TO rtgip_dispatcher;
GRANT EXECUTE ON FUNCTION rtgip.outbox_fail(uuid, text, text, integer, integer) TO rtgip_dispatcher;
GRANT EXECUTE ON FUNCTION rtgip.claim_nonce(text, text, text, timestamptz) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.inbox_receive(jsonb, text) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.inbox_quarantine(jsonb, text) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.purge_expired_nonces() TO rtgip_operator;
GRANT SELECT ON rtgip.connections, rtgip.signing_keys, rtgip.outbox, rtgip.receipts, rtgip.inbox,
  rtgip.inbox_conflicts, rtgip.watermarks, rtgip.audit_log TO rtgip_operator;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections','signing_keys','outbox','receipts','inbox','inbox_conflicts','watermarks','audit_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rtgip' AND tablename = t AND policyname = 'operator_read') THEN
      EXECUTE format('CREATE POLICY operator_read ON rtgip.%I FOR SELECT TO rtgip_operator USING (true)', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
