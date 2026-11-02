-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- rtgip/2 durable delivery ledger: service identity, nonce claims, outbox, receipts,
-- inbox, per-aggregate watermarks and an append-only audit log.
-- Shared byte-for-byte by AutoLabels and AutoCurb. Idempotent. External transport is
-- pinned OFF by a CHECK constraint; turning it on requires a reviewed schema change.

CREATE SCHEMA IF NOT EXISTS rtgip;
REVOKE ALL ON SCHEMA rtgip FROM PUBLIC;

CREATE TABLE IF NOT EXISTS rtgip.delivery_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  transport_enabled boolean NOT NULL DEFAULT false CHECK (transport_enabled = false),
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

-- Secrets are never stored here: secret_ref names a server-side vault entry.
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
  envelope jsonb NOT NULL,
  body text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending','in_flight','retry_wait','gateway_admitted','target_persisted',
    'consumer_committed','target_quarantined','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON rtgip.outbox (next_attempt_at) WHERE state IN ('pending','retry_wait','in_flight');

CREATE TABLE IF NOT EXISTS rtgip.receipts (
  event_id uuid NOT NULL REFERENCES rtgip.outbox(event_id),
  kind text NOT NULL CHECK (kind IN ('gateway_admission','target_inbox','consumer_commit')),
  issuer text NOT NULL,
  outcome text NOT NULL,
  receipt jsonb NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, kind)
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

-- Nonce claim: 'claimed' | 'exact_retry' | 'conflict'. Safe under concurrent sessions.
CREATE OR REPLACE FUNCTION rtgip.claim_nonce(p_key_id text, p_nonce text, p_sha text, p_expires_at timestamptz)
RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_sha text;
BEGIN
  INSERT INTO rtgip.nonce_claims (key_id, nonce, body_sha256, expires_at)
  VALUES (p_key_id, p_nonce, p_sha, p_expires_at)
  ON CONFLICT (key_id, nonce) DO NOTHING;
  IF FOUND THEN RETURN 'claimed'; END IF;
  SELECT body_sha256 INTO v_sha FROM rtgip.nonce_claims WHERE key_id = p_key_id AND nonce = p_nonce;
  RETURN CASE WHEN v_sha = p_sha THEN 'exact_retry' ELSE 'conflict' END;
END $$;

-- Enqueue inside the caller's business transaction. Identical bytes are a no-op.
CREATE OR REPLACE FUNCTION rtgip.outbox_enqueue(p_envelope jsonb, p_body text, p_sha text)
RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_id uuid := (p_envelope->>'event_id')::uuid; v_sha text;
BEGIN
  INSERT INTO rtgip.outbox (event_id, route, tenant_id, envelope, body, body_sha256)
  VALUES (v_id, p_envelope->>'route', p_envelope->>'tenant_id', p_envelope, p_body, p_sha)
  ON CONFLICT (event_id) DO NOTHING;
  IF FOUND THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id) VALUES ('outbox', 'enqueued', v_id);
    RETURN 'enqueued';
  END IF;
  SELECT body_sha256 INTO v_sha FROM rtgip.outbox WHERE event_id = v_id;
  IF v_sha <> p_sha THEN RAISE EXCEPTION 'event_id_conflict' USING ERRCODE = 'unique_violation'; END IF;
  RETURN 'duplicate';
END $$;

-- Lease due rows. SKIP LOCKED lets concurrent workers partition the queue.
CREATE OR REPLACE FUNCTION rtgip.outbox_claim(p_worker text, p_limit integer, p_lease_seconds integer)
RETURNS SETOF rtgip.outbox LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.event_id FROM rtgip.outbox o
    WHERE (o.state IN ('pending','retry_wait') AND o.next_attempt_at <= now())
       OR (o.state = 'in_flight' AND o.lease_until <= now())
    ORDER BY o.next_attempt_at, o.event_id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE rtgip.outbox o SET state = 'in_flight', lease_owner = p_worker,
    lease_until = now() + make_interval(secs => p_lease_seconds), attempts = o.attempts + 1
  FROM due WHERE o.event_id = due.event_id
  RETURNING o.*;
END $$;

