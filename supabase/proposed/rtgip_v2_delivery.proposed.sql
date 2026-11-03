-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- rtgip/2 durable delivery ledger: service identity, nonce claims, outbox, signed rtgip/2-receipt/2
-- receipts, inbox, per-aggregate watermarks and an append-only audit log.
-- Shared byte-for-byte by AutoLabels and AutoCurb. Idempotent. Never applied anywhere, so
-- this revision redefines the tables rather than altering them. External transport is
-- pinned OFF by a CHECK constraint; turning it on requires a reviewed schema change.
--
-- Least privilege: every entry point is a SECURITY DEFINER function with an empty
-- search_path, EXECUTE is revoked from PUBLIC, anon, authenticated and service_role, and is
-- granted only to one NOLOGIN role per duty. A deployment grants one role to one login.
--   rtgip_outbox_writer   outbox_enqueue (inside the business transaction)
--   rtgip_dispatcher      outbox_claim, outbox_advance, outbox_fail
--   rtgip_inbox_receiver  inbox_admit (verified inbound admission, see below) and
--                         inbox_record_receipts (persist the receipts the endpoint signed)
--   rtgip_operator        read-only SELECT on the ledger, purge_expired_nonces, outbox_redrive
-- Receipt secrets are read from Supabase Vault (vault.decrypted_secrets) by name; they are
-- never stored in rtgip tables and never returned.
-- Inbound admission is verified here, not trusted from the caller: inbox_admit takes the raw
-- Gateway headers and body bytes, recomputes the HMAC, timestamp window, nonce claim,
-- canonical form, scope, payload hash, derived event id, route catalog, source authority,
-- destination, purpose and the connection grant before the inbox engine runs. The engine
-- (inbox_receive) and the nonce table are not executable by any login role.
-- Receipts: the outbox advances in two steps. A verified gateway_admission receipt moves a
-- row to gateway_admitted; only a fully verified [admission, inbox, commit] chain moves it to
-- consumer_committed. Every claim increments lease_generation, and outbox_advance and
-- outbox_fail raise lost_lease for any other generation, so a worker whose lease was
-- re-claimed can change nothing. The consumer effect runs in the inbox transaction through
-- rtgip.consumer_effect(jsonb); the default refuses everything (no_consumer) and each app's
-- effects file replaces it with CREATE OR REPLACE.

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
    'pending','in_flight','retry_wait','gateway_admitted',
    'consumer_committed','target_quarantined','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  attempt_started_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rtgip.outbox ADD COLUMN IF NOT EXISTS delivery_id text CHECK (delivery_id ~ '^[0-9a-f]{64}$');
ALTER TABLE rtgip.outbox ADD COLUMN IF NOT EXISTS lease_generation integer NOT NULL DEFAULT 0;
ALTER TABLE rtgip.outbox ADD COLUMN IF NOT EXISTS lease_action text CHECK (lease_action IN ('deliver','confirm'));
ALTER TABLE rtgip.outbox ADD COLUMN IF NOT EXISTS receipts jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS outbox_due_idx ON rtgip.outbox (next_attempt_at)
  WHERE state IN ('pending','retry_wait','in_flight','gateway_admitted');

-- One row per verified receipt per attempt: signing_text is the canonical unsigned receipt.
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
ALTER TABLE rtgip.inbox ADD COLUMN IF NOT EXISTS delivery_id text CHECK (delivery_id ~ '^[0-9a-f]{64}$');
ALTER TABLE rtgip.inbox ADD COLUMN IF NOT EXISTS admission_digest text CHECK (admission_digest ~ '^[0-9a-f]{64}$');
ALTER TABLE rtgip.inbox ADD COLUMN IF NOT EXISTS issued_at bigint;
CREATE INDEX IF NOT EXISTS inbox_held_idx ON rtgip.inbox (wm_key, prev_revision) WHERE outcome = 'held';

