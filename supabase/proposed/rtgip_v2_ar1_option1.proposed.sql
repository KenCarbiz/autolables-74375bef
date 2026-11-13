-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- AR-1 strict option 1 (k2/D2-ANALYSIS-r2 sections 2.2, 4, 5 and 6): app-side SQL amendment to the
-- rtgip/2 delivery ledger. Apply after rtgip_v2_delivery.proposed.sql (sha256 5bdde923...), which
-- stays byte-identical. Shared byte-for-byte by AutoLabels, AutoCurb and AutoFrame. Idempotent.
-- The receipt-contract amendments A1-1 to A1-6 it implements still need Ken's explicit approval.
--
-- Key audience (A1-4), the same column and rule as the Gateway's K3-GW gw_r2_keys.audience: every
-- rtgip/2 key speaks to exactly one audience. Each app database holds exactly two key rows in its
-- verification path:
--   owner = this app, audience gateway    (stg-<app>-2): the app signs its envelopes, its target
--                                         receipts and its receipt queries with it; its own target
--                                         receipts are re-verified with it by inbox_record_receipts;
--   owner gateway, audience = this app    (gw-<app>-2): the Gateway signs every forward, admission
--                                         receipt and gateway_confirmation towards this app.
-- A row with no audience (the -1 rows until cutover), another app's key, or a Gateway key towards
-- another app is outside the verification path: it never verifies anything here.
--
-- Source rule (A1-2). outbox_advance verifies exactly [gateway_admission, gateway_confirmation],
-- both Gateway-signed with gw-<app>; it never needs a target key. Target-issued receipts are
-- verified by the Gateway, which then issues the confirmation (A1-1): kind gateway_confirmation,
-- issuer gateway, recipient the source app, outcome consumer_committed, target_quarantined or
-- delivery_abandoned (the Gateway dead-lettered the delivery), prev_receipt_sha256 the digest of
-- the source's admission receipt. At most one confirmation exists per delivery and it is final.
-- Target rule (A1-3). inbox_admit takes a forward signed with gw-<app> and the admission receipt
-- the Gateway signed for this target with the same key; the forward wire is unchanged.
-- H4 (A1-6). The direct AL/AC -> AF media export route is retired: its database role can no
-- longer read export keys, claim export nonces or authorize an export (AutoFrame only; a no-op
-- where the rtgip_fx export functions do not exist).

ALTER TABLE rtgip.signing_keys ADD COLUMN IF NOT EXISTS audience text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rtgip.signing_keys'::regclass
                 AND conname = 'signing_keys_audience_check') THEN
    ALTER TABLE rtgip.signing_keys ADD CONSTRAINT signing_keys_audience_check CHECK (
      audience IS NULL
      OR (dialect = 'rtgip/2' AND ((owner = 'gateway' AND audience IN ('autolabels','autocurb','autoframe'))
                                   OR (owner <> 'gateway' AND audience = 'gateway'))));
  END IF;
END $$;
-- A -1 key never gets an audience (security review F5): the -1 rows stay outside every
-- verification path until they are revoked; -2 keys are installed as new rows.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rtgip.signing_keys'::regclass
                 AND conname = 'signing_keys_legacy_no_audience_check') THEN
    ALTER TABLE rtgip.signing_keys ADD CONSTRAINT signing_keys_legacy_no_audience_check
      CHECK (audience IS NULL OR key_id !~ '-1$');
  END IF;
END $$;
-- One current key per (owner, audience): the runtime signs with the single current key of its app.
CREATE UNIQUE INDEX IF NOT EXISTS signing_keys_one_current_per_audience
  ON rtgip.signing_keys (owner, audience) WHERE audience IS NOT NULL AND status = 'current';

ALTER TABLE rtgip.receipts DROP CONSTRAINT IF EXISTS receipts_kind_check;
ALTER TABLE rtgip.receipts ADD CONSTRAINT receipts_kind_check
  CHECK (kind IN ('gateway_admission','target_inbox','consumer_commit','gateway_confirmation'));