-- Advance only with a verified receipt (verification happens in the server worker,
-- which passes the receipt it verified). Only the current lease holder may advance.
CREATE OR REPLACE FUNCTION rtgip.outbox_advance(p_event_id uuid, p_worker text, p_to text, p_receipt jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_kind text := p_receipt->>'kind';
BEGIN
  IF NOT (
    (p_to = 'gateway_admitted' AND v_kind = 'gateway_admission') OR
    (p_to IN ('target_persisted','target_quarantined') AND v_kind = 'target_inbox') OR
    (p_to = 'consumer_committed' AND v_kind = 'consumer_commit')
  ) THEN RAISE EXCEPTION 'illegal_transition:%:%', p_to, v_kind; END IF;
  IF p_receipt->>'event_id' IS DISTINCT FROM p_event_id::text THEN RAISE EXCEPTION 'receipt_event_mismatch'; END IF;
  UPDATE rtgip.outbox SET state = p_to,
    lease_owner = CASE WHEN p_to IN ('consumer_committed','target_quarantined') THEN NULL ELSE lease_owner END
  WHERE event_id = p_event_id AND lease_owner = p_worker AND state IN ('in_flight','gateway_admitted','target_persisted');
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO rtgip.receipts (event_id, kind, issuer, outcome, receipt)
  VALUES (p_event_id, v_kind, p_receipt->>'issuer', p_receipt->>'outcome', p_receipt)
  ON CONFLICT (event_id, kind) DO NOTHING;
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES (p_worker, 'advance:' || p_to, p_event_id, jsonb_build_object('receipt_kind', v_kind));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION rtgip.outbox_fail(p_event_id uuid, p_worker text, p_reason text, p_backoff_seconds integer, p_max_attempts integer)
RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_state text;
BEGIN
  UPDATE rtgip.outbox SET
    state = CASE WHEN attempts >= p_max_attempts THEN 'dead_letter' ELSE 'retry_wait' END,
    next_attempt_at = now() + make_interval(secs => p_backoff_seconds),
    lease_owner = NULL, lease_until = NULL, last_error = p_reason
  WHERE event_id = p_event_id AND lease_owner = p_worker
  RETURNING state INTO v_state;
  IF v_state IS NOT NULL THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail) VALUES (p_worker, 'fail:' || v_state, p_event_id, jsonb_build_object('reason', p_reason));
  END IF;
  RETURN v_state;
END $$;