-- One row per delivery_id (one envelope on one connection). Holds the decision made for that
-- delivery, the issue time every receipt for it carries, and, once signed, the exact receipt
-- texts returned for it. A redelivery of the same delivery_id gets the stored receipts byte for
-- byte; a decision made but not yet signed is re-signed from issued_at.
CREATE TABLE IF NOT EXISTS rtgip.inbox_deliveries (
  delivery_id text PRIMARY KEY CHECK (delivery_id ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL,
  origin_app text NOT NULL,
  event_id uuid NOT NULL,
  connection_id text NOT NULL,
  admission_digest text NOT NULL CHECK (admission_digest ~ '^[0-9a-f]{64}$'),
  issued_at bigint NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied','duplicate','stale_ignored','held','quarantined')),
  commit_outcome text CHECK (commit_outcome IN ('applied','stale_ignored')),
  reason text,
  receipts text[],
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

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
     OR NEW.route <> OLD.route OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id THEN
    RAISE EXCEPTION 'outbox_row_immutable';
  END IF;
  IF NEW.lease_generation < OLD.lease_generation THEN RAISE EXCEPTION 'lease_generation_decreased'; END IF;
  -- The admission receipt is stored once and never replaced.
  IF jsonb_array_length(OLD.receipts) > 0 AND NEW.receipts->0 IS DISTINCT FROM OLD.receipts->0 THEN
    RAISE EXCEPTION 'admission_receipt_immutable';
  END IF;
  -- The one way out of dead_letter is rtgip.outbox_redrive (operator, reason, audited).
  IF OLD.state = 'dead_letter' AND NEW.state = 'retry_wait' AND NEW.attempts = 0
     AND current_setting('rtgip.redrive', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state IN ('pending','retry_wait') AND NEW.state = 'in_flight') OR
    (OLD.state = 'in_flight' AND NEW.state IN ('gateway_admitted','retry_wait','dead_letter')) OR
    (OLD.state = 'gateway_admitted' AND NEW.state IN ('consumer_committed','target_quarantined','dead_letter'))
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

-- Receipts stored for a delivery are never replaced or cleared; the decision never moves
-- once it is terminal.
CREATE OR REPLACE FUNCTION rtgip.inbox_deliveries_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rtgip.inbox_deliveries rows are retained'; END IF;
  IF NEW.delivery_id <> OLD.delivery_id OR NEW.event_id <> OLD.event_id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.admission_digest <> OLD.admission_digest OR NEW.issued_at <> OLD.issued_at THEN
    RAISE EXCEPTION 'inbox_delivery_immutable';
  END IF;
  IF OLD.receipts IS NOT NULL AND NEW.receipts IS DISTINCT FROM OLD.receipts THEN RAISE EXCEPTION 'receipts_conflict'; END IF;
  IF OLD.outcome <> 'held' AND (NEW.outcome <> OLD.outcome OR NEW.commit_outcome IS DISTINCT FROM OLD.commit_outcome) THEN
    RAISE EXCEPTION 'inbox_delivery_decision_final';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inbox_deliveries_guard ON rtgip.inbox_deliveries;
CREATE TRIGGER inbox_deliveries_guard BEFORE UPDATE OR DELETE ON rtgip.inbox_deliveries
  FOR EACH ROW EXECUTE FUNCTION rtgip.inbox_deliveries_guard();

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

-- The clock receipt checks use. It is now(); it exists so a throwaway test cluster can pin time
-- with CREATE OR REPLACE (only the function owner can). It is not a session setting, so no
-- login role can move it.
CREATE OR REPLACE FUNCTION rtgip.clock() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT now() $$;

-- Canonical JSON of a flat receipt, as canonicalize() in rtgip2/protocol.ts renders it: keys
-- sorted by code point, no whitespace, values strings, safe non-negative integers or null,
-- strings escaped as JSON.stringify does. Anything else raises, so a text this function
-- reproduces byte for byte is exactly the text the signer signed.
CREATE OR REPLACE FUNCTION rtgip.receipt_canonical(j jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'receipt_not_flat'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(j) k WHERE k !~ '^[ -~]*$') THEN RAISE EXCEPTION 'receipt_not_flat'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(j) x
             WHERE NOT (jsonb_typeof(x.value) IN ('string', 'null')
                        OR (jsonb_typeof(x.value) = 'number' AND x.value::text ~ '^(0|[1-9][0-9]{0,15})$'))) THEN
    RAISE EXCEPTION 'receipt_not_flat';
  END IF;
  RETURN '{' || coalesce((SELECT string_agg(to_jsonb(x.key)::text || ':' || x.value::text, ',' ORDER BY x.key COLLATE "C")
                          FROM jsonb_each(j) x), '') || '}';
END $$;

-- sha256 of canonicalize(envelope): the envelope_sha256 every receipt binds.
CREATE OR REPLACE FUNCTION rtgip.envelope_sha(e jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(rtgip.canonical_json(e), 'UTF8'), 'sha256'), 'hex')
$$;

-- deliveryIdentity() in rtgip2/receipt-v2.ts.
CREATE OR REPLACE FUNCTION rtgip.delivery_identity(p_connection text, e jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(rtgip.canonical_json(jsonb_build_array('rtgip/2-receipt/2',
    p_connection, e->>'event_id', e->>'target_app', rtgip.envelope_sha(e))), 'UTF8'), 'sha256'), 'hex')
$$;

-- The consumer effect, in the inbox transaction. The default refuses everything: until an
-- app's effects file replaces it, every event is quarantined with no_consumer. Contract:
-- {"ok": true [, "duplicate": true] [, "review": true]} or {"ok": false, "reason": "..."}.
DO $$
BEGIN
  IF to_regprocedure('rtgip.consumer_effect(jsonb)') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION rtgip.consumer_effect(e jsonb) RETURNS jsonb
      LANGUAGE sql SET search_path = '' AS 'SELECT ''{"ok":false,"reason":"no_consumer"}''::jsonb'$f$;
  END IF;
END $$;

