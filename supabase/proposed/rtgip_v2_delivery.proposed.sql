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
--   rtgip_inbox_receiver  inbox_admit only (verified inbound admission, see below)
--   rtgip_operator        read-only SELECT on the ledger, purge_expired_nonces, outbox_redrive
-- Receipt secrets are read from Supabase Vault (vault.decrypted_secrets) by name; they are
-- never stored in rtgip tables and never returned.
-- Inbound admission is verified here, not trusted from the caller: inbox_admit takes the raw
-- Gateway headers and body bytes, recomputes the HMAC, timestamp window, nonce claim,
-- canonical form, scope, payload hash, derived event id, route catalog, source authority,
-- destination, purpose and the connection grant before the inbox engine runs. The engine
-- (inbox_receive) and the nonce table are not executable by any login role.

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
  -- Start of the current attempt. A receipt issued before it (less skew) is refused.
  attempt_started_at timestamptz,
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

-- One row per verified inbound delivery (Gateway key + nonce). Written only by inbox_admit,
-- after every check passed, in the same transaction as the inbox decision and the effect.
CREATE TABLE IF NOT EXISTS rtgip.admissions (
  id bigserial PRIMARY KEY,
  key_id text NOT NULL,
  nonce text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  event_id uuid NOT NULL,
  connection_id text NOT NULL REFERENCES rtgip.connections(connection_id),
  signer text NOT NULL,
  outcome text NOT NULL,
  consumer_reject text,
  admitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admissions_event_idx ON rtgip.admissions (event_id);

-- Protocol catalog (route, event type, owner, purposes, schema versions) and the forbidden
-- key list, generated from rtgip2/protocol.ts. A Vitest check fails if they drift.
CREATE TABLE IF NOT EXISTS rtgip.event_catalog (
  route text NOT NULL,
  event_type text NOT NULL,
  owner text NOT NULL,
  purposes text[] NOT NULL,
  schema_versions integer[] NOT NULL,
  PRIMARY KEY (route, event_type)
);
CREATE TABLE IF NOT EXISTS rtgip.forbidden_keys (key text PRIMARY KEY);
-- BEGIN GENERATED rtgip catalog (rtgip2-matrix/sql-catalog.gen.test.ts; do not edit by hand)
DELETE FROM rtgip.event_catalog;
INSERT INTO rtgip.event_catalog (route, event_type, owner, purposes, schema_versions) VALUES
  ('autolabels->autocurb', 'vehicle.identity_registered', 'autolabels', '{inventory_sync}', '{2}'),
  ('autolabels->autocurb', 'inventory.status_changed', 'autolabels', '{inventory_sync}', '{2}'),
  ('autolabels->autocurb', 'custody.episode_opened', 'autolabels', '{custody_evidence}', '{2}'),
  ('autolabels->autocurb', 'custody.episode_closed', 'autolabels', '{custody_evidence}', '{2}'),
  ('autolabels->autocurb', 'sale.milestone_recorded', 'autolabels', '{custody_evidence}', '{2}'),
  ('autolabels->autocurb', 'listing.price_published', 'autolabels', '{inventory_sync}', '{2}'),
  ('autocurb->autolabels', 'appraisal.completed', 'autocurb', '{acquisition_evidence}', '{2}'),
  ('autocurb->autolabels', 'acquisition.milestone_recorded', 'autocurb', '{acquisition_evidence}', '{2}'),
  ('autocurb->autolabels', 'acquisition.purchase_completed', 'autocurb', '{acquisition_evidence,custody_evidence}', '{2}'),
  ('autolabels->autoframe', 'vehicle.identity_registered', 'autolabels', '{inventory_sync}', '{2}'),
  ('autolabels->autoframe', 'inventory.status_changed', 'autolabels', '{inventory_sync}', '{2}'),
  ('autolabels->autoframe', 'custody.episode_opened', 'autolabels', '{custody_evidence}', '{2}'),
  ('autolabels->autoframe', 'custody.episode_closed', 'autolabels', '{custody_evidence}', '{2}'),
  ('autolabels->autoframe', 'sale.milestone_recorded', 'autolabels', '{custody_evidence}', '{2}'),
  ('autolabels->autoframe', 'listing.availability_changed', 'autolabels', '{inventory_sync}', '{2}'),
  ('autoframe->autolabels', 'media.approved', 'autoframe', '{media_reference}', '{2}'),
  ('autoframe->autolabels', 'media.revoked', 'autoframe', '{media_reference}', '{2}'),
  ('autocurb->autoframe', 'appraisal.completed', 'autocurb', '{acquisition_evidence}', '{2}'),
  ('autocurb->autoframe', 'acquisition.purchase_completed', 'autocurb', '{acquisition_evidence}', '{2}'),
  ('autoframe->autocurb', 'media.approved', 'autoframe', '{media_reference}', '{2}'),
  ('autoframe->autocurb', 'media.revoked', 'autoframe', '{media_reference}', '{2}');
DELETE FROM rtgip.forbidden_keys;
INSERT INTO rtgip.forbidden_keys (key) VALUES ('access_token'), ('acv'), ('acv_cents'), ('acv_value'), ('address'), ('amount_financed'), ('appraised_acv'), ('appraised_value'), ('apr'), ('base64'), ('blob'), ('bytes'), ('check_amount'), ('city'), ('cost'), ('current_offer'), ('customer_id'), ('customer_name'), ('data_uri'), ('date_of_birth'), ('dealer_cost'), ('dl_number'), ('dob'), ('down_payment'), ('drivers_license'), ('email'), ('estimated_offer'), ('estimated_offer_high'), ('estimated_offer_low'), ('final_offer'), ('finance_amount'), ('first_name'), ('full_name'), ('gross_profit'), ('holdback'), ('image_bytes'), ('image_url'), ('invoice_price'), ('last_name'), ('lead_id'), ('lien_amount'), ('mobile'), ('monthly_payment'), ('name'), ('offer_amount'), ('offer_price'), ('offered_price'), ('pack'), ('payoff_amount'), ('phone'), ('phone_e164'), ('photo_url'), ('postal_code'), ('public_url'), ('purchase_amount'), ('purchase_price'), ('recon_cost'), ('reserve'), ('signed_url'), ('ssn'), ('street'), ('submission_id'), ('token'), ('trade_profit'), ('unit_cost'), ('url'), ('zip');
-- END GENERATED rtgip catalog

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
  -- The one way out of dead_letter is rtgip.outbox_redrive (operator, reason, audited).
  IF OLD.state = 'dead_letter' AND NEW.state = 'retry_wait' AND NEW.attempts = 0
     AND current_setting('rtgip.redrive', true) = 'on' THEN
    RETURN NEW;
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


-- Canonical JSON exactly as canonicalize() in rtgip2/protocol.ts for the value space the
-- protocol allows: keys sorted by code point, no whitespace, safe integers only, strings
-- escaped as JSON.stringify does. Non-ASCII keys, floats and out-of-range integers raise,
-- so anything the TypeScript side would not reproduce byte for byte fails closed.
CREATE OR REPLACE FUNCTION rtgip.canonical_json(j jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE t text := jsonb_typeof(j); out text;
BEGIN
  IF t = 'object' THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(j) k WHERE k !~ '^[ -~]*$') THEN RAISE EXCEPTION 'body_not_canonical'; END IF;
    SELECT '{' || coalesce(string_agg(to_jsonb(x.key)::text || ':' || rtgip.canonical_json(x.value), ',' ORDER BY x.key COLLATE "C"), '') || '}'
      INTO out FROM jsonb_each(j) x;
    RETURN out;
  ELSIF t = 'array' THEN
    SELECT '[' || coalesce(string_agg(rtgip.canonical_json(x.value), ',' ORDER BY x.ord), '') || ']'
      INTO out FROM jsonb_array_elements(j) WITH ORDINALITY x(value, ord);
    RETURN out;
  ELSIF t = 'number' THEN
    IF j::text !~ '^-?(0|[1-9][0-9]{0,15})$' OR abs(j::text::numeric) > 9007199254740991 THEN RAISE EXCEPTION 'body_not_canonical'; END IF;
    RETURN j::text;
  END IF;
  RETURN j::text;
END $$;

-- deriveEventId() in rtgip2/protocol.ts: SHA-256 over the canonical scope array, UUID layout.
CREATE OR REPLACE FUNCTION rtgip.derive_event_id(e jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE h text;
BEGIN
  h := encode(extensions.digest(convert_to(rtgip.canonical_json(jsonb_build_array('rtgip/2-event/v2',
    e->'source_app', e->'tenant_id', e->'rooftop_id', e#>'{vehicle,instance_id}', e#>'{vehicle,episode_id}',
    e#>'{origin,event_id}', e->'route')), 'UTF8'), 'sha256'), 'hex');
  RETURN substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-5' || substr(h, 14, 3) || '-'
    || to_hex((('x' || lpad(substr(h, 17, 1), 8, '0'))::bit(32)::integer & 3) | 8) || substr(h, 18, 3) || '-' || substr(h, 21, 12);
END $$;

-- Compare two MACs without an early exit on the first differing byte.
CREATE OR REPLACE FUNCTION rtgip.ct_equal(a text, b text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE ba bytea; bb bytea; d integer; n integer;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN false; END IF;
  ba := convert_to(a, 'UTF8'); bb := convert_to(b, 'UTF8');
  d := length(ba) # length(bb); n := greatest(length(ba), length(bb));
  FOR i IN 0 .. n - 1 LOOP
    d := d | ((CASE WHEN i < length(ba) THEN get_byte(ba, i) ELSE 0 END) # (CASE WHEN i < length(bb) THEN get_byte(bb, i) ELSE 0 END));
  END LOOP;
  RETURN d = 0;
END $$;

-- deliverableReason() in rtgip2/delivery.ts. NULL means the connection may carry this event now.
CREATE OR REPLACE FUNCTION rtgip.deliverable_reason(p_connection_id text, p_envelope jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN c.connection_id IS NULL OR c.source_app IS DISTINCT FROM p_envelope->>'source_app'
      OR c.target_app IS DISTINCT FROM p_envelope->>'target_app' OR c.tenant_id IS DISTINCT FROM p_envelope->>'tenant_id'
      OR NOT coalesce((p_envelope->>'rooftop_id') = ANY (c.rooftop_ids), false) THEN 'connection_mismatch'
    WHEN c.status <> 'active' THEN 'connection_inactive'
    WHEN NOT c.producer_enabled THEN 'producer_disabled'
    WHEN NOT c.reader_enabled THEN 'reader_disabled'
    WHEN NOT coalesce((p_envelope->>'event_type') = ANY (c.event_types), false) THEN 'event_not_granted'
    WHEN NOT coalesce((p_envelope->>'purpose') = ANY (c.purposes), false) THEN 'purpose_not_granted'
  END
  FROM (SELECT 1) one LEFT JOIN rtgip.connections c ON c.connection_id = p_connection_id
$$;

-- Nonce claim: 'claimed' | 'exact_retry' | 'conflict'. Safe under concurrent sessions.
-- Internal: reachable only through inbox_admit, after the delivery MAC has verified.
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
-- lease expired mid-delivery is re-leased as a new attempt. A row whose connection is not
-- deliverable right now (suspended, revoked, a side disabled, grant narrowed) stays paused:
-- it is not leased and spends no attempt.
CREATE OR REPLACE FUNCTION rtgip.outbox_claim(p_worker text, p_limit integer, p_lease_seconds integer)
RETURNS SETOF rtgip.outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_worker IS NULL OR p_worker = '' OR p_lease_seconds NOT BETWEEN 1 AND 3600 OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT o.event_id FROM rtgip.outbox o
    WHERE ((o.state IN ('pending','retry_wait') AND o.next_attempt_at <= now())
        OR (o.state IN ('in_flight','gateway_admitted','target_persisted') AND o.lease_until <= now()))
      AND rtgip.deliverable_reason(o.connection_id, o.envelope) IS NULL
    ORDER BY o.next_attempt_at, o.event_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE rtgip.outbox o SET state = 'in_flight', lease_owner = p_worker,
    lease_until = now() + make_interval(secs => p_lease_seconds), attempts = o.attempts + 1,
    attempt_started_at = now(), last_inbox_outcome = NULL
  FROM due WHERE o.event_id = due.event_id
  RETURNING o.*;
END $$;

-- Advance only on a receipt this function verifies itself: HMAC over the exact signed
-- bytes with the issuer's Vault secret, every bound field equal to the outbox row and its
-- pinned connection, a key owned by the issuer, of dialect rtgip/2, not revoked, inside its
-- validity window and bound to the connection, an outcome the receipt kind may carry, a
-- connection that is still deliverable, an issue time inside the current attempt, and a
-- legal transition from the row's current state. Returns the new state, 'held' (receipt
-- recorded, row not advanced; the worker then calls outbox_fail), or 'rejected:<reason>'
-- (nothing changes except an audit entry).
DROP FUNCTION IF EXISTS rtgip.outbox_advance(uuid, text, text, jsonb);
CREATE OR REPLACE FUNCTION rtgip.outbox_advance(p_event_id uuid, p_worker text, p_signing_text text, p_signature text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o rtgip.outbox%ROWTYPE; k rtgip.signing_keys%ROWTYPE;
  r jsonb; want jsonb; f text; v_kind text; v_outcome text; v_issuer text; v_iat bigint;
  v_secret text; v_mac text; v_to text; v_why text;
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
    IF o.attempt_started_at IS NULL OR to_timestamp(v_iat) < o.attempt_started_at - interval '300 seconds' THEN
      RAISE EXCEPTION 'ack_predates_attempt';
    END IF;
    SELECT * INTO k FROM rtgip.signing_keys WHERE key_id = r->>'key_id';
    IF NOT FOUND OR k.owner <> v_issuer THEN RAISE EXCEPTION 'ack_bad_key'; END IF;
    IF k.dialect <> 'rtgip/2' THEN RAISE EXCEPTION 'ack_key_dialect_mismatch'; END IF;
    IF k.status = 'revoked' THEN RAISE EXCEPTION 'ack_key_revoked'; END IF;
    IF to_timestamp(v_iat) < k.not_before OR to_timestamp(v_iat) > k.not_after THEN RAISE EXCEPTION 'ack_key_outside_validity'; END IF;
    IF NOT (o.connection_id = ANY (k.connection_ids)) THEN RAISE EXCEPTION 'ack_key_not_bound_to_connection'; END IF;
    v_why := rtgip.deliverable_reason(o.connection_id, o.envelope);
    IF v_why IS NOT NULL THEN RAISE EXCEPTION 'ack_%', v_why; END IF;
    SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = k.secret_ref;
    IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'ack_key_secret_unavailable'; END IF;
    v_mac := encode(extensions.hmac(convert_to('rtgip/2-receipt' || chr(10) || p_signing_text, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
    IF p_signature IS NULL OR p_signature !~ '^[0-9a-f]{64}$' OR NOT rtgip.ct_equal(v_mac, p_signature) THEN RAISE EXCEPTION 'ack_bad_signature'; END IF;

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

-- A failure while the connection is not deliverable is a pause: the attempt is given back
-- and the row cannot dead-letter until the grant returns (same rule as MemoryOutbox).
CREATE OR REPLACE FUNCTION rtgip.outbox_fail(p_event_id uuid, p_worker text, p_reason text, p_backoff_seconds integer, p_max_attempts integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state text; v_why text;
BEGIN
  SELECT rtgip.deliverable_reason(o.connection_id, o.envelope) INTO v_why FROM rtgip.outbox o WHERE o.event_id = p_event_id;
  UPDATE rtgip.outbox SET
    state = CASE WHEN v_why IS NULL AND attempts >= p_max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
    attempts = CASE WHEN v_why IS NULL THEN attempts ELSE greatest(0, attempts - 1) END,
    next_attempt_at = now() + make_interval(secs => greatest(1, p_backoff_seconds)),
    lease_owner = NULL, lease_until = NULL, last_error = left(p_reason, 200)
  WHERE event_id = p_event_id AND lease_owner = p_worker
    AND state IN ('in_flight','gateway_admitted','target_persisted')
  RETURNING state INTO v_state;
  IF v_state IS NOT NULL THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES (p_worker, CASE WHEN v_why IS NULL THEN 'fail:' ELSE 'pause:' END || v_state, p_event_id,
            jsonb_build_object('reason', left(p_reason, 200), 'paused_by', v_why));
  END IF;
  RETURN v_state;
END $$;

-- Inbox engine. Internal: no login role can execute it; only inbox_admit calls it, after
-- full verification. Returns every event that became 'applied' in revision order (the
-- received one plus any held successors it unblocked). The caller applies each effect in
-- the SAME transaction; any error rolls back the inbox rows too. A duplicate of a held or
-- quarantined event repeats that outcome with committed = false, so no consumer_commit
-- receipt can be issued for it. p_reject_event marks the event whose consumer effect failed
-- in a rolled-back first pass: it is recorded as quarantined instead of applied, and the
-- watermark does not move past it.
DROP FUNCTION IF EXISTS rtgip.inbox_receive(jsonb, text);
DROP FUNCTION IF EXISTS rtgip.inbox_receive(jsonb, text, uuid, text);
CREATE OR REPLACE FUNCTION rtgip.inbox_receive(p_envelope jsonb, p_receiver text, p_reject_event uuid DEFAULT NULL, p_reject_reason text DEFAULT NULL)
RETURNS TABLE (event_id uuid, outcome text, reason text, committed boolean, committed_outcome text, envelope jsonb)
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
  v_rej text := left(coalesce(p_reject_reason, 'consumer_reject'), 200);
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
    -- The whole envelope is immutable under its event id, not just the payload.
    IF v_prior.payload_sha256 <> v_sha OR v_prior.envelope <> p_envelope THEN
      INSERT INTO rtgip.inbox_conflicts (tenant_id, origin_app, event_id, payload_sha256, envelope)
      VALUES (v_tenant, v_origin, v_id, v_sha, p_envelope) ON CONFLICT DO NOTHING;
      RETURN QUERY SELECT v_id, 'quarantined'::text, 'conflicting_duplicate'::text, false, NULL::text, p_envelope;
    ELSIF v_prior.outcome IN ('held','quarantined') THEN
      RETURN QUERY SELECT v_id, v_prior.outcome, ('duplicate_of:' || v_prior.outcome)::text, false, NULL::text, p_envelope;
    ELSE
      RETURN QUERY SELECT v_id, 'duplicate'::text, ('duplicate_of:' || v_prior.outcome)::text, v_prior.committed_at IS NOT NULL,
        CASE WHEN v_prior.committed_at IS NOT NULL THEN v_prior.outcome END, p_envelope;
    END IF;
    RETURN;
  END IF;

  SELECT w.revision INTO v_mark FROM rtgip.watermarks w WHERE w.wm_key = v_wm;
  IF v_mark IS NOT NULL AND v_rev <= v_mark THEN
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'stale_ignored', 'watermark:' || v_mark, p_envelope, now(), now());
    RETURN QUERY SELECT v_id, 'stale_ignored'::text, ('watermark:' || v_mark)::text, true, 'stale_ignored'::text, p_envelope;
    RETURN;
  END IF;
  IF v_prev IS DISTINCT FROM v_mark THEN
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'held', 'awaiting_revision:' || coalesce(v_prev::text, 'null'), p_envelope, now(), NULL);
    RETURN QUERY SELECT v_id, 'held'::text, ('awaiting_revision:' || coalesce(v_prev::text, 'null'))::text, false, NULL::text, p_envelope;
    RETURN;
  END IF;
  IF v_id = p_reject_event THEN
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'quarantined', v_rej, p_envelope, now(), NULL);
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES ('inbox', 'quarantined', v_id, jsonb_build_object('reason', v_rej));
    RETURN QUERY SELECT v_id, 'quarantined'::text, v_rej, false, NULL::text, p_envelope;
    RETURN;
  END IF;

  INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'applied', NULL, p_envelope, now(), now());
  INSERT INTO rtgip.watermarks AS w (wm_key, revision) VALUES (v_wm, v_rev)
    ON CONFLICT (wm_key) DO UPDATE SET revision = EXCLUDED.revision, updated_at = now();
  RETURN QUERY SELECT v_id, 'applied'::text, NULL::text, true, 'applied'::text, p_envelope;

  LOOP
    SELECT * INTO v_next FROM rtgip.inbox i WHERE i.wm_key = v_wm AND i.outcome = 'held' AND i.prev_revision = v_rev
      ORDER BY i.received_at LIMIT 1;
    EXIT WHEN NOT FOUND;
    IF v_next.event_id = p_reject_event THEN
      UPDATE rtgip.inbox i SET outcome = 'quarantined', reason = v_rej
        WHERE i.tenant_id = v_next.tenant_id AND i.origin_app = v_next.origin_app AND i.event_id = v_next.event_id;
      INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES ('inbox', 'quarantined', v_next.event_id, jsonb_build_object('reason', v_rej));
      RETURN QUERY SELECT v_next.event_id, 'quarantined'::text, v_rej, false, NULL::text, v_next.envelope;
      EXIT;
    END IF;
    UPDATE rtgip.inbox i SET outcome = 'applied', reason = NULL, committed_at = now()
      WHERE i.tenant_id = v_next.tenant_id AND i.origin_app = v_next.origin_app AND i.event_id = v_next.event_id;
    v_rev := v_next.revision;
    UPDATE rtgip.watermarks w SET revision = v_rev, updated_at = now() WHERE w.wm_key = v_wm;
    RETURN QUERY SELECT v_next.event_id, 'applied'::text, 'released_from_hold'::text, true, 'applied'::text, v_next.envelope;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS rtgip.inbox_quarantine(jsonb, text);

-- Verified inbound admission: the ONLY inbound entry point granted to any role. The caller
-- passes the Gateway's rtgip-* headers and the exact body bytes; nothing about the delivery
-- is taken on trust. Order mirrors verifyDelivery() in rtgip2/protocol.ts:
--   1. headers, key (rtgip/2, not revoked, in validity, owned by the Gateway signer),
--      timestamp window, size, and the HMAC over the exact bytes with the Vault secret;
--   2. the nonce claim (only after the MAC matched, so a forgery cannot burn a nonce;
--      an exact retry of the same bytes is allowed, any other reuse is refused);
--   3. canonical bytes, exact field set, scope header, payload hash, derived event id,
--      destination (this database's app), route catalog, source authority, purpose,
--      schema version, forbidden keys and link-like values, and the connection grant
--      (active, both sides enabled, rooftop, event type, purpose, key bound to it);
--   4. the admission row and the inbox decision, in the caller's transaction.
-- A refusal returns one row with outcome 'rejected' and its reason, changes nothing but the
-- nonce claim (from step 2 on) and an audit entry, and never reaches the inbox.
-- p_consumer_reject {"event_id", "reason"} is the second pass after the caller rolled back
-- to a savepoint because a consumer effect failed: the same delivery is verified again from
-- scratch and that event is recorded as quarantined. It must name an event this delivery
-- actually reaches, or the call raises.
DROP FUNCTION IF EXISTS rtgip.inbox_admit(jsonb, text, jsonb);
CREATE OR REPLACE FUNCTION rtgip.inbox_admit(p_headers jsonb, p_body text, p_consumer_reject jsonb DEFAULT NULL)
RETURNS TABLE (admission_id bigint, event_id uuid, outcome text, reason text, committed boolean, committed_outcome text, connection_id text, envelope jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_local text := rtgip.local_app();
  h_key text := left(p_headers->>'rtgip-key-id', 128);
  h_signer text := p_headers->>'rtgip-signer';
  h_ts text := p_headers->>'rtgip-timestamp';
  h_nonce text := p_headers->>'rtgip-nonce';
  h_scope text := p_headers->>'rtgip-scope';
  h_sig text := p_headers->>'rtgip-signature';
  k rtgip.signing_keys%ROWTYPE; cat rtgip.event_catalog%ROWTYPE;
  e jsonb; v_secret text; v_sha text; v_claim text; v_conn text; v_n integer; v_why text;
  v_adm bigint; v_rej_event uuid; v_rej_reason text; v_first text; v_rej_seen boolean := false; rec record;
  shape constant text[] := ARRAY['aggregate','causation_id','classification','correlation_id','emitted_at','event_id','event_type',
    'occurred_at','origin','payload','payload_sha256','protocol','purpose','rooftop_id','route','schema_version','source_app','target_app','tenant_id','vehicle'];
BEGIN
  BEGIN
    IF v_local IS NULL THEN RAISE EXCEPTION 'receiver_not_local_app'; END IF;
    IF jsonb_typeof(p_headers) IS DISTINCT FROM 'object' OR p_headers->>'rtgip-protocol' IS DISTINCT FROM 'rtgip/2' THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
    IF h_key IS NULL OR h_signer IS NULL OR h_ts IS NULL OR h_nonce IS NULL OR h_scope IS NULL OR h_sig IS NULL THEN RAISE EXCEPTION 'missing_headers'; END IF;
    IF left(h_sig, 7) <> 'rtgip2=' THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
    IF h_nonce !~ '^[A-Za-z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'invalid_nonce'; END IF;
    SELECT * INTO k FROM rtgip.signing_keys sk WHERE sk.key_id = h_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'unknown_key'; END IF;
    IF k.dialect <> 'rtgip/2' THEN RAISE EXCEPTION 'key_dialect_mismatch'; END IF;
    IF k.status = 'revoked' THEN RAISE EXCEPTION 'key_revoked'; END IF;
    IF now() < k.not_before OR now() > k.not_after THEN RAISE EXCEPTION 'key_outside_validity'; END IF;
    IF k.owner <> h_signer THEN RAISE EXCEPTION 'signer_key_mismatch'; END IF;
    IF h_signer <> 'gateway' THEN RAISE EXCEPTION 'signer_not_gateway'; END IF;
    IF h_ts !~ '^[0-9]{1,12}$' OR abs(extract(epoch FROM now()) - h_ts::bigint) > 300 THEN RAISE EXCEPTION 'timestamp_out_of_window'; END IF;
    IF p_body IS NULL OR octet_length(convert_to(p_body, 'UTF8')) > 65536 THEN RAISE EXCEPTION 'body_too_large'; END IF;
    v_sha := encode(extensions.digest(convert_to(p_body, 'UTF8'), 'sha256'), 'hex');
    SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = k.secret_ref;
    IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'key_secret_unavailable'; END IF;
    IF NOT rtgip.ct_equal('rtgip2=' || encode(extensions.hmac(convert_to(array_to_string(
         ARRAY['rtgip/2', h_key, k.owner, h_ts, h_nonce, h_scope, v_sha], chr(10)), 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex'), h_sig) THEN
      RAISE EXCEPTION 'bad_signature';
    END IF;
  EXCEPTION WHEN raise_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('inbox', 'admission_rejected', jsonb_build_object('stage', 'signature', 'reason', SQLERRM, 'key_id', h_key));
    RETURN QUERY SELECT NULL::bigint, NULL::uuid, 'rejected'::text, SQLERRM::text, false, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END;

  v_claim := rtgip.claim_nonce(h_key, h_nonce, v_sha, to_timestamp(h_ts::bigint + 900));
  IF v_claim = 'conflict' THEN
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('inbox', 'admission_rejected', jsonb_build_object('stage', 'nonce', 'reason', 'nonce_reused', 'key_id', h_key));
    RETURN QUERY SELECT NULL::bigint, NULL::uuid, 'rejected'::text, 'nonce_reused'::text, false, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  BEGIN
    BEGIN e := p_body::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'malformed_json'; END;
    IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_envelope:not_an_object'; END IF;
    IF rtgip.canonical_json(e) <> p_body THEN RAISE EXCEPTION 'body_not_canonical'; END IF;
    IF (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(e) x) IS DISTINCT FROM shape THEN RAISE EXCEPTION 'invalid_envelope:fields'; END IF;
    IF e->>'protocol' IS DISTINCT FROM 'rtgip/2' THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
    IF jsonb_typeof(e->'schema_version') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'payload') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM unnest(ARRAY[e->'event_id', e->'event_type', e->'source_app', e->'target_app', e->'route', e->'purpose',
            e->'tenant_id', e->'rooftop_id', e->'payload_sha256', e#>'{vehicle,instance_id}', e#>'{vehicle,episode_id}', e#>'{origin,event_id}']) v
          WHERE jsonb_typeof(v) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'invalid_envelope:identity';
    END IF;
    IF h_scope IS DISTINCT FROM array_to_string(ARRAY[e->>'source_app', e->>'target_app', e->>'tenant_id', e->>'rooftop_id',
         e->>'event_type', e->>'schema_version', e->>'purpose', e->>'event_id'], ';') THEN
      RAISE EXCEPTION 'scope_mismatch';
    END IF;
    IF encode(extensions.digest(convert_to(rtgip.canonical_json(e->'payload'), 'UTF8'), 'sha256'), 'hex') IS DISTINCT FROM e->>'payload_sha256' THEN
      RAISE EXCEPTION 'payload_hash_mismatch';
    END IF;
    IF rtgip.derive_event_id(e) IS DISTINCT FROM e->>'event_id' THEN RAISE EXCEPTION 'event_id_not_derived'; END IF;
    IF e->>'target_app' IS DISTINCT FROM v_local THEN RAISE EXCEPTION 'wrong_destination'; END IF;
    IF e->>'route' IS DISTINCT FROM (e->>'source_app') || '->' || (e->>'target_app') THEN RAISE EXCEPTION 'unknown_route'; END IF;
    IF e->>'source_app' = 'autofilm' OR e->>'target_app' = 'autofilm' THEN RAISE EXCEPTION 'route_reserved'; END IF;
    SELECT * INTO cat FROM rtgip.event_catalog ec WHERE ec.route = e->>'route' AND ec.event_type = e->>'event_type';
    IF NOT FOUND THEN RAISE EXCEPTION 'event_not_on_route'; END IF;
    IF cat.owner <> e->>'source_app' THEN RAISE EXCEPTION 'not_source_authority'; END IF;
    IF NOT ((e->>'purpose') = ANY (cat.purposes)) THEN RAISE EXCEPTION 'purpose_not_allowed'; END IF;
    IF NOT ((e->'schema_version')::text ~ '^[0-9]{1,6}$' AND (e->>'schema_version')::integer = ANY (cat.schema_versions)) THEN
      RAISE EXCEPTION 'unsupported_schema_version';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_path_query(e, 'lax $.**') v
               WHERE (jsonb_typeof(v) = 'object' AND EXISTS (SELECT 1 FROM jsonb_object_keys(v) kk JOIN rtgip.forbidden_keys fk ON fk.key = lower(kk)))
                  OR (jsonb_typeof(v) = 'string' AND (v #>> '{}') ~* '^(https?:|data:|blob:|ftp:)')) THEN
      RAISE EXCEPTION 'invalid_envelope:sensitive_content';
    END IF;
    SELECT min(c.connection_id), count(*) INTO v_conn, v_n FROM rtgip.connections c
      WHERE c.source_app = e->>'source_app' AND c.target_app = e->>'target_app' AND c.tenant_id = e->>'tenant_id' AND c.status = 'active';
    IF v_n = 0 THEN
      IF EXISTS (SELECT 1 FROM rtgip.connections c WHERE c.source_app = e->>'source_app' AND c.target_app = e->>'target_app' AND c.tenant_id = e->>'tenant_id') THEN
        RAISE EXCEPTION 'connection_revoked';
      END IF;
      RAISE EXCEPTION 'no_connection_for_tenant';
    END IF;
    IF v_n > 1 THEN RAISE EXCEPTION 'ambiguous_connection'; END IF;
    v_why := rtgip.deliverable_reason(v_conn, e);
    IF v_why = 'connection_mismatch' THEN RAISE EXCEPTION 'rooftop_not_granted'; END IF;
    IF v_why IS NOT NULL THEN RAISE EXCEPTION '%', v_why; END IF;
    IF NOT (v_conn = ANY (k.connection_ids)) THEN RAISE EXCEPTION 'key_not_bound_to_connection'; END IF;
    IF p_consumer_reject IS NOT NULL THEN
      BEGIN v_rej_event := (p_consumer_reject->>'event_id')::uuid; EXCEPTION WHEN others THEN v_rej_event := NULL; END;
      v_rej_reason := left(p_consumer_reject->>'reason', 180);
      IF v_rej_event IS NULL OR v_rej_reason IS NULL OR v_rej_reason = '' THEN RAISE EXCEPTION 'invalid_consumer_reject'; END IF;
    END IF;
  EXCEPTION WHEN raise_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('inbox', 'admission_rejected', jsonb_build_object('stage', 'envelope', 'reason', SQLERRM, 'key_id', h_key, 'body_sha256', v_sha));
    RETURN QUERY SELECT NULL::bigint, NULL::uuid, 'rejected'::text, SQLERRM::text, false, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END;

  v_adm := nextval(pg_get_serial_sequence('rtgip.admissions', 'id'));
  FOR rec IN SELECT * FROM rtgip.inbox_receive(e, v_local, v_rej_event, CASE WHEN v_rej_reason IS NOT NULL THEN 'consumer_reject:' || v_rej_reason END) LOOP
    v_first := coalesce(v_first, rec.outcome);
    IF rec.event_id = v_rej_event AND rec.outcome = 'quarantined' THEN v_rej_seen := true; END IF;
    admission_id := v_adm; event_id := rec.event_id; outcome := rec.outcome; reason := rec.reason;
    committed := rec.committed; committed_outcome := rec.committed_outcome; connection_id := v_conn; envelope := rec.envelope;
    RETURN NEXT;
  END LOOP;
  IF v_rej_event IS NOT NULL AND NOT v_rej_seen THEN RAISE EXCEPTION 'consumer_reject_not_applicable'; END IF;
  INSERT INTO rtgip.admissions (id, key_id, nonce, body_sha256, event_id, connection_id, signer, outcome, consumer_reject)
  VALUES (v_adm, h_key, h_nonce, v_sha, (e->>'event_id')::uuid, v_conn, h_signer, v_first, v_rej_reason);
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES ('inbox', 'admitted:' || v_first, (e->>'event_id')::uuid,
          jsonb_build_object('admission_id', v_adm, 'connection_id', v_conn, 'key_id', h_key, 'nonce_claim', v_claim));
END $$;

-- Only expired nonce claims are ever purged; inbox, outbox, receipts and audit are retained.
CREATE OR REPLACE FUNCTION rtgip.purge_expired_nonces() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH d AS (DELETE FROM rtgip.nonce_claims WHERE expires_at < now() - interval '1 hour' RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;

-- Operator redrive of a dead-lettered row: an explicit, reasoned, audited return to the queue.
-- The row keeps its event, body, receipts and audit history; only the retry counters reset. A
-- row whose connection is not deliverable stays dead until the grant returns.
CREATE OR REPLACE FUNCTION rtgip.outbox_redrive(p_event_id uuid, p_operator text, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o rtgip.outbox%ROWTYPE; v_why text;
BEGIN
  IF p_operator IS NULL OR p_operator = '' THEN RAISE EXCEPTION 'operator_required'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO o FROM rtgip.outbox WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_event'; END IF;
  IF o.state <> 'dead_letter' THEN RAISE EXCEPTION 'not_dead_lettered:%', o.state; END IF;
  v_why := rtgip.deliverable_reason(o.connection_id, o.envelope);
  IF v_why IS NOT NULL THEN RAISE EXCEPTION 'not_deliverable:%', v_why; END IF;
  PERFORM set_config('rtgip.redrive', 'on', true);
  UPDATE rtgip.outbox SET state = 'retry_wait', attempts = 0, next_attempt_at = now(), lease_owner = NULL, lease_until = NULL
   WHERE event_id = p_event_id;
  PERFORM set_config('rtgip.redrive', 'off', true);
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES (p_operator, 'redrive', p_event_id, jsonb_build_object('reason', left(p_reason, 200), 'prior_attempts', o.attempts, 'last_error', o.last_error));
  RETURN 'retry_wait';
END $$;

-- Deny by default, then grant one duty per role. Tables are reachable only through the
-- functions above, except read-only SELECT for the operator role.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_config','connections','signing_keys','nonce_claims','outbox','receipts','inbox','inbox_conflicts',
                           'admissions','event_catalog','forbidden_keys','watermarks','audit_log'] LOOP
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
GRANT EXECUTE ON FUNCTION rtgip.inbox_admit(jsonb, text, jsonb) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.purge_expired_nonces() TO rtgip_operator;
GRANT EXECUTE ON FUNCTION rtgip.outbox_redrive(uuid, text, text) TO rtgip_operator;
GRANT SELECT ON rtgip.connections, rtgip.signing_keys, rtgip.outbox, rtgip.receipts, rtgip.inbox,
  rtgip.inbox_conflicts, rtgip.admissions, rtgip.watermarks, rtgip.audit_log TO rtgip_operator;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections','signing_keys','outbox','receipts','inbox','inbox_conflicts','admissions','watermarks','audit_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rtgip' AND tablename = t AND policyname = 'operator_read') THEN
      EXECUTE format('CREATE POLICY operator_read ON rtgip.%I FOR SELECT TO rtgip_operator USING (true)', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