-- receipt_check_signature: as the package, plus the verification-path rule: a Gateway key must have
-- this database's local_app as audience; any other key must be this app's own, audience gateway.
CREATE OR REPLACE FUNCTION rtgip.receipt_check_signature(r jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k rtgip.signing_keys%ROWTYPE; v_now timestamptz := rtgip.clock(); v_iat timestamptz := to_timestamp((r->>'issued_at')::bigint);
  v_secret text; v_mac text;
BEGIN
  SELECT * INTO k FROM rtgip.signing_keys WHERE key_id = r->>'key_id';
  IF NOT FOUND OR k.owner <> r->>'issuer' OR k.dialect <> 'rtgip/2' OR k.status = 'revoked'
     OR v_now < k.not_before OR v_now > k.not_after OR v_iat < k.not_before OR v_iat > k.not_after
     OR NOT ((r->>'connection_id') = ANY (k.connection_ids))
     OR k.audience IS DISTINCT FROM (CASE WHEN k.owner = 'gateway' THEN rtgip.local_app() ELSE 'gateway' END)
     OR (k.owner <> 'gateway' AND k.owner IS DISTINCT FROM rtgip.local_app()) THEN
    RAISE EXCEPTION 'ack_key_not_authorized';
  END IF;
  IF v_iat > v_now + interval '300 seconds' THEN RAISE EXCEPTION 'ack_future_receipt'; END IF;
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = k.secret_ref;
  IF v_secret IS NULL OR v_secret = '' THEN RAISE EXCEPTION 'ack_key_secret_unavailable'; END IF;
  v_mac := encode(extensions.hmac(convert_to('rtgip/2-receipt/2' || chr(10) || rtgip.receipt_canonical(r - 'signature'), 'UTF8'),
                                  convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  IF r->>'signature' !~ '^[0-9a-f]{64}$' OR NOT rtgip.ct_equal(v_mac, r->>'signature') THEN RAISE EXCEPTION 'ack_bad_signature'; END IF;
END $$;

-- receipt_verify: the source-side stage table under A1-1/A1-2. Only gateway_admission (no previous
-- stage) and gateway_confirmation (previous stage: the admission, linked by digest, time not
-- reversed) verify; issuer is always the Gateway and recipient the source app. A well-formed
-- target_inbox or consumer_commit is refused with ack_wrong_stage.
CREATE OR REPLACE FUNCTION rtgip.receipt_verify(p_text text, p_prev text, p_envelope jsonb, p_connection text, p_delivery_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb; prev jsonb; f text; v_kind text; v_out text; v_issuer text; v_recipient text;
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
          OR (v_kind = 'consumer_commit' AND v_out IN ('applied','stale_ignored'))
          OR (v_kind = 'gateway_confirmation' AND v_out IN ('consumer_committed','target_quarantined','delivery_abandoned'))) THEN
    RAISE EXCEPTION 'ack_unsupported_version_or_shape';
  END IF;
  IF p_text <> rtgip.receipt_canonical(r) THEN RAISE EXCEPTION 'ack_not_canonical'; END IF;
  IF v_kind NOT IN ('gateway_admission','gateway_confirmation') THEN RAISE EXCEPTION 'ack_wrong_stage'; END IF;

  v_issuer := 'gateway';
  v_recipient := p_envelope->>'source_app';
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
    IF p_prev IS NULL THEN RAISE EXCEPTION 'ack_missing_previous_stage'; END IF;
    prev := p_prev::jsonb;
    IF prev->>'kind' IS DISTINCT FROM 'gateway_admission'
       OR r->>'prev_receipt_sha256' IS DISTINCT FROM encode(extensions.digest(convert_to(p_prev, 'UTF8'), 'sha256'), 'hex') THEN
      RAISE EXCEPTION 'ack_missing_previous_stage';
    END IF;
    IF (r->>'issued_at')::bigint < (prev->>'issued_at')::bigint THEN RAISE EXCEPTION 'ack_stage_time_reversed'; END IF;
  END IF;
  RETURN r;
END $$;

-- outbox_advance: deliver lease as the package (exactly one gateway_admission -> gateway_admitted).
-- Confirm lease (A1-2): the receipt query answers exactly [admission, gateway_confirmation]; the
-- first must equal the stored admission byte for byte (ack_admission_mismatch). [adm] alone ->
-- pending:gateway_confirmation_pending; a confirmation with outcome consumer_committed ->
-- consumer_committed, target_quarantined -> target_quarantined, delivery_abandoned -> dead_letter
-- (terminal; only the audited operator redrive leaves it). Three or more receipts (the old
-- full chain) -> ack_chain_too_long. Lease, generation and audit rules are unchanged.
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
    IF n > 2 THEN RAISE EXCEPTION 'ack_chain_too_long'; END IF;
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
      IF n = 1 THEN RETURN 'pending:gateway_confirmation_pending'; END IF;
      IF v_all->1->>'kind' IS DISTINCT FROM 'gateway_confirmation' THEN RAISE EXCEPTION 'ack_wrong_stage'; END IF;
      v_to := CASE v_all->1->>'outcome' WHEN 'target_quarantined' THEN 'target_quarantined'
                                         WHEN 'delivery_abandoned' THEN 'dead_letter' ELSE 'consumer_committed' END;
      INSERT INTO rtgip.receipts (event_id, attempt, kind, issuer, outcome, key_id, signing_text, signature)
      VALUES (o.event_id, o.attempts, 'gateway_confirmation', v_all->1->>'issuer', v_all->1->>'outcome', v_all->1->>'key_id',
              rtgip.receipt_canonical((v_all->1) - 'signature'), v_all->1->>'signature')
      ON CONFLICT DO NOTHING;
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

-- inbox_admit: as the package, plus one check after the signer checks: the forward key must be the
-- Gateway's key towards THIS app (owner gateway, audience = local_app), else
-- key_audience_mismatch. The admission receipt is verified by receipt_verify with the same rule.
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
    IF k.audience IS DISTINCT FROM v_local THEN RAISE EXCEPTION 'key_audience_mismatch'; END IF;
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

DO $$
BEGIN
  IF to_regprocedure('rtgip_fx.frame_export_key(text)') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_frame_exporter') THEN
    REVOKE EXECUTE ON FUNCTION rtgip_fx.frame_authorize_export(jsonb), rtgip_fx.frame_export_key(text),
      rtgip_fx.frame_export_claim_nonce(text, text, text, bigint) FROM rtgip_frame_exporter;
  END IF;
END $$;