-- deliverableReason() in rtgip2/delivery.ts. NULL means the connection may carry this event now.
CREATE OR REPLACE FUNCTION rtgip.deliverable_reason(p_connection_id text, p_envelope jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN c.connection_id IS NULL OR c.source_app IS DISTINCT FROM p_envelope->>'source_app'
      OR c.target_app IS DISTINCT FROM p_envelope->>'target_app' OR c.tenant_id IS DISTINCT FROM p_envelope->>'tenant_id'
      OR NOT coalesce((p_envelope->>'rooftop_id') = ANY (c.rooftop_ids), false) THEN 'connection_mismatch'
    WHEN c.status <> 'active' THEN 'connection_inactive'
    WHEN EXISTS (SELECT 1 FROM rtgip.connections o WHERE o.connection_id <> c.connection_id AND o.status = 'active'
                 AND o.source_app = c.source_app AND o.target_app = c.target_app AND o.tenant_id = c.tenant_id
                 AND (p_envelope->>'rooftop_id') = ANY (o.rooftop_ids)) THEN 'ambiguous_connection'
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
  INSERT INTO rtgip.outbox (event_id, route, tenant_id, connection_id, envelope, body, body_sha256, delivery_id)
  VALUES (v_id, e->>'route', e->>'tenant_id', v_conn, e, p_body, v_sha, rtgip.delivery_identity(v_conn, e))
  ON CONFLICT (event_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES ('outbox', 'enqueued', v_id, jsonb_build_object('connection_id', v_conn));
    RETURN 'enqueued';
  END IF;
  SELECT body_sha256 INTO v_prior FROM rtgip.outbox WHERE event_id = v_id;
  IF v_prior <> v_sha THEN RAISE EXCEPTION 'event_id_conflict' USING ERRCODE = 'unique_violation'; END IF;
  RETURN 'duplicate';
END $$;

-- Lease due rows. SKIP LOCKED lets concurrent workers partition the queue. A pending or
-- retry_wait row is leased for delivery (lease_action 'deliver', state in_flight); a due
-- gateway_admitted row is leased for confirmation (lease_action 'confirm', state unchanged).
-- Every claim increments lease_generation, the fencing token outbox_advance and outbox_fail
-- require. A row whose lease expired is re-leased as a new attempt. A row whose connection is
-- not deliverable right now (suspended, revoked, a side disabled, grant narrowed) stays
-- paused: it is not leased and spends no attempt.
CREATE OR REPLACE FUNCTION rtgip.outbox_claim(p_worker text, p_limit integer, p_lease_seconds integer)
RETURNS SETOF rtgip.outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_worker IS NULL OR p_worker = '' OR p_lease_seconds NOT BETWEEN 1 AND 3600 OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_claim';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT o.event_id, (o.state = 'gateway_admitted') AS is_confirm FROM rtgip.outbox o
    WHERE ((o.state IN ('pending','retry_wait') AND o.next_attempt_at <= now())
        OR (o.state = 'in_flight' AND o.lease_until <= now())
        OR (o.state = 'gateway_admitted' AND o.next_attempt_at <= now() AND (o.lease_owner IS NULL OR o.lease_until <= now())))
      AND rtgip.deliverable_reason(o.connection_id, o.envelope) IS NULL
    ORDER BY o.next_attempt_at, o.event_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE rtgip.outbox o SET
    state = CASE WHEN due.is_confirm THEN o.state ELSE 'in_flight' END,
    lease_owner = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds),
    lease_generation = o.lease_generation + 1,
    lease_action = CASE WHEN due.is_confirm THEN 'confirm' ELSE 'deliver' END,
    attempts = o.attempts + 1, attempt_started_at = now()
  FROM due WHERE o.event_id = due.event_id
  RETURNING o.*;
END $$;

-- Verify one signed receipt's key and MAC (receiptDraft/verifyReceiptV2 in rtgip2/receipt-v2.ts):
-- the key is registered, owned by the issuer, of dialect rtgip/2, not revoked, valid now and at
-- issued_at and bound to the connection; the receipt is not from the future; the HMAC over
-- 'rtgip/2-receipt/2' || LF || canonical(unsigned) matches the issuer's Vault secret.
CREATE OR REPLACE FUNCTION rtgip.receipt_check_signature(r jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k rtgip.signing_keys%ROWTYPE; v_now timestamptz := rtgip.clock(); v_iat timestamptz := to_timestamp((r->>'issued_at')::bigint);
  v_secret text; v_mac text;
BEGIN
  SELECT * INTO k FROM rtgip.signing_keys WHERE key_id = r->>'key_id';
  IF NOT FOUND OR k.owner <> r->>'issuer' OR k.dialect <> 'rtgip/2' OR k.status = 'revoked'
     OR v_now < k.not_before OR v_now > k.not_after OR v_iat < k.not_before OR v_iat > k.not_after
     OR NOT ((r->>'connection_id') = ANY (k.connection_ids)) THEN
    RAISE EXCEPTION 'ack_key_not_authorized';
  END IF;
  IF v_iat > v_now + interval '300 seconds' THEN RAISE EXCEPTION 'ack_future_receipt'; END IF;
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = k.secret_ref;
  IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'ack_key_secret_unavailable'; END IF;
  v_mac := encode(extensions.hmac(convert_to('rtgip/2-receipt/2' || chr(10) || rtgip.receipt_canonical(r - 'signature'), 'UTF8'),
                                  convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  IF r->>'signature' !~ '^[0-9a-f]{64}$' OR NOT rtgip.ct_equal(v_mac, r->>'signature') THEN RAISE EXCEPTION 'ack_bad_signature'; END IF;
END $$;

-- verifyReceiptV2() in rtgip2/receipt-v2.ts, one link of a chain. p_text is the canonical JSON
-- text of the signed receipt, p_prev the text of the receipt before it (NULL for the first),
-- already verified by the caller. Checks, in order: (a) exact v2 field set and value types;
-- (b) the text is the canonical text; the stage; every bound field against the envelope, the
-- pinned connection and the delivery identity, with issuer and recipient from the stage table;
-- that the connection still authorizes the event; (d, e) the key and the MAC; (f) the link to
-- the previous receipt by digest; (g) stage order, time not reversed, and a commit only after an
-- applied, stale_ignored or duplicate inbox receipt. Raises the same ack_* reasons as TypeScript.
CREATE OR REPLACE FUNCTION rtgip.receipt_verify(p_text text, p_prev text, p_envelope jsonb, p_connection text, p_delivery_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb; prev jsonb; f text; v_kind text; v_out text; v_issuer text; v_recipient text; v_required text;
  fields constant text[] := ARRAY['connection_id','delivery_id','envelope_sha256','event_id','issued_at','issuer','key_id','kind','outcome',
    'payload_sha256','prev_receipt_sha256','protocol','receipt_version','recipient','rooftop_id','route','signature','source_app','target_app','tenant_id'];
  strs constant text[] := ARRAY['protocol','kind','event_id','route','source_app','target_app','tenant_id','rooftop_id','connection_id',
    'payload_sha256','envelope_sha256','delivery_id','issuer','recipient','outcome','key_id','signature'];
  bound constant text[] := ARRAY['event_id','route','source_app','target_app','tenant_id','rooftop_id','connection_id','payload_sha256',
    'envelope_sha256','delivery_id','issuer','recipient'];
  want jsonb;
BEGIN
  BEGIN r := p_text::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'ack_unsupported_version_or_shape'; END;
  IF jsonb_typeof(r) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(r) x) IS DISTINCT FROM fields THEN
    RAISE EXCEPTION 'ack_unsupported_version_or_shape';
  END IF;
  FOREACH f IN ARRAY strs LOOP
    IF jsonb_typeof(r->f) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'ack_unsupported_version_or_shape'; END IF;
  END LOOP;
  v_kind := r->>'kind'; v_out := r->>'outcome';
  IF r->>'protocol' <> 'rtgip/2-receipt/2' OR r->'receipt_version' IS DISTINCT FROM '2'::jsonb
     OR jsonb_typeof(r->'issued_at') IS DISTINCT FROM 'number' OR (r->'issued_at')::text !~ '^(0|[1-9][0-9]{0,15})$'
     OR r->>'payload_sha256' !~ '^[0-9a-f]{64}$' OR r->>'envelope_sha256' !~ '^[0-9a-f]{64}$'
     OR r->>'delivery_id' !~ '^[0-9a-f]{64}$' OR r->>'signature' !~ '^[0-9a-f]{64}$'
     OR NOT (jsonb_typeof(r->'prev_receipt_sha256') = 'null' OR (jsonb_typeof(r->'prev_receipt_sha256') = 'string' AND r->>'prev_receipt_sha256' ~ '^[0-9a-f]{64}$'))
     OR NOT ((v_kind = 'gateway_admission' AND v_out = 'admitted')
          OR (v_kind = 'target_inbox' AND v_out IN ('applied','duplicate','stale_ignored','held','quarantined'))
          OR (v_kind = 'consumer_commit' AND v_out IN ('applied','stale_ignored'))) THEN
    RAISE EXCEPTION 'ack_unsupported_version_or_shape';
  END IF;
  IF p_text <> rtgip.receipt_canonical(r) THEN RAISE EXCEPTION 'ack_not_canonical'; END IF;

  v_issuer := CASE WHEN v_kind = 'gateway_admission' THEN 'gateway' ELSE p_envelope->>'target_app' END;
  v_recipient := CASE WHEN v_kind = 'gateway_admission' THEN p_envelope->>'source_app' ELSE 'gateway' END;
  want := jsonb_build_object('event_id', p_envelope->>'event_id', 'route', p_envelope->>'route', 'source_app', p_envelope->>'source_app',
    'target_app', p_envelope->>'target_app', 'tenant_id', p_envelope->>'tenant_id', 'rooftop_id', p_envelope->>'rooftop_id',
    'connection_id', p_connection, 'payload_sha256', p_envelope->>'payload_sha256', 'envelope_sha256', rtgip.envelope_sha(p_envelope),
    'delivery_id', p_delivery_id, 'issuer', v_issuer, 'recipient', v_recipient);
  FOREACH f IN ARRAY bound LOOP
    IF r->>f IS DISTINCT FROM want->>f THEN RAISE EXCEPTION 'ack_wrong_%', f; END IF;
  END LOOP;
  IF rtgip.deliverable_reason(p_connection, p_envelope) IS NOT NULL THEN RAISE EXCEPTION 'ack_connection_not_authorized'; END IF;
  PERFORM rtgip.receipt_check_signature(r);

  IF v_kind = 'gateway_admission' THEN
    IF jsonb_typeof(r->'prev_receipt_sha256') <> 'null' OR p_prev IS NOT NULL THEN RAISE EXCEPTION 'ack_unexpected_previous_stage'; END IF;
  ELSE
    v_required := CASE v_kind WHEN 'target_inbox' THEN 'gateway_admission' ELSE 'target_inbox' END;
    IF p_prev IS NULL THEN RAISE EXCEPTION 'ack_missing_previous_stage'; END IF;
    prev := p_prev::jsonb;
    IF prev->>'kind' IS DISTINCT FROM v_required
       OR r->>'prev_receipt_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(p_prev, 'UTF8'), 'sha256'), 'hex') THEN
      RAISE EXCEPTION 'ack_missing_previous_stage';
    END IF;
    IF (r->>'issued_at')::bigint < (prev->>'issued_at')::bigint THEN RAISE EXCEPTION 'ack_stage_time_reversed'; END IF;
    IF v_kind = 'consumer_commit' AND (prev->>'outcome' IN ('held','quarantined')
       OR (prev->>'outcome' <> 'duplicate' AND prev->>'outcome' <> v_out)) THEN
      RAISE EXCEPTION 'ack_commit_without_effect';
    END IF;
  END IF;
  RETURN r;
END $$;

-- Advance under the lease generation the caller holds, on receipts this function verifies
-- itself, each element the canonical JSON text of one signed receipt in chain order.
--   deliver lease (state in_flight): exactly one gateway_admission receipt; the row becomes
--     gateway_admitted, the lease is released and the next attempt is due after RETRY.baseSec (5 s).
--   confirm lease (state gateway_admitted): the chain fetched by receipt query; its first element
--     must equal the stored admission byte for byte (ack_admission_mismatch), every element must
--     verify with its ancestors. [adm, inbox, commit] -> consumer_committed;
--     [adm, inbox quarantined] -> target_quarantined.
-- Returns the new state, 'pending:<reason>' for a chain that verifies but is not complete yet
-- (the worker then calls outbox_fail, which backs off and dead-letters only on attempts), or
-- 'rejected:<reason>' (nothing changes except an audit entry; the worker calls outbox_fail).
-- A generation, owner or action that is not the row's current lease raises lost_lease and
-- changes nothing.
DROP FUNCTION IF EXISTS rtgip.outbox_advance(uuid, text, text, text);
CREATE OR REPLACE FUNCTION rtgip.outbox_advance(p_event_id uuid, p_worker text, p_generation integer, p_receipts text[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o rtgip.outbox%ROWTYPE; r jsonb; i integer; n integer; v_prev text; v_to text; v_all jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO o FROM rtgip.outbox WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_event'; END IF;
  IF o.lease_owner IS DISTINCT FROM p_worker OR o.lease_generation IS DISTINCT FROM p_generation OR o.lease_action IS NULL
     OR o.state NOT IN ('in_flight','gateway_admitted') THEN
    RAISE EXCEPTION 'lost_lease';
  END IF;
  BEGIN
    n := coalesce(cardinality(p_receipts), 0);
    IF n = 0 THEN RAISE EXCEPTION 'ack_missing'; END IF;
    IF n > 3 THEN RAISE EXCEPTION 'ack_chain_too_long'; END IF;
    IF o.lease_action = 'deliver' AND n <> 1 THEN RAISE EXCEPTION 'illegal_transition:%:chain', o.state; END IF;
    IF o.lease_action = 'confirm' AND (jsonb_array_length(o.receipts) < 1
       OR rtgip.receipt_canonical(o.receipts->0) IS DISTINCT FROM p_receipts[1]) THEN
      RAISE EXCEPTION 'ack_admission_mismatch';
    END IF;
    IF o.lease_action = 'deliver' AND jsonb_array_length(o.receipts) > 0
       AND rtgip.receipt_canonical(o.receipts->0) IS DISTINCT FROM p_receipts[1] THEN
      RAISE EXCEPTION 'ack_admission_mismatch';
    END IF;
    FOR i IN 1 .. n LOOP
      r := rtgip.receipt_verify(p_receipts[i], v_prev, o.envelope, o.connection_id, o.delivery_id);
      v_prev := p_receipts[i];
      v_all := v_all || jsonb_build_array(r);
    END LOOP;

    IF o.lease_action = 'deliver' THEN
      IF v_all->0->>'kind' <> 'gateway_admission' THEN RAISE EXCEPTION 'ack_wrong_stage'; END IF;
      INSERT INTO rtgip.receipts (event_id, attempt, kind, issuer, outcome, key_id, signing_text, signature)
      VALUES (o.event_id, o.attempts, 'gateway_admission', v_all->0->>'issuer', 'admitted', v_all->0->>'key_id',
              rtgip.receipt_canonical((v_all->0) - 'signature'), v_all->0->>'signature')
      ON CONFLICT DO NOTHING;
      UPDATE rtgip.outbox SET state = 'gateway_admitted', receipts = v_all, last_error = NULL,
        lease_owner = NULL, lease_until = NULL, lease_action = NULL, next_attempt_at = now() + interval '5 seconds'
      WHERE event_id = o.event_id;
      v_to := 'gateway_admitted';
    ELSE
      IF n = 1 THEN RETURN 'pending:target_inbox_pending'; END IF;
      IF v_all->1->>'outcome' = 'held' THEN RETURN 'pending:target_held_awaiting_predecessor'; END IF;
      IF n = 2 AND v_all->1->>'outcome' <> 'quarantined' THEN RETURN 'pending:consumer_commit_pending'; END IF;
      v_to := CASE WHEN v_all->1->>'outcome' = 'quarantined' THEN 'target_quarantined' ELSE 'consumer_committed' END;
      FOR i IN 2 .. n LOOP
        INSERT INTO rtgip.receipts (event_id, attempt, kind, issuer, outcome, key_id, signing_text, signature)
        VALUES (o.event_id, o.attempts, v_all->(i-1)->>'kind', v_all->(i-1)->>'issuer', v_all->(i-1)->>'outcome', v_all->(i-1)->>'key_id',
                rtgip.receipt_canonical((v_all->(i-1)) - 'signature'), v_all->(i-1)->>'signature')
        ON CONFLICT DO NOTHING;
      END LOOP;
      UPDATE rtgip.outbox SET state = v_to, receipts = v_all, last_error = NULL,
        lease_owner = NULL, lease_until = NULL, lease_action = NULL
      WHERE event_id = o.event_id;
    END IF;
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES (p_worker, 'advance:' || v_to, o.event_id, jsonb_build_object('receipts', n, 'attempt', o.attempts, 'generation', p_generation));
    RETURN v_to;
  EXCEPTION WHEN raise_exception OR invalid_text_representation THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES (coalesce(p_worker, '?'), 'receipt_rejected', p_event_id, jsonb_build_object('reason', SQLERRM, 'generation', p_generation));
    RETURN 'rejected:' || SQLERRM;
  END;
END $$;

-- A failure under the lease generation the caller holds. While the connection is not
-- deliverable it is a pause: the attempt is given back and the row cannot dead-letter until the
-- grant returns (same rule as MemoryOutbox). Otherwise the row backs off (jittered exponential,
-- 5 s base, 900 s cap, as backoffSeconds() in rtgip2/delivery.ts, or p_backoff_seconds when
-- given) and dead-letters once attempts reach p_max_attempts. A delivery failure returns the row
-- to retry_wait; a failed confirmation leaves it gateway_admitted. A generation, owner or lease
-- that is not the row's current one raises lost_lease and changes nothing.
DROP FUNCTION IF EXISTS rtgip.outbox_fail(uuid, text, text, integer, integer);
CREATE OR REPLACE FUNCTION rtgip.outbox_fail(p_event_id uuid, p_worker text, p_generation integer, p_reason text,
                                             p_backoff_seconds integer DEFAULT NULL, p_max_attempts integer DEFAULT 10)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o rtgip.outbox%ROWTYPE; v_why text; v_state text; v_ceiling numeric; v_backoff integer;
BEGIN
  SELECT * INTO o FROM rtgip.outbox WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_event'; END IF;
  IF o.lease_owner IS DISTINCT FROM p_worker OR o.lease_generation IS DISTINCT FROM p_generation OR o.lease_action IS NULL
     OR o.state NOT IN ('in_flight','gateway_admitted') THEN
    RAISE EXCEPTION 'lost_lease';
  END IF;
  v_why := rtgip.deliverable_reason(o.connection_id, o.envelope);
  v_ceiling := least(900, 5 * power(2, greatest(0, o.attempts - 1)));
  v_backoff := coalesce(p_backoff_seconds, greatest(1, floor(v_ceiling / 2 + random() * v_ceiling / 2))::integer);
  UPDATE rtgip.outbox SET
    state = CASE WHEN v_why IS NULL AND attempts >= p_max_attempts THEN 'dead_letter'
                 WHEN o.state = 'gateway_admitted' THEN 'gateway_admitted' ELSE 'retry_wait' END,
    attempts = CASE WHEN v_why IS NULL THEN attempts ELSE greatest(0, attempts - 1) END,
    next_attempt_at = now() + make_interval(secs => greatest(1, CASE WHEN v_why IS NULL THEN v_backoff ELSE 5 END)),
    lease_owner = NULL, lease_until = NULL, lease_action = NULL, last_error = left(p_reason, 200)
  WHERE event_id = p_event_id
  RETURNING state INTO v_state;
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES (p_worker, CASE WHEN v_why IS NULL THEN 'fail:' ELSE 'pause:' END || v_state, p_event_id,
          jsonb_build_object('reason', left(p_reason, 200), 'paused_by', v_why, 'generation', p_generation));
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
  v_fx jsonb;
  v_fx_reason text;
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

  -- The consumer effect runs here, in this transaction. A refusal quarantines the event with
  -- the effect's reason and leaves the watermark where it was; an error rolls everything back.
  v_fx := rtgip.consumer_effect(p_envelope);
  IF jsonb_typeof(v_fx) IS DISTINCT FROM 'object' OR v_fx->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    v_fx_reason := left(coalesce(CASE WHEN jsonb_typeof(v_fx) = 'object' THEN v_fx->>'reason' END, 'consumer_reject'), 200);
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'quarantined', v_fx_reason, p_envelope, now(), NULL);
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES ('inbox', 'quarantined', v_id, jsonb_build_object('reason', v_fx_reason));
    RETURN QUERY SELECT v_id, 'quarantined'::text, v_fx_reason, false, NULL::text, p_envelope;
    RETURN;
  END IF;
  INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'applied',
    CASE WHEN v_fx->'duplicate' = 'true'::jsonb THEN 'effect_duplicate' WHEN v_fx->'review' = 'true'::jsonb THEN 'effect_review' END,
    p_envelope, now(), now());
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
      UPDATE rtgip.inbox_deliveries x SET outcome = 'quarantined', commit_outcome = NULL, reason = v_rej WHERE x.delivery_id = v_next.delivery_id;
      RETURN QUERY SELECT v_next.event_id, 'quarantined'::text, v_rej, false, NULL::text, v_next.envelope;
      EXIT;
    END IF;
    v_fx := rtgip.consumer_effect(v_next.envelope);
    IF jsonb_typeof(v_fx) IS DISTINCT FROM 'object' OR v_fx->'ok' IS DISTINCT FROM 'true'::jsonb THEN
      v_fx_reason := left(coalesce(CASE WHEN jsonb_typeof(v_fx) = 'object' THEN v_fx->>'reason' END, 'consumer_reject'), 200);
      UPDATE rtgip.inbox i SET outcome = 'quarantined', reason = v_fx_reason
        WHERE i.tenant_id = v_next.tenant_id AND i.origin_app = v_next.origin_app AND i.event_id = v_next.event_id;
      INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES ('inbox', 'quarantined', v_next.event_id, jsonb_build_object('reason', v_fx_reason));
      UPDATE rtgip.inbox_deliveries x SET outcome = 'quarantined', commit_outcome = NULL, reason = v_fx_reason WHERE x.delivery_id = v_next.delivery_id;
      RETURN QUERY SELECT v_next.event_id, 'quarantined'::text, v_fx_reason, false, NULL::text, v_next.envelope;
      EXIT;
    END IF;
    UPDATE rtgip.inbox i SET outcome = 'applied', reason = NULL, committed_at = now()
      WHERE i.tenant_id = v_next.tenant_id AND i.origin_app = v_next.origin_app AND i.event_id = v_next.event_id;
    v_rev := v_next.revision;
    UPDATE rtgip.inbox_deliveries x SET outcome = 'applied', commit_outcome = 'applied', reason = 'released_from_hold' WHERE x.delivery_id = v_next.delivery_id;
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
-- p_admission is the Gateway's admission receipt (canonical JSON text, from the
-- rtgip-admission-receipt header). It is verified here against the delivery (receipt_verify,
-- delivery identity from the pinned connection) and its digest is stored with the delivery.
-- The first returned row also carries the delivery_id, the stored issued_at every receipt for
-- this delivery uses, and the receipts already stored for it (NULL until inbox_record_receipts).
-- A delivery whose decision is already final returns that decision without running the engine
-- (replayed = true): the caller must not run the app effect again for it.
-- p_consumer_reject {"event_id", "reason"} is the second pass after the caller rolled back
-- to a savepoint because a consumer effect failed: the same delivery is verified again from
-- scratch and that event is recorded as quarantined. It must name an event this delivery
-- actually reaches, or the call raises.
DROP FUNCTION IF EXISTS rtgip.inbox_admit(jsonb, text, jsonb);
DROP FUNCTION IF EXISTS rtgip.inbox_admit(jsonb, text, text, jsonb);
CREATE OR REPLACE FUNCTION rtgip.inbox_admit(p_headers jsonb, p_body text, p_admission text, p_consumer_reject jsonb DEFAULT NULL)
RETURNS TABLE (admission_id bigint, event_id uuid, outcome text, reason text, committed boolean, committed_outcome text, connection_id text, envelope jsonb,
               delivery_id text, issued_at bigint, stored_receipts text[], replayed boolean)
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
  v_did text; v_adig text; v_issued bigint; d rtgip.inbox_deliveries%ROWTYPE; v_have_d boolean := false; v_is_first boolean := true;
  v_first_commit text; v_first_reason text;
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
    RETURN QUERY SELECT NULL::bigint, NULL::uuid, 'rejected'::text, SQLERRM::text, false, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::bigint, NULL::text[], false;
    RETURN;
  END;

  v_claim := rtgip.claim_nonce(h_key, h_nonce, v_sha, to_timestamp(h_ts::bigint + 900));
  IF v_claim = 'conflict' THEN
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('inbox', 'admission_rejected', jsonb_build_object('stage', 'nonce', 'reason', 'nonce_reused', 'key_id', h_key));
    RETURN QUERY SELECT NULL::bigint, NULL::uuid, 'rejected'::text, 'nonce_reused'::text, false, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::bigint, NULL::text[], false;
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
      WHERE c.source_app = e->>'source_app' AND c.target_app = e->>'target_app' AND c.tenant_id = e->>'tenant_id' AND c.status = 'active'
        AND (e->>'rooftop_id') = ANY (c.rooftop_ids);
    IF v_n = 0 THEN
      IF NOT EXISTS (SELECT 1 FROM rtgip.connections c WHERE c.source_app = e->>'source_app' AND c.target_app = e->>'target_app' AND c.tenant_id = e->>'tenant_id') THEN
        RAISE EXCEPTION 'no_connection_for_tenant';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM rtgip.connections c WHERE c.source_app = e->>'source_app' AND c.target_app = e->>'target_app' AND c.tenant_id = e->>'tenant_id' AND c.status = 'active') THEN
        RAISE EXCEPTION 'connection_revoked';
      END IF;
      RAISE EXCEPTION 'rooftop_not_granted';
    END IF;
    IF v_n > 1 THEN RAISE EXCEPTION 'ambiguous_connection'; END IF;
    v_why := rtgip.deliverable_reason(v_conn, e);
    IF v_why = 'connection_mismatch' THEN RAISE EXCEPTION 'rooftop_not_granted'; END IF;
    IF v_why IS NOT NULL THEN RAISE EXCEPTION '%', v_why; END IF;
    IF NOT (v_conn = ANY (k.connection_ids)) THEN RAISE EXCEPTION 'key_not_bound_to_connection'; END IF;
    IF p_admission IS NULL THEN RAISE EXCEPTION 'ack_missing'; END IF;
    v_did := rtgip.delivery_identity(v_conn, e);
    PERFORM rtgip.receipt_verify(p_admission, NULL, e, v_conn, v_did);
    IF p_admission::jsonb->>'kind' <> 'gateway_admission' THEN RAISE EXCEPTION 'ack_wrong_stage'; END IF;
    v_adig := encode(extensions.digest(convert_to(p_admission, 'UTF8'), 'sha256'), 'hex');
    SELECT * INTO d FROM rtgip.inbox_deliveries x WHERE x.delivery_id = v_did;
    v_have_d := FOUND;
    IF v_have_d AND d.admission_digest <> v_adig THEN RAISE EXCEPTION 'admission_digest_mismatch'; END IF;
    IF p_consumer_reject IS NOT NULL THEN
      BEGIN v_rej_event := (p_consumer_reject->>'event_id')::uuid; EXCEPTION WHEN others THEN v_rej_event := NULL; END;
      v_rej_reason := left(p_consumer_reject->>'reason', 180);
      IF v_rej_event IS NULL OR v_rej_reason IS NULL OR v_rej_reason = '' THEN RAISE EXCEPTION 'invalid_consumer_reject'; END IF;
    END IF;
  EXCEPTION WHEN raise_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('inbox', 'admission_rejected', jsonb_build_object('stage', 'envelope', 'reason', SQLERRM, 'key_id', h_key, 'body_sha256', v_sha));
    RETURN QUERY SELECT NULL::bigint, NULL::uuid, 'rejected'::text, SQLERRM::text, false, NULL::text, NULL::text, NULL::jsonb, NULL::text, NULL::bigint, NULL::text[], false;
    RETURN;
  END;

  v_adm := nextval(pg_get_serial_sequence('rtgip.admissions', 'id'));
  IF v_have_d AND d.outcome <> 'held' THEN
    -- The decision for this delivery is final: answer with it, stored receipts included.
    admission_id := v_adm; event_id := (e->>'event_id')::uuid; outcome := d.outcome; reason := d.reason;
    committed := d.commit_outcome IS NOT NULL; committed_outcome := d.commit_outcome; connection_id := v_conn; envelope := e;
    delivery_id := v_did; issued_at := d.issued_at; stored_receipts := d.receipts; replayed := true;
    RETURN NEXT;
    INSERT INTO rtgip.admissions (id, key_id, nonce, body_sha256, event_id, connection_id, signer, outcome, consumer_reject)
    VALUES (v_adm, h_key, h_nonce, v_sha, (e->>'event_id')::uuid, v_conn, h_signer, d.outcome, NULL);
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES ('inbox', 'admitted:' || d.outcome, (e->>'event_id')::uuid,
            jsonb_build_object('admission_id', v_adm, 'connection_id', v_conn, 'key_id', h_key, 'nonce_claim', v_claim, 'delivery_id', v_did, 'stored', true));
    RETURN;
  END IF;
  v_issued := CASE WHEN v_have_d THEN d.issued_at ELSE floor(extract(epoch FROM now()))::bigint END;
  FOR rec IN SELECT * FROM rtgip.inbox_receive(e, v_local, v_rej_event, CASE WHEN v_rej_reason IS NOT NULL THEN 'consumer_reject:' || v_rej_reason END) LOOP
    v_first := coalesce(v_first, rec.outcome);
    IF v_is_first THEN v_first_commit := rec.committed_outcome; v_first_reason := rec.reason; END IF;
    IF rec.event_id = v_rej_event AND rec.outcome = 'quarantined' THEN v_rej_seen := true; END IF;
    admission_id := v_adm; event_id := rec.event_id; outcome := rec.outcome; reason := rec.reason;
    committed := rec.committed; committed_outcome := rec.committed_outcome; connection_id := v_conn; envelope := rec.envelope;
    delivery_id := CASE WHEN v_is_first THEN v_did END; issued_at := CASE WHEN v_is_first THEN v_issued END; stored_receipts := NULL; replayed := false;
    v_is_first := false;
    RETURN NEXT;
  END LOOP;
  IF v_rej_event IS NOT NULL AND NOT v_rej_seen THEN RAISE EXCEPTION 'consumer_reject_not_applicable'; END IF;
  INSERT INTO rtgip.inbox_deliveries (delivery_id, tenant_id, origin_app, event_id, connection_id, admission_digest, issued_at, outcome, commit_outcome, reason, envelope)
  VALUES (v_did, e->>'tenant_id', e#>>'{origin,app}', (e->>'event_id')::uuid, v_conn, v_adig, v_issued, v_first, v_first_commit, v_first_reason, e)
  ON CONFLICT (delivery_id) DO UPDATE SET outcome = EXCLUDED.outcome, commit_outcome = EXCLUDED.commit_outcome, reason = EXCLUDED.reason;
  UPDATE rtgip.inbox i SET delivery_id = v_did, admission_digest = v_adig, issued_at = v_issued
    WHERE i.tenant_id = e->>'tenant_id' AND i.origin_app = e#>>'{origin,app}' AND i.event_id = (e->>'event_id')::uuid AND i.delivery_id IS NULL;
  INSERT INTO rtgip.admissions (id, key_id, nonce, body_sha256, event_id, connection_id, signer, outcome, consumer_reject)
  VALUES (v_adm, h_key, h_nonce, v_sha, (e->>'event_id')::uuid, v_conn, h_signer, v_first, v_rej_reason);
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES ('inbox', 'admitted:' || v_first, (e->>'event_id')::uuid,
          jsonb_build_object('admission_id', v_adm, 'connection_id', v_conn, 'key_id', h_key, 'nonce_claim', v_claim, 'delivery_id', v_did));
END $$;

-- Persist the receipts the endpoint signed for one delivery (p_key is its delivery_id), after the
-- decision committed. Each element is the canonical JSON text of one signed receipt: the
-- target_inbox receipt, then the consumer_commit receipt exactly when the decision committed.
-- Every receipt must verify (shape, canonical text, bound fields from the stored envelope, the
-- target's key and MAC) and chain from the stored admission digest. Idempotent for identical
-- texts; different bytes for a delivery that already has receipts raise receipts_conflict. A held
-- decision is not final and takes no receipts.
CREATE OR REPLACE FUNCTION rtgip.inbox_record_receipts(p_key text, p_receipts text[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d rtgip.inbox_deliveries%ROWTYPE; r jsonb; i integer; n integer; v_want integer;
  v_prev_digest text; v_prev_text text; v_kind text; v_outcome text;
BEGIN
  SELECT * INTO d FROM rtgip.inbox_deliveries x WHERE x.delivery_id = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_delivery'; END IF;
  IF d.outcome = 'held' THEN RAISE EXCEPTION 'decision_not_final'; END IF;
  n := coalesce(cardinality(p_receipts), 0);
  v_want := CASE WHEN d.commit_outcome IS NULL THEN 1 ELSE 2 END;
  IF n <> v_want THEN RAISE EXCEPTION 'receipts_wrong_count'; END IF;
  IF d.receipts IS NOT NULL THEN
    IF d.receipts = p_receipts THEN RETURN 'stored'; END IF;
    RAISE EXCEPTION 'receipts_conflict';
  END IF;
  v_prev_digest := d.admission_digest;
  FOR i IN 1 .. n LOOP
    BEGIN r := p_receipts[i]::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'ack_unsupported_version_or_shape'; END;
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR p_receipts[i] <> rtgip.receipt_canonical(r) THEN RAISE EXCEPTION 'ack_not_canonical'; END IF;
    v_kind := CASE i WHEN 1 THEN 'target_inbox' ELSE 'consumer_commit' END;
    v_outcome := CASE i WHEN 1 THEN d.outcome ELSE d.commit_outcome END;
    IF r->>'kind' IS DISTINCT FROM v_kind OR r->>'outcome' IS DISTINCT FROM v_outcome
       OR r->>'delivery_id' IS DISTINCT FROM d.delivery_id OR r->>'event_id' IS DISTINCT FROM d.event_id::text
       OR r->>'connection_id' IS DISTINCT FROM d.connection_id OR r->>'issuer' IS DISTINCT FROM d.envelope->>'target_app'
       OR r->>'recipient' IS DISTINCT FROM 'gateway' OR r->>'envelope_sha256' IS DISTINCT FROM rtgip.envelope_sha(d.envelope)
       OR r->>'payload_sha256' IS DISTINCT FROM d.envelope->>'payload_sha256'
       OR r->>'tenant_id' IS DISTINCT FROM d.envelope->>'tenant_id' OR r->>'rooftop_id' IS DISTINCT FROM d.envelope->>'rooftop_id'
       OR r->>'route' IS DISTINCT FROM d.envelope->>'route' OR r->>'source_app' IS DISTINCT FROM d.envelope->>'source_app'
       OR r->>'target_app' IS DISTINCT FROM d.envelope->>'target_app'
       OR (r->>'issued_at') IS DISTINCT FROM d.issued_at::text THEN
      RAISE EXCEPTION 'receipt_not_bound_to_delivery';
    END IF;
    IF r->>'prev_receipt_sha256' IS DISTINCT FROM v_prev_digest THEN RAISE EXCEPTION 'ack_missing_previous_stage'; END IF;
    PERFORM rtgip.receipt_check_signature(r);
    v_prev_digest := encode(extensions.digest(convert_to(p_receipts[i], 'UTF8'), 'sha256'), 'hex');
  END LOOP;
  UPDATE rtgip.inbox_deliveries SET receipts = p_receipts WHERE delivery_id = p_key;
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES ('inbox', 'receipts_stored', d.event_id, jsonb_build_object('delivery_id', d.delivery_id, 'count', n));
  RETURN 'recorded';
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
                           'admissions','event_catalog','forbidden_keys','watermarks','audit_log','inbox_deliveries'] LOOP
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
GRANT EXECUTE ON FUNCTION rtgip.outbox_advance(uuid, text, integer, text[]) TO rtgip_dispatcher;
GRANT EXECUTE ON FUNCTION rtgip.outbox_fail(uuid, text, integer, text, integer, integer) TO rtgip_dispatcher;
GRANT EXECUTE ON FUNCTION rtgip.inbox_admit(jsonb, text, text, jsonb) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.inbox_record_receipts(text, text[]) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.purge_expired_nonces() TO rtgip_operator;
GRANT EXECUTE ON FUNCTION rtgip.outbox_redrive(uuid, text, text) TO rtgip_operator;
GRANT SELECT ON rtgip.connections, rtgip.signing_keys, rtgip.outbox, rtgip.receipts, rtgip.inbox, rtgip.inbox_deliveries,
  rtgip.inbox_conflicts, rtgip.admissions, rtgip.watermarks, rtgip.audit_log TO rtgip_operator;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections','signing_keys','outbox','receipts','inbox','inbox_deliveries','inbox_conflicts','admissions','watermarks','audit_log'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rtgip' AND tablename = t AND policyname = 'operator_read') THEN
      EXECUTE format('CREATE POLICY operator_read ON rtgip.%I FOR SELECT TO rtgip_operator USING (true)', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