-- Receive one verified envelope. Returns every event that became 'applied' in revision
-- order (the received one plus any held successors it unblocked). The caller applies
-- each effect in the SAME transaction; any error rolls back the inbox rows too.
CREATE OR REPLACE FUNCTION rtgip.inbox_receive(p_envelope jsonb, p_receiver text)
RETURNS TABLE (event_id uuid, outcome text, reason text, envelope jsonb)
LANGUAGE plpgsql SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_tenant text := p_envelope->>'tenant_id';
  v_origin text := p_envelope#>>'{origin,app}';
  v_id uuid := (p_envelope->>'event_id')::uuid;
  v_sha text := p_envelope->>'payload_sha256';
  v_rev bigint := (p_envelope#>>'{aggregate,revision}')::bigint;
  v_prev bigint := (p_envelope#>>'{aggregate,prev_revision}')::bigint;
  v_wm text := concat_ws('|', v_tenant, p_envelope->>'rooftop_id', v_origin,
                 p_envelope#>>'{aggregate,domain}', p_envelope#>>'{aggregate,type}', p_envelope#>>'{aggregate,id}');
  v_mark bigint;
  v_prior rtgip.inbox%ROWTYPE;
  v_next rtgip.inbox%ROWTYPE;
BEGIN
  IF p_envelope->>'target_app' IS DISTINCT FROM p_receiver THEN RAISE EXCEPTION 'wrong_destination'; END IF;
  -- Serialize per aggregate so concurrent deliveries cannot interleave watermark updates.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_wm, 0));

  SELECT * INTO v_prior FROM rtgip.inbox i WHERE i.tenant_id = v_tenant AND i.origin_app = v_origin AND i.event_id = v_id;
  IF FOUND THEN
    IF v_prior.payload_sha256 <> v_sha THEN
      INSERT INTO rtgip.inbox_conflicts (tenant_id, origin_app, event_id, payload_sha256, envelope)
      VALUES (v_tenant, v_origin, v_id, v_sha, p_envelope) ON CONFLICT DO NOTHING;
      RETURN QUERY SELECT v_id, 'quarantined'::text, 'conflicting_duplicate'::text, p_envelope;
    ELSE
      RETURN QUERY SELECT v_id, 'duplicate'::text, v_prior.outcome, p_envelope;
    END IF;
    RETURN;
  END IF;

  SELECT w.revision INTO v_mark FROM rtgip.watermarks w WHERE w.wm_key = v_wm;
  IF v_mark IS NOT NULL AND v_rev <= v_mark THEN
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'stale_ignored', 'watermark:' || v_mark, p_envelope, now(), now());
    RETURN QUERY SELECT v_id, 'stale_ignored'::text, ('watermark:' || v_mark)::text, p_envelope;
    RETURN;
  END IF;
  IF v_prev IS DISTINCT FROM v_mark THEN
    INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'held', 'awaiting_revision:' || coalesce(v_prev::text, 'null'), p_envelope, now(), NULL);
    RETURN QUERY SELECT v_id, 'held'::text, ('awaiting_revision:' || coalesce(v_prev::text, 'null'))::text, p_envelope;
    RETURN;
  END IF;

  INSERT INTO rtgip.inbox VALUES (v_tenant, v_origin, v_id, v_wm, v_rev, v_prev, v_sha, 'applied', NULL, p_envelope, now(), now());
  INSERT INTO rtgip.watermarks AS w (wm_key, revision) VALUES (v_wm, v_rev)
    ON CONFLICT (wm_key) DO UPDATE SET revision = EXCLUDED.revision, updated_at = now();
  RETURN QUERY SELECT v_id, 'applied'::text, NULL::text, p_envelope;

  LOOP
    SELECT * INTO v_next FROM rtgip.inbox i WHERE i.wm_key = v_wm AND i.outcome = 'held' AND i.prev_revision = v_rev
      ORDER BY i.received_at LIMIT 1;
    EXIT WHEN NOT FOUND;
    UPDATE rtgip.inbox i SET outcome = 'applied', reason = NULL, committed_at = now()
      WHERE i.tenant_id = v_next.tenant_id AND i.origin_app = v_next.origin_app AND i.event_id = v_next.event_id;
    v_rev := v_next.revision;
    UPDATE rtgip.watermarks w SET revision = v_rev, updated_at = now() WHERE w.wm_key = v_wm;
    RETURN QUERY SELECT v_next.event_id, 'applied'::text, 'released_from_hold'::text, v_next.envelope;
  END LOOP;
END $$;

-- Consumer-level rejection after inbox_receive said 'applied' (e.g. unknown episode):
-- the caller rolls back to a savepoint and records the quarantine instead.
CREATE OR REPLACE FUNCTION rtgip.inbox_quarantine(p_envelope jsonb, p_reason text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO rtgip.inbox (tenant_id, origin_app, event_id, wm_key, revision, prev_revision, payload_sha256, outcome, reason, envelope)
  VALUES (p_envelope->>'tenant_id', p_envelope#>>'{origin,app}', (p_envelope->>'event_id')::uuid, 'quarantine',
          (p_envelope#>>'{aggregate,revision}')::bigint, (p_envelope#>>'{aggregate,prev_revision}')::bigint,
          p_envelope->>'payload_sha256', 'quarantined', p_reason, p_envelope)
  ON CONFLICT DO NOTHING;
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES ('inbox', 'quarantined', (p_envelope->>'event_id')::uuid, jsonb_build_object('reason', p_reason));
END $$;

-- Only expired nonce claims are ever purged; inbox, outbox, receipts and audit are retained.
CREATE OR REPLACE FUNCTION rtgip.purge_expired_nonces() RETURNS integer
LANGUAGE sql SET search_path = '' AS $$
  WITH d AS (DELETE FROM rtgip.nonce_claims WHERE expires_at < now() - interval '1 hour' RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;

-- Deny by default: no browser role can read or write any of this. Service role only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_config','connections','signing_keys','nonce_claims','outbox','receipts','inbox','inbox_conflicts','watermarks','audit_log'] LOOP
    EXECUTE format('ALTER TABLE rtgip.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA rtgip FROM anon';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA rtgip FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip FROM authenticated';
  END IF;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
