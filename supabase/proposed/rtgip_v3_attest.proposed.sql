-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- rtgip/3 (Ed25519) app-side SQL: public keys, the SQL attestation rtgip/3-attest/1, append-only evidence,
-- the per-connection protocol pin and the v3 entry points. Contract: rtgip/3-contract-freeze/1
-- (docs/contracts/RTGIP3-CANDIDATE.md, rtgip3/attest.v1.json, keyset.v1.json, refusal-policy.v1.json).
-- Apply after rtgip_v2_delivery.proposed.sql (sha256 5bdde923...) and rtgip_v2_ar1_option1.proposed.sql
-- (sha256 9fd14f84...); both stay byte-identical and every rtgip/2 function keeps its body. Shared
-- byte-for-byte by AutoLabels, AutoCurb and AutoFrame; applied per app through ar3-<app>.sql. Idempotent.
--
-- Trust boundary (attest.v1.json trust_statement). The edge (rtgip-inbound, rtgip-dispatch) verifies Ed25519
-- with Web Crypto and checks RTGIP3_KEY_PINS, which this database does not hold. SQL takes on trust only the
-- Ed25519 verdict of each attested item and that the pin check ran. Everything else it repeats itself:
--   a. it recomputes every signed message from its own inputs (headers + sha256 of the exact body bytes;
--      the origin JSON + the same body digest; 'rtgip/3-receipt/3' || LF || receipt_canonical(r - signature));
--   b. item.msg_sha256 = sha256(message it recomputed);
--   c. item.sig = the signature it received, 128 lowercase hex with S < L;
--   d. the key row FOR SHARE: key id and fingerprint, protocol rtgip/3, alg ed25519, not revoked, valid now
--      (rtgip.clock()) and at the role's instant, owner = the role's signer = the owner named in the key id,
--      and a key binding row for the connection;
--   e. verified_at within 60 s of rtgip.clock(), attest = rtgip/3-attest/1, exactly the expected roles;
--   f. the role's non-cryptographic rules (origin, receipt kind table, delivery binding, chain links);
--   g. one append-only rtgip.evidence_v3 row per item, in the same transaction as the admission or advance.
-- Key binding: the contract's "per-connection key binding rows" are the rows of rtgip.public_key_bindings
-- (key_id, connection_id). connection_ids is outside the key pin; a key verifies for a connection only while
-- its binding row exists, and the binding row is read FOR SHARE together with the key row.
-- Version pin: rtgip.connections.send_protocol / accept_protocols / v3_added_at / v2_accept_until, and
-- rtgip.outbox.protocol, set at the first claim from send_protocol and immutable afterwards. The rtgip/2 entry
-- points are untouched; the table triggers below make them refuse rows and receipts of the other version.
-- attest_* and key_not_pinned are local faults: the runtime logs them and answers 503 verification_unavailable.
-- Least privilege as the delivery package: SECURITY DEFINER, search_path '', EXECUTE revoked from PUBLIC, anon,
-- authenticated, service_role and every sandbox_exec* role; v3 entries are granted to the existing duty roles only.

DO $pre$
BEGIN
  IF to_regclass('rtgip.delivery_config') IS NULL OR to_regclass('rtgip.inbox_deliveries') IS NULL
     OR to_regprocedure('rtgip.inbox_admit(jsonb,text,text,jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'rtgip.signing_keys'::regclass AND attname = 'audience' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rtgip.receipts'::regclass AND conname = 'receipts_kind_check'
                    AND pg_get_constraintdef(oid) LIKE '%gateway_confirmation%') THEN
    RAISE EXCEPTION 'rtgip_v3_requires_delivery_and_ar1';
  END IF;
END $pre$;

-- ---------------------------------------------------------------------------------------------------------
-- Ed25519 sanity in SQL (no verification): canonical public-key decoding, the small-order test and S < L.
-- Same arithmetic as decodePoint / isUnusablePublicKey in rtgip3/kat.ts.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rtgip.ed25519_powmod(p_b numeric, p_e numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m constant numeric := 57896044618658097711785492504343953926634992332820282019728792003956564819949;
  r numeric := 1; b numeric := mod(p_b, m); e numeric := p_e;
BEGIN
  IF b < 0 THEN b := b + m; END IF;
  WHILE e > 0 LOOP
    IF mod(e, 2) = 1 THEN r := mod(r * b, m); END IF;
    b := mod(b * b, m);
    e := div(e, 2);
  END LOOP;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION rtgip.ed25519_le(p_bytes bytea) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY DEFINER SET search_path = '' AS $$
DECLARE v numeric := 0;
BEGIN
  FOR i IN REVERSE length(p_bytes) - 1 .. 0 LOOP
    v := v * 256 + get_byte(p_bytes, i);
  END LOOP;
  RETURN v;
END $$;

-- True only for a canonical encoding of a curve point that is not one of the eight small-order points.
CREATE OR REPLACE FUNCTION rtgip.ed25519_pk_usable(p_hex text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p constant numeric := 57896044618658097711785492504343953926634992332820282019728792003956564819949;
  dd constant numeric := 37095705934669439343138083508754565189542113879843219016388785533085940283555;
  sqrt_m1 constant numeric := 19681161376707505956807079304988542015446066515923890162744021073123829784752;
  b bytea; v numeric; sgn integer; y numeric; y2 numeric; x2 numeric; x numeric; k numeric; nx numeric; ny numeric;
BEGIN
  IF p_hex IS NULL OR p_hex !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  b := decode(p_hex, 'hex');
  v := rtgip.ed25519_le(b);
  sgn := (get_byte(b, 31) >> 7) & 1;
  y := v - sgn * power(2::numeric, 255);
  IF y >= p THEN RETURN false; END IF;
  y2 := mod(y * y, p);
  x2 := mod(mod(y2 - 1 + p, p) * rtgip.ed25519_powmod(mod(dd * y2 + 1, p), p - 2), p);
  x := rtgip.ed25519_powmod(x2, (p + 3) / 8);
  IF mod(x * x - x2 + p, p) <> 0 THEN x := mod(x * sqrt_m1, p); END IF;
  IF mod(x * x - x2 + p, p) <> 0 THEN RETURN false; END IF;
  IF x = 0 AND sgn = 1 THEN RETURN false; END IF;
  IF mod(x, 2) <> sgn THEN x := mod(p - x, p); END IF;
  FOR i IN 1 .. 3 LOOP
    k := mod(dd * x * x * y * y, p);
    nx := mod((x * y + y * x) * rtgip.ed25519_powmod(mod(1 + k, p), p - 2), p);
    ny := mod((y * y + x * x) * rtgip.ed25519_powmod(mod(1 - k + p, p), p - 2), p);
    x := nx; y := ny;
  END LOOP;
  RETURN NOT (x = 0 AND y = 1);
END $$;

-- Signature shape: 128 lowercase hex and canonical S (the second 32 bytes, little-endian) below the group order L.
CREATE OR REPLACE FUNCTION rtgip.ed25519_sig_shape(p_sig text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_sig IS NULL OR p_sig !~ '^[0-9a-f]{128}$' THEN RETURN false; END IF;
  RETURN rtgip.ed25519_le(decode(substr(p_sig, 65, 64), 'hex'))
         < 7237005577332262213973186563042994240857116359379907606001950938285454250989;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Public keys (keyset rtgip/3-keyset/1 records; public material only) and the per-connection binding rows.
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rtgip.public_keys (
  key_id text PRIMARY KEY CONSTRAINT public_keys_key_id_check
    CHECK (key_id ~ '^(stg|prd)-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$'),
  owner text NOT NULL CHECK (owner IN ('gateway','autolabels','autocurb','autoframe')),
  protocol text NOT NULL CONSTRAINT public_keys_protocol_check CHECK (protocol = 'rtgip/3'),
  alg text NOT NULL CONSTRAINT public_keys_alg_check CHECK (alg = 'ed25519'),
  public_key text NOT NULL UNIQUE CONSTRAINT public_keys_public_key_usable
    CHECK (public_key ~ '^[0-9a-f]{64}$' AND rtgip.ed25519_pk_usable(public_key)),
  fingerprint text NOT NULL CONSTRAINT public_keys_fingerprint_check
    CHECK (fingerprint ~ '^[0-9a-f]{64}$' AND fingerprint = encode(sha256(decode(public_key, 'hex')), 'hex')),
  status text NOT NULL CHECK (status IN ('current','previous','revoked')),
  not_before bigint NOT NULL CHECK (not_before >= 0),
  not_after bigint NOT NULL,
  revoked_at bigint,
  revoked_reason text CHECK (revoked_reason IN ('superseded','compromise')),
  keyset_sha256 text NOT NULL CHECK (keyset_sha256 ~ '^[0-9a-f]{64}$'),
  installed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_keys_validity_check CHECK (not_after > not_before),
  CONSTRAINT public_keys_revocation_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)
                                                 AND (revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT public_keys_owner_matches_key_id CHECK (owner = substring(key_id FROM '^[a-z]+-([a-z]+)-ed'))
);

CREATE TABLE IF NOT EXISTS rtgip.public_key_bindings (
  key_id text NOT NULL REFERENCES rtgip.public_keys(key_id),
  connection_id text NOT NULL REFERENCES rtgip.connections(connection_id),
  bound_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, connection_id)
);
CREATE INDEX IF NOT EXISTS public_key_bindings_connection_idx ON rtgip.public_key_bindings (connection_id);

-- Every evidence row is one attested item: the exact message SQL recomputed and the signature it received,
-- re-verifiable offline by rtgip3-audit against the owner keyset.
CREATE TABLE IF NOT EXISTS rtgip.evidence_v3 (
  id bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  entry text NOT NULL CHECK (entry IN ('inbox_admit_v3','inbox_record_receipts_v3','outbox_advance_v3')),
  role text NOT NULL CHECK (role IN ('forward','admission','origin') OR role ~ '^receipt:[0-2]$'),
  connection_id text NOT NULL,
  delivery_id text CHECK (delivery_id ~ '^[0-9a-f]{64}$'),
  event_id uuid,
  key_id text NOT NULL,
  pk_sha256 text NOT NULL CHECK (pk_sha256 ~ '^[0-9a-f]{64}$'),
  message text NOT NULL,
  msg_sha256 text NOT NULL,
  sig text NOT NULL CHECK (sig ~ '^[0-9a-f]{128}$'),
  verifier text NOT NULL CHECK (verifier ~ '^[0-9a-f]{64}$'),
  verified_at bigint NOT NULL,
  CONSTRAINT evidence_v3_msg_sha256_check CHECK (msg_sha256 = encode(sha256(convert_to(message, 'UTF8')), 'hex'))
);
CREATE INDEX IF NOT EXISTS evidence_v3_delivery_idx ON rtgip.evidence_v3 (delivery_id);

CREATE OR REPLACE FUNCTION rtgip.evidence_v3_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'rtgip.evidence_v3 is append-only';
END $$;
DROP TRIGGER IF EXISTS evidence_v3_no_update ON rtgip.evidence_v3;
CREATE TRIGGER evidence_v3_no_update BEFORE UPDATE OR DELETE OR TRUNCATE ON rtgip.evidence_v3
  FOR EACH STATEMENT EXECUTE FUNCTION rtgip.evidence_v3_immutable();

-- Key rows: the pinned fields never change, revocation is final, at most two live keys per owner, and a row is
-- removed only while no evidence names it (an uninstalled K5-v3 apply), never once it has verified anything.
CREATE OR REPLACE FUNCTION rtgip.public_keys_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM rtgip.evidence_v3 e WHERE e.key_id = OLD.key_id) THEN RAISE EXCEPTION 'public_key_has_evidence'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key_id <> OLD.key_id OR NEW.owner <> OLD.owner OR NEW.protocol <> OLD.protocol OR NEW.alg <> OLD.alg
       OR NEW.public_key <> OLD.public_key OR NEW.fingerprint <> OLD.fingerprint OR NEW.not_before <> OLD.not_before
       OR NEW.not_after <> OLD.not_after OR NEW.keyset_sha256 <> OLD.keyset_sha256 THEN
      RAISE EXCEPTION 'public_key_immutable';
    END IF;
    IF OLD.status = 'revoked' AND (NEW.status <> 'revoked' OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
                                   OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason) THEN
      RAISE EXCEPTION 'public_key_revocation_final';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM rtgip.public_keys k WHERE k.key_id <> NEW.key_id
             AND split_part(k.key_id, '-', 1) <> split_part(NEW.key_id, '-', 1)) THEN
    RAISE EXCEPTION 'public_key_env_mixed';
  END IF;
  IF NEW.status <> 'revoked' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('rtgip.public_keys:' || NEW.owner || ':' || NEW.protocol, 0));
    SELECT count(*) INTO v_n FROM rtgip.public_keys k
     WHERE k.owner = NEW.owner AND k.protocol = NEW.protocol AND k.status <> 'revoked' AND k.key_id <> NEW.key_id;
    IF v_n >= 2 THEN RAISE EXCEPTION 'too_many_live_keys'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS public_keys_guard ON rtgip.public_keys;
CREATE TRIGGER public_keys_guard BEFORE INSERT OR UPDATE OR DELETE ON rtgip.public_keys
  FOR EACH ROW EXECUTE FUNCTION rtgip.public_keys_guard();
CREATE OR REPLACE FUNCTION rtgip.public_keys_no_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'rtgip.public_keys rows are retained';
END $$;
DROP TRIGGER IF EXISTS public_keys_no_truncate ON rtgip.public_keys;
CREATE TRIGGER public_keys_no_truncate BEFORE TRUNCATE ON rtgip.public_keys
  FOR EACH STATEMENT EXECUTE FUNCTION rtgip.public_keys_no_truncate();

-- ---------------------------------------------------------------------------------------------------------
-- Per-connection protocol pin.
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE rtgip.connections ADD COLUMN IF NOT EXISTS send_protocol text NOT NULL DEFAULT 'rtgip/2'
  CHECK (send_protocol IN ('rtgip/2','rtgip/3'));
ALTER TABLE rtgip.connections ADD COLUMN IF NOT EXISTS accept_protocols text[] NOT NULL DEFAULT '{rtgip/2}'
  CHECK (cardinality(accept_protocols) >= 1 AND accept_protocols <@ '{rtgip/2,rtgip/3}' AND array_position(accept_protocols, NULL) IS NULL);
ALTER TABLE rtgip.connections ADD COLUMN IF NOT EXISTS v3_added_at bigint;
ALTER TABLE rtgip.connections ADD COLUMN IF NOT EXISTS v2_accept_until bigint;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rtgip.connections'::regclass AND conname = 'connections_v3_added_check') THEN
    ALTER TABLE rtgip.connections ADD CONSTRAINT connections_v3_added_check
      CHECK (NOT ('rtgip/3' = ANY (accept_protocols)) OR v3_added_at IS NOT NULL);
  END IF;
END $c$;

-- v3_added_at is stamped by the database (rtgip.clock()) the first time rtgip/3 enters the accept set, and it
-- is never changed or cleared afterwards, so the rtgip/2 hard expiry v3_added_at + 7 days cannot be moved.
CREATE OR REPLACE FUNCTION rtgip.connections_protocol_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old bigint := CASE WHEN TG_OP = 'UPDATE' THEN OLD.v3_added_at END;
BEGIN
  IF v_old IS NOT NULL THEN
    IF NEW.v3_added_at IS DISTINCT FROM v_old THEN RAISE EXCEPTION 'v3_added_at_immutable'; END IF;
  ELSIF NEW.v3_added_at IS NOT NULL OR 'rtgip/3' = ANY (NEW.accept_protocols) THEN
    NEW.v3_added_at := floor(extract(epoch FROM rtgip.clock()))::bigint;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS connections_protocol_guard ON rtgip.connections;
CREATE TRIGGER connections_protocol_guard BEFORE INSERT OR UPDATE ON rtgip.connections
  FOR EACH ROW EXECUTE FUNCTION rtgip.connections_protocol_guard();

-- The version gate (contract: Coexistence). NULL = accepted. Once rtgip/3 is accepted, rtgip/2 is accepted only
-- while now <= min(v2_accept_until, v3_added_at + 7 days), and both must be set.
CREATE OR REPLACE FUNCTION rtgip.gate_verdict(p_accept text[], p_v3_added_at bigint, p_v2_accept_until bigint, p_presented text, p_now bigint)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT coalesce(p_presented = ANY (p_accept), false) THEN 'protocol_not_accepted'
    WHEN p_presented = 'rtgip/2' AND 'rtgip/3' = ANY (p_accept)
         AND (p_v3_added_at IS NULL OR p_v2_accept_until IS NULL OR p_now > least(p_v2_accept_until, p_v3_added_at + 604800))
      THEN 'protocol_not_accepted'
  END
$$;

-- Outbox: protocol and the rtgip/3 delivery id are pinned at the first claim from the connection's
-- send_protocol and never change. A row claimed before this file existed was delivered under rtgip/2. The
-- stored receipts must all be of the row's version, so neither entry point can advance a row of the other.
ALTER TABLE rtgip.outbox ADD COLUMN IF NOT EXISTS protocol text CHECK (protocol IN ('rtgip/2','rtgip/3'));
ALTER TABLE rtgip.outbox ADD COLUMN IF NOT EXISTS delivery_id_v3 text CHECK (delivery_id_v3 ~ '^[0-9a-f]{64}$');
DO $o$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rtgip.outbox'::regclass AND conname = 'outbox_v3_identity_check') THEN
    ALTER TABLE rtgip.outbox ADD CONSTRAINT outbox_v3_identity_check CHECK ((protocol = 'rtgip/3') = (delivery_id_v3 IS NOT NULL));
  END IF;
END $o$;

-- deliveryId3 in rtgip3/kat.ts: sha256(canonical(["rtgip/3-receipt/3", connection, event_id, target_app, envelope_sha256])).
CREATE OR REPLACE FUNCTION rtgip.delivery_identity_v3(p_connection text, e jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(rtgip.canonical_json(jsonb_build_array('rtgip/3-receipt/3',
    p_connection, e->>'event_id', e->>'target_app', rtgip.envelope_sha(e))), 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION rtgip.outbox_protocol_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_send text; v_want text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.protocol IS NOT NULL OR NEW.delivery_id_v3 IS NOT NULL THEN RAISE EXCEPTION 'outbox_protocol_set_at_claim'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.protocol IS NOT NULL THEN
    IF NEW.protocol IS DISTINCT FROM OLD.protocol OR NEW.delivery_id_v3 IS DISTINCT FROM OLD.delivery_id_v3 THEN
      RAISE EXCEPTION 'outbox_protocol_immutable';
    END IF;
  ELSIF NEW.lease_generation > OLD.lease_generation THEN
    SELECT c.send_protocol INTO v_send FROM rtgip.connections c WHERE c.connection_id = NEW.connection_id;
    NEW.protocol := CASE WHEN OLD.lease_generation = 0 THEN coalesce(v_send, 'rtgip/2') ELSE 'rtgip/2' END;
    NEW.delivery_id_v3 := CASE WHEN NEW.protocol = 'rtgip/3' THEN rtgip.delivery_identity_v3(NEW.connection_id, NEW.envelope) END;
  ELSIF NEW.protocol IS NOT NULL OR NEW.delivery_id_v3 IS NOT NULL THEN
    RAISE EXCEPTION 'outbox_protocol_set_at_claim';
  END IF;
  IF NEW.receipts IS DISTINCT FROM OLD.receipts AND jsonb_array_length(NEW.receipts) > 0 THEN
    v_want := CASE WHEN NEW.protocol = 'rtgip/3' THEN 'rtgip/3-receipt/3' ELSE 'rtgip/2-receipt/2' END;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.receipts) x WHERE x->>'protocol' IS DISTINCT FROM v_want) THEN
      RAISE EXCEPTION 'protocol_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outbox_protocol_guard ON rtgip.outbox;
CREATE TRIGGER outbox_protocol_guard BEFORE INSERT OR UPDATE ON rtgip.outbox
  FOR EACH ROW EXECUTE FUNCTION rtgip.outbox_protocol_guard();

-- Receipts, admissions, inbox and deliveries record their version. v2 writers leave the 'rtgip/2' default.
ALTER TABLE rtgip.receipts ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'rtgip/2' CHECK (protocol IN ('rtgip/2','rtgip/3'));
ALTER TABLE rtgip.receipts DROP CONSTRAINT IF EXISTS receipts_signature_check;
ALTER TABLE rtgip.receipts ADD CONSTRAINT receipts_signature_check
  CHECK ((protocol = 'rtgip/2' AND signature ~ '^[0-9a-f]{64}$') OR (protocol = 'rtgip/3' AND signature ~ '^[0-9a-f]{128}$'));
ALTER TABLE rtgip.admissions ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'rtgip/2' CHECK (protocol IN ('rtgip/2','rtgip/3'));
ALTER TABLE rtgip.admissions ADD COLUMN IF NOT EXISTS evidence_id bigint;
ALTER TABLE rtgip.inbox ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'rtgip/2' CHECK (protocol IN ('rtgip/2','rtgip/3'));
ALTER TABLE rtgip.inbox_deliveries ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'rtgip/2' CHECK (protocol IN ('rtgip/2','rtgip/3'));

-- An inbox row keeps the protocol it was first admitted under: rtgip/3 is recorded in the same statement that
-- first binds the row to its delivery, and nothing changes it afterwards.
CREATE OR REPLACE FUNCTION rtgip.inbox_protocol_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.protocol IS DISTINCT FROM OLD.protocol
     AND NOT (OLD.protocol = 'rtgip/2' AND NEW.protocol = 'rtgip/3' AND OLD.delivery_id IS NULL AND NEW.delivery_id IS NOT NULL) THEN
    RAISE EXCEPTION 'inbox_protocol_immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inbox_protocol_guard ON rtgip.inbox;
CREATE TRIGGER inbox_protocol_guard BEFORE UPDATE ON rtgip.inbox
  FOR EACH ROW EXECUTE FUNCTION rtgip.inbox_protocol_guard();

-- A delivery's protocol never changes and its stored receipts are all of that version, so
-- rtgip.inbox_record_receipts (v2) refuses a v3 delivery and the reverse.
CREATE OR REPLACE FUNCTION rtgip.inbox_deliveries_protocol_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_want text; t text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.protocol IS DISTINCT FROM OLD.protocol THEN RAISE EXCEPTION 'inbox_delivery_protocol_immutable'; END IF;
  IF NEW.receipts IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.receipts IS DISTINCT FROM OLD.receipts) THEN
    v_want := CASE WHEN NEW.protocol = 'rtgip/3' THEN 'rtgip/3-receipt/3' ELSE 'rtgip/2-receipt/2' END;
    FOREACH t IN ARRAY NEW.receipts LOOP
      BEGIN
        IF t::jsonb->>'protocol' IS DISTINCT FROM v_want THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
      EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'protocol_mismatch';
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inbox_deliveries_protocol_guard ON rtgip.inbox_deliveries;
CREATE TRIGGER inbox_deliveries_protocol_guard BEFORE INSERT OR UPDATE ON rtgip.inbox_deliveries
  FOR EACH ROW EXECUTE FUNCTION rtgip.inbox_deliveries_protocol_guard();

-- Defence in depth for the version gate: the frozen rtgip/2 inbox_admit cannot call it, so an rtgip/2 admission
-- on a connection that no longer accepts rtgip/2 aborts the whole call here (nonce claim and inbox effect roll back).
CREATE OR REPLACE FUNCTION rtgip.admissions_protocol_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c rtgip.connections%ROWTYPE; v_gate text;
BEGIN
  SELECT * INTO c FROM rtgip.connections x WHERE x.connection_id = NEW.connection_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'protocol_not_accepted'; END IF;
  v_gate := rtgip.gate_verdict(c.accept_protocols, c.v3_added_at, c.v2_accept_until, NEW.protocol,
                               floor(extract(epoch FROM rtgip.clock()))::bigint);
  IF v_gate IS NOT NULL THEN RAISE EXCEPTION '%', v_gate; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admissions_protocol_gate ON rtgip.admissions;
CREATE TRIGGER admissions_protocol_gate BEFORE INSERT ON rtgip.admissions
  FOR EACH ROW EXECUTE FUNCTION rtgip.admissions_protocol_gate();

-- ---------------------------------------------------------------------------------------------------------
-- Message helpers.
-- ---------------------------------------------------------------------------------------------------------
-- scopeOf(envelope): source;target;tenant;rooftop;event_type;schema_version;purpose;event_id.
CREATE OR REPLACE FUNCTION rtgip.scope_of(e jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT array_to_string(ARRAY[e->>'source_app', e->>'target_app', e->>'tenant_id', e->>'rooftop_id',
    e->>'event_type', e->>'schema_version', e->>'purpose', e->>'event_id'], ';')
$$;

-- H1/H2 message: rtgip/3, key_id, signer, ts, nonce, scope, sha256hex(body), joined by LF, no trailing LF.
CREATE OR REPLACE FUNCTION rtgip.preimage_v3(p_key text, p_signer text, p_ts text, p_nonce text, p_scope text, p_body_sha text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT array_to_string(ARRAY['rtgip/3', p_key, p_signer, p_ts, p_nonce, p_scope, p_body_sha], chr(10), '')
$$;

CREATE OR REPLACE FUNCTION rtgip.receipt_message_v3(r jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'rtgip/3-receipt/3' || chr(10) || rtgip.receipt_canonical(r - 'signature')
$$;

-- sourceRowCheck: every presented receipt must be of the entry's receipt protocol. Unparseable text is left to
-- the shape check (invalid_receipt_shape).
CREATE OR REPLACE FUNCTION rtgip.receipts_protocol_ok(p_receipts text[], p_want text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text; j jsonb;
BEGIN
  FOREACH t IN ARRAY coalesce(p_receipts, '{}') LOOP
    BEGIN j := t::jsonb; EXCEPTION WHEN others THEN CONTINUE; END;
    IF jsonb_typeof(j) = 'object' AND j->'protocol' IS DISTINCT FROM to_jsonb(p_want) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- base64url (no padding) to UTF-8 text; raises on any malformed input.
CREATE OR REPLACE FUNCTION rtgip.b64url_text(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR p !~ '^[A-Za-z0-9_-]*$' OR length(p) % 4 = 1 THEN RAISE EXCEPTION 'bad_b64url'; END IF;
  RETURN convert_from(decode(translate(p, '-_', '+/') || repeat('=', (4 - length(p) % 4) % 4), 'base64'), 'UTF8');
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Attestation step d: the key row FOR SHARE and, when a connection is named, its binding row FOR SHARE.
-- Same reasons as resolveKey in rtgip3/kat.ts; the pin check (key_not_pinned) is the edge's.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rtgip.v3_key_row(p_key_id text, p_signer text, p_at bigint, p_connection text)
RETURNS rtgip.public_keys LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k rtgip.public_keys%ROWTYPE;
  v_now bigint := floor(extract(epoch FROM rtgip.clock()))::bigint;
  v_id_owner text := substring(p_key_id FROM '^[a-z]+-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$');
BEGIN
  SELECT * INTO k FROM rtgip.public_keys pk WHERE pk.key_id = p_key_id FOR SHARE;
  IF NOT FOUND OR v_id_owner IS NULL THEN RAISE EXCEPTION 'unknown_key'; END IF;
  IF k.fingerprint IS DISTINCT FROM encode(sha256(decode(k.public_key, 'hex')), 'hex') THEN RAISE EXCEPTION 'key_not_pinned'; END IF;
  IF k.protocol <> 'rtgip/3' THEN RAISE EXCEPTION 'key_dialect_mismatch'; END IF;
  IF k.alg <> 'ed25519' THEN RAISE EXCEPTION 'alg_mismatch'; END IF;
  IF k.status = 'revoked' OR k.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'key_revoked'; END IF;
  IF v_now < k.not_before OR v_now > k.not_after THEN RAISE EXCEPTION 'key_outside_validity'; END IF;
  IF p_at IS NOT NULL AND (p_at < k.not_before OR p_at > k.not_after) THEN RAISE EXCEPTION 'key_outside_validity'; END IF;
  IF k.owner <> v_id_owner OR k.owner IS DISTINCT FROM p_signer THEN RAISE EXCEPTION 'signer_key_mismatch'; END IF;
  IF p_connection IS NOT NULL THEN
    PERFORM 1 FROM rtgip.public_key_bindings b WHERE b.key_id = k.key_id AND b.connection_id = p_connection FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'key_not_bound_to_connection'; END IF;
  END IF;
  RETURN k;
END $$;

-- The attestation check (rtgip/3-attest/1), in its check order: shape, freshness, roles, then per expected
-- item key_id, key row, pk_sha256, msg_sha256, sig. p_expected is SQL's own list, built from its own inputs:
-- [{"role","signer","key_id","message","sig","at"}]. Raises the first failing reason; returns nothing.
CREATE OR REPLACE FUNCTION rtgip.v3_attest_check(p_attest jsonb, p_expected jsonb, p_connection text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it jsonb; e jsonb; k rtgip.public_keys%ROWTYPE;
  v_now bigint := floor(extract(epoch FROM rtgip.clock()))::bigint;
BEGIN
  IF jsonb_typeof(p_attest) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(p_attest) x) IS DISTINCT FROM ARRAY['attest','items','verified_at','verifier']
     OR p_attest->'attest' IS DISTINCT FROM to_jsonb('rtgip/3-attest/1'::text)
     OR jsonb_typeof(p_attest->'verifier') IS DISTINCT FROM 'string' OR p_attest->>'verifier' !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_attest->'verified_at') IS DISTINCT FROM 'number'
     OR (p_attest->'verified_at')::text::numeric <> trunc((p_attest->'verified_at')::text::numeric)
     OR abs((p_attest->'verified_at')::text::numeric) > 9007199254740991
     OR jsonb_typeof(p_attest->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'attest_shape';
  END IF;
  FOR it IN SELECT x FROM jsonb_array_elements(p_attest->'items') x LOOP
    IF jsonb_typeof(it) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(it) x) IS DISTINCT FROM ARRAY['key_id','msg_sha256','pk_sha256','role','sig']
       OR jsonb_typeof(it->'role') IS DISTINCT FROM 'string' OR jsonb_typeof(it->'key_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(it->'pk_sha256') IS DISTINCT FROM 'string' OR it->>'pk_sha256' !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(it->'msg_sha256') IS DISTINCT FROM 'string' OR it->>'msg_sha256' !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(it->'sig') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'attest_shape';
    END IF;
  END LOOP;
  IF abs(v_now - (p_attest->>'verified_at')::bigint) > 60 THEN RAISE EXCEPTION 'attest_stale'; END IF;
  IF (SELECT array_agg(x->>'role' ORDER BY x->>'role' COLLATE "C") FROM jsonb_array_elements(p_attest->'items') x)
     IS DISTINCT FROM (SELECT array_agg(x->>'role' ORDER BY x->>'role' COLLATE "C") FROM jsonb_array_elements(p_expected) x) THEN
    RAISE EXCEPTION 'attest_missing';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_expected) WITH ORDINALITY y(x, o) ORDER BY o LOOP
    SELECT x INTO it FROM jsonb_array_elements(p_attest->'items') x WHERE x->>'role' = e->>'role';
    IF it->>'key_id' IS DISTINCT FROM e->>'key_id' THEN RAISE EXCEPTION 'attest_key_mismatch'; END IF;
    k := rtgip.v3_key_row(e->>'key_id', e->>'signer', (e->>'at')::bigint, p_connection);
    IF it->>'pk_sha256' IS DISTINCT FROM k.fingerprint THEN RAISE EXCEPTION 'attest_key_mismatch'; END IF;
    IF it->>'msg_sha256' IS DISTINCT FROM encode(sha256(convert_to(e->>'message', 'UTF8')), 'hex') THEN RAISE EXCEPTION 'attest_msg_mismatch'; END IF;
    IF it->>'sig' IS DISTINCT FROM e->>'sig' OR NOT rtgip.ed25519_sig_shape(e->>'sig') THEN RAISE EXCEPTION 'attest_sig_mismatch'; END IF;
  END LOOP;
END $$;

-- Step g: one evidence row per expected item, after the entry point decided to write. Returns the first id.
CREATE OR REPLACE FUNCTION rtgip.v3_evidence_write(p_entry text, p_attest jsonb, p_expected jsonb, p_connection text,
                                                   p_delivery_id text, p_event_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint; v_n integer;
BEGIN
  WITH ins AS (
    INSERT INTO rtgip.evidence_v3 (entry, role, connection_id, delivery_id, event_id, key_id, pk_sha256, message, msg_sha256, sig, verifier, verified_at)
    SELECT p_entry, x->>'role', p_connection, p_delivery_id, p_event_id, x->>'key_id', k.fingerprint, x->>'message',
           encode(sha256(convert_to(x->>'message', 'UTF8')), 'hex'), x->>'sig', p_attest->>'verifier', (p_attest->>'verified_at')::bigint
      FROM jsonb_array_elements(p_expected) WITH ORDINALITY y(x, o) JOIN rtgip.public_keys k ON k.key_id = x->>'key_id'
     ORDER BY o
    RETURNING id)
  SELECT min(id), count(*) INTO v_id, v_n FROM ins;
  IF v_n IS DISTINCT FROM jsonb_array_length(p_expected) THEN
    RAISE EXCEPTION 'evidence_not_written';
  END IF;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Receipt/3, in the order of verifyReceipt3 / verifyAdmission / evaluateChain: shape and kind table, key row
-- (owner = issuer, valid now and at issued_at), not in the future, the stage when one is required, the delivery
-- binding, then the link to the previous receipt. The signature itself is attested by the caller as role
-- receipt:<n> (or admission), and the attestation also checks the key's binding row for the connection.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rtgip.receipt_shape_v3(p_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb; f text; v_kind text; v_out text; v_gw boolean; v_canon text;
  fields constant text[] := ARRAY['connection_id','delivery_id','envelope_sha256','event_id','issued_at','issuer','key_id','kind','outcome',
    'payload_sha256','prev_receipt_sha256','protocol','receipt_version','recipient','rooftop_id','route','signature','source_app','target_app','tenant_id'];
  strs constant text[] := ARRAY['protocol','kind','event_id','route','source_app','target_app','tenant_id','rooftop_id','connection_id',
    'payload_sha256','envelope_sha256','delivery_id','issuer','recipient','outcome','key_id','signature'];
BEGIN
  BEGIN r := p_text::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid_receipt_shape'; END;
  IF jsonb_typeof(r) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(r) x) IS DISTINCT FROM fields THEN
    RAISE EXCEPTION 'invalid_receipt_shape';
  END IF;
  BEGIN v_canon := rtgip.receipt_canonical(r); EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'invalid_receipt_shape'; END;
  IF p_text IS DISTINCT FROM v_canon THEN RAISE EXCEPTION 'invalid_receipt_shape'; END IF;
  IF r->'protocol' IS DISTINCT FROM to_jsonb('rtgip/3-receipt/3'::text) OR r->'receipt_version' IS DISTINCT FROM '3'::jsonb THEN
    RAISE EXCEPTION 'protocol_mismatch';
  END IF;
  FOREACH f IN ARRAY strs LOOP
    IF jsonb_typeof(r->f) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid_receipt_shape'; END IF;
  END LOOP;
  v_kind := r->>'kind'; v_out := r->>'outcome';
  IF NOT ((v_kind = 'gateway_admission' AND v_out = 'admitted')
       OR (v_kind = 'target_inbox' AND v_out IN ('applied','duplicate','stale_ignored','held','quarantined'))
       OR (v_kind = 'consumer_commit' AND v_out IN ('applied','stale_ignored'))
       OR (v_kind = 'gateway_confirmation' AND v_out = 'delivery_abandoned')) THEN
    RAISE EXCEPTION 'invalid_receipt_shape';
  END IF;
  IF jsonb_typeof(r->'issued_at') IS DISTINCT FROM 'number' OR (r->'issued_at')::text !~ '^(0|[1-9][0-9]{0,15})$'
     OR (r->'issued_at')::text::numeric > 9007199254740991
     OR r->>'payload_sha256' !~ '^[0-9a-f]{64}$' OR r->>'envelope_sha256' !~ '^[0-9a-f]{64}$' OR r->>'delivery_id' !~ '^[0-9a-f]{64}$'
     OR NOT (jsonb_typeof(r->'prev_receipt_sha256') = 'null'
             OR (jsonb_typeof(r->'prev_receipt_sha256') = 'string' AND r->>'prev_receipt_sha256' ~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION 'invalid_receipt_shape';
  END IF;
  IF NOT rtgip.ed25519_sig_shape(r->>'signature') THEN RAISE EXCEPTION 'signature_malformed'; END IF;
  -- Kind table, before any key is consulted.
  v_gw := v_kind IN ('gateway_admission','gateway_confirmation');
  IF r->>'issuer' IS DISTINCT FROM (CASE WHEN v_gw THEN 'gateway' ELSE r->>'target_app' END) THEN RAISE EXCEPTION 'ack_wrong_issuer'; END IF;
  IF r->>'recipient' IS DISTINCT FROM (CASE WHEN v_gw THEN r->>'source_app' ELSE 'gateway' END) THEN RAISE EXCEPTION 'ack_wrong_recipient'; END IF;
  RETURN r;
END $$;

-- verifyReceipt3 without the Ed25519 step: shape, key row, not more than 300 s in the future.
CREATE OR REPLACE FUNCTION rtgip.receipt_check_v3(p_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  r := rtgip.receipt_shape_v3(p_text);
  PERFORM rtgip.v3_key_row(r->>'key_id', r->>'issuer', (r->>'issued_at')::bigint, NULL);
  IF (r->>'issued_at')::bigint > floor(extract(epoch FROM rtgip.clock()))::bigint + 300 THEN RAISE EXCEPTION 'timestamp_out_of_window'; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION rtgip.receipt_verify_v3(p_text text, p_prev text, p_envelope jsonb, p_connection text, p_delivery_id text,
                                                   p_stage text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb; prev jsonb; f text; v_gw boolean; v_required text; want jsonb;
  bound constant text[] := ARRAY['event_id','route','source_app','target_app','tenant_id','rooftop_id','connection_id','payload_sha256',
    'envelope_sha256','delivery_id','issuer','recipient'];
BEGIN
  r := rtgip.receipt_check_v3(p_text);
  IF p_stage IS NOT NULL AND r->>'kind' IS DISTINCT FROM p_stage THEN RAISE EXCEPTION 'ack_wrong_stage'; END IF;
  v_gw := r->>'kind' IN ('gateway_admission','gateway_confirmation');
  want := jsonb_build_object('event_id', p_envelope->>'event_id', 'route', p_envelope->>'route', 'source_app', p_envelope->>'source_app',
    'target_app', p_envelope->>'target_app', 'tenant_id', p_envelope->>'tenant_id', 'rooftop_id', p_envelope->>'rooftop_id',
    'connection_id', p_connection, 'payload_sha256', p_envelope->>'payload_sha256', 'envelope_sha256', rtgip.envelope_sha(p_envelope),
    'delivery_id', p_delivery_id, 'issuer', CASE WHEN v_gw THEN 'gateway' ELSE p_envelope->>'target_app' END,
    'recipient', CASE WHEN v_gw THEN p_envelope->>'source_app' ELSE 'gateway' END);
  FOREACH f IN ARRAY bound LOOP
    IF r->>f IS DISTINCT FROM want->>f THEN RAISE EXCEPTION 'ack_wrong_%', f; END IF;
  END LOOP;
  IF rtgip.deliverable_reason(p_connection, p_envelope) IS NOT NULL THEN RAISE EXCEPTION 'ack_connection_not_authorized'; END IF;
  IF p_prev IS NULL THEN
    IF r->>'kind' <> 'gateway_admission' OR jsonb_typeof(r->'prev_receipt_sha256') <> 'null' THEN RAISE EXCEPTION 'ack_unexpected_previous_stage'; END IF;
  ELSE
    prev := p_prev::jsonb;
    v_required := CASE WHEN r->>'kind' = 'consumer_commit' THEN 'target_inbox' ELSE 'gateway_admission' END;
    IF r->>'kind' = 'gateway_admission' OR prev->>'kind' IS DISTINCT FROM v_required
       OR r->>'prev_receipt_sha256' IS DISTINCT FROM encode(sha256(convert_to(p_prev, 'UTF8')), 'hex') THEN
      RAISE EXCEPTION 'ack_missing_previous_stage';
    END IF;
    IF (r->>'issued_at')::bigint < (prev->>'issued_at')::bigint THEN RAISE EXCEPTION 'ack_stage_time_reversed'; END IF;
    IF r->>'kind' = 'consumer_commit' AND (prev->>'outcome' IN ('held','quarantined')
       OR (prev->>'outcome' <> 'duplicate' AND prev->>'outcome' <> r->>'outcome')) THEN
      RAISE EXCEPTION 'ack_commit_without_effect';
    END IF;
  END IF;
  RETURN r;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- The router's version gate, for both verifiers (granted to rtgip_inbox_receiver). It resolves the active
-- connection from the envelope as inbox_admit does; NULL = the presented protocol may proceed. A body that
-- names no single active connection returns NULL: the verifier then refuses with its own inherited reason.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rtgip.connection_gate(p_body text, p_presented text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; c rtgip.connections%ROWTYPE; v_n integer;
BEGIN
  BEGIN e := p_body::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END;
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_n FROM rtgip.connections x
   WHERE x.source_app = e->>'source_app' AND x.target_app = e->>'target_app' AND x.tenant_id = e->>'tenant_id'
     AND x.status = 'active' AND (e->>'rooftop_id') = ANY (x.rooftop_ids);
  IF v_n <> 1 THEN RETURN NULL; END IF;
  SELECT * INTO c FROM rtgip.connections x
   WHERE x.source_app = e->>'source_app' AND x.target_app = e->>'target_app' AND x.tenant_id = e->>'tenant_id'
     AND x.status = 'active' AND (e->>'rooftop_id') = ANY (x.rooftop_ids);
  RETURN rtgip.gate_verdict(c.accept_protocols, c.v3_added_at, c.v2_accept_until, p_presented,
                            floor(extract(epoch FROM rtgip.clock()))::bigint);
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- rtgip.inbox_admit_v3: the AR-1 inbox_admit with the HMAC replaced by the attestation (roles forward,
-- admission, origin), keys from rtgip.public_keys, the version gate, the mandatory admission and origin, and
-- evidence. p_admission and p_origin are the raw rtgip-admission-receipt and rtgip-origin header values
-- (base64url); SQL decodes them itself. Every check, admission and origin included, runs before the first
-- write (the nonce claim). Nonce claim, inbox engine, effect pass and stored-receipt reuse are the package's.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rtgip.inbox_admit_v3(p_headers jsonb, p_body text, p_admission text, p_origin text, p_attest jsonb,
                                                p_consumer_reject jsonb DEFAULT NULL)
RETURNS TABLE (admission_id bigint, event_id uuid, outcome text, reason text, committed boolean, committed_outcome text, connection_id text, envelope jsonb,
               delivery_id text, issued_at bigint, stored_receipts text[], replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_local text := rtgip.local_app();
  v_now bigint := floor(extract(epoch FROM rtgip.clock()))::bigint;
  h_key text := left(p_headers->>'rtgip-key-id', 128);
  h_signer text := p_headers->>'rtgip-signer';
  h_ts text := p_headers->>'rtgip-timestamp';
  h_nonce text := p_headers->>'rtgip-nonce';
  h_scope text := p_headers->>'rtgip-scope';
  h_sig text := p_headers->>'rtgip-signature';
  cat rtgip.event_catalog%ROWTYPE; c rtgip.connections%ROWTYPE;
  e jsonb; v_sha text; v_claim text; v_conn text; v_n integer; v_why text; v_gate text;
  v_adm_text text; v_ar jsonb; v_org_text text; o jsonb; v_expected jsonb; v_ev bigint;
  v_adm bigint; v_rej_event uuid; v_rej_reason text; v_first text; v_rej_seen boolean := false; rec record;
  v_did text; v_adig text; v_issued bigint; d rtgip.inbox_deliveries%ROWTYPE; v_have_d boolean := false; v_is_first boolean := true;
  v_first_commit text; v_first_reason text;
  shape constant text[] := ARRAY['aggregate','causation_id','classification','correlation_id','emitted_at','event_id','event_type',
    'occurred_at','origin','payload','payload_sha256','protocol','purpose','rooftop_id','route','schema_version','source_app','target_app','tenant_id','vehicle'];
BEGIN
  BEGIN
    IF v_local IS NULL THEN RAISE EXCEPTION 'receiver_not_local_app'; END IF;
    IF jsonb_typeof(p_headers) IS DISTINCT FROM 'object' OR p_headers->>'rtgip-protocol' IS DISTINCT FROM 'rtgip/3' THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
    IF h_key IS NULL OR h_signer IS NULL OR h_ts IS NULL OR h_nonce IS NULL OR h_scope IS NULL OR h_sig IS NULL THEN RAISE EXCEPTION 'missing_headers'; END IF;
    IF left(h_sig, 7) <> 'rtgip3=' THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
    IF h_nonce !~ '^[A-Za-z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'invalid_nonce'; END IF;
    PERFORM rtgip.v3_key_row(h_key, h_signer, NULL, NULL);
    IF h_signer <> 'gateway' THEN RAISE EXCEPTION 'signer_not_gateway'; END IF;
    IF h_ts !~ '^(0|[1-9][0-9]{0,11})$' OR abs(v_now - h_ts::bigint) > 300 THEN RAISE EXCEPTION 'timestamp_out_of_window'; END IF;
    IF p_body IS NULL OR octet_length(convert_to(p_body, 'UTF8')) > 65536 THEN RAISE EXCEPTION 'body_too_large'; END IF;
    IF left(p_body, 1) = chr(65279) THEN RAISE EXCEPTION 'malformed_json'; END IF;
    IF NOT rtgip.ed25519_sig_shape(substr(h_sig, 8)) THEN RAISE EXCEPTION 'signature_malformed'; END IF;
    v_sha := encode(sha256(convert_to(p_body, 'UTF8')), 'hex');

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
    IF h_scope IS DISTINCT FROM rtgip.scope_of(e) THEN RAISE EXCEPTION 'scope_mismatch'; END IF;
    IF encode(sha256(convert_to(rtgip.canonical_json(e->'payload'), 'UTF8')), 'hex') IS DISTINCT FROM e->>'payload_sha256' THEN
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
    SELECT min(x.connection_id), count(*) INTO v_conn, v_n FROM rtgip.connections x
      WHERE x.source_app = e->>'source_app' AND x.target_app = e->>'target_app' AND x.tenant_id = e->>'tenant_id' AND x.status = 'active'
        AND (e->>'rooftop_id') = ANY (x.rooftop_ids);
    IF v_n = 0 THEN
      IF NOT EXISTS (SELECT 1 FROM rtgip.connections x WHERE x.source_app = e->>'source_app' AND x.target_app = e->>'target_app' AND x.tenant_id = e->>'tenant_id') THEN
        RAISE EXCEPTION 'no_connection_for_tenant';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM rtgip.connections x WHERE x.source_app = e->>'source_app' AND x.target_app = e->>'target_app' AND x.tenant_id = e->>'tenant_id' AND x.status = 'active') THEN
        RAISE EXCEPTION 'connection_revoked';
      END IF;
      RAISE EXCEPTION 'rooftop_not_granted';
    END IF;
    IF v_n > 1 THEN RAISE EXCEPTION 'ambiguous_connection'; END IF;
    v_why := rtgip.deliverable_reason(v_conn, e);
    IF v_why = 'connection_mismatch' THEN RAISE EXCEPTION 'rooftop_not_granted'; END IF;
    IF v_why IS NOT NULL THEN RAISE EXCEPTION '%', v_why; END IF;
    SELECT * INTO c FROM rtgip.connections x WHERE x.connection_id = v_conn;
    v_gate := rtgip.gate_verdict(c.accept_protocols, c.v3_added_at, c.v2_accept_until, 'rtgip/3', v_now);
    IF v_gate IS NOT NULL THEN RAISE EXCEPTION '%', v_gate; END IF;
    PERFORM rtgip.v3_key_row(h_key, h_signer, h_ts::bigint, v_conn);

    -- rtgip-admission-receipt: the Gateway's admission for this very delivery (verifyAdmission).
    IF p_admission IS NULL OR p_admission = '' THEN RAISE EXCEPTION 'admission_missing'; END IF;
    BEGIN v_adm_text := rtgip.b64url_text(p_admission); EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid_receipt_shape'; END;
    v_did := rtgip.delivery_identity_v3(v_conn, e);
    v_ar := rtgip.receipt_verify_v3(v_adm_text, NULL, e, v_conn, v_did, 'gateway_admission');
    v_adig := encode(sha256(convert_to(v_adm_text, 'UTF8')), 'hex');

    -- rtgip-origin: the source's own H1 signature over this exact body (verifyOrigin).
    IF p_origin IS NULL OR p_origin = '' THEN RAISE EXCEPTION 'origin_missing'; END IF;
    BEGIN
      v_org_text := rtgip.b64url_text(p_origin);
      o := v_org_text::jsonb;
      IF jsonb_typeof(o) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(o) x) IS DISTINCT FROM ARRAY['key_id','nonce','scope','signature','signer','timestamp']
         OR rtgip.canonical_json(o) IS DISTINCT FROM v_org_text THEN
        RAISE EXCEPTION 'origin_mismatch';
      END IF;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'origin_mismatch';
    END;
    IF jsonb_typeof(o->'timestamp') IS DISTINCT FROM 'number' OR (o->'timestamp')::text !~ '^(0|[1-9][0-9]{0,15})$'
       OR EXISTS (SELECT 1 FROM unnest(ARRAY['key_id','nonce','scope','signature','signer']) f WHERE jsonb_typeof(o->f) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'origin_mismatch';
    END IF;
    IF o->>'signer' IS DISTINCT FROM e->>'source_app' THEN RAISE EXCEPTION 'origin_mismatch'; END IF;
    IF o->>'scope' IS DISTINCT FROM h_scope OR o->>'scope' IS DISTINCT FROM rtgip.scope_of(e) THEN RAISE EXCEPTION 'origin_mismatch'; END IF;
    IF v_now - (o->>'timestamp')::bigint > 604800 OR (o->>'timestamp')::bigint - v_now > 300 THEN RAISE EXCEPTION 'origin_too_old'; END IF;
    IF o->>'nonce' !~ '^[A-Za-z0-9_-]{16,128}$' THEN RAISE EXCEPTION 'origin_mismatch'; END IF;
    PERFORM rtgip.v3_key_row(o->>'key_id', e->>'source_app', (o->>'timestamp')::bigint, v_conn);
    IF NOT rtgip.ed25519_sig_shape(o->>'signature') THEN RAISE EXCEPTION 'signature_malformed'; END IF;

    SELECT * INTO d FROM rtgip.inbox_deliveries x WHERE x.delivery_id = v_did;
    v_have_d := FOUND;
    IF v_have_d AND d.admission_digest <> v_adig THEN RAISE EXCEPTION 'admission_digest_mismatch'; END IF;
    IF p_consumer_reject IS NOT NULL THEN
      BEGIN v_rej_event := (p_consumer_reject->>'event_id')::uuid; EXCEPTION WHEN others THEN v_rej_event := NULL; END;
      v_rej_reason := left(p_consumer_reject->>'reason', 180);
      IF v_rej_event IS NULL OR v_rej_reason IS NULL OR v_rej_reason = '' THEN RAISE EXCEPTION 'invalid_consumer_reject'; END IF;
    END IF;

    v_expected := jsonb_build_array(
      jsonb_build_object('role', 'forward', 'signer', 'gateway', 'key_id', h_key, 'at', h_ts::bigint, 'sig', substr(h_sig, 8),
                         'message', rtgip.preimage_v3(h_key, h_signer, h_ts, h_nonce, h_scope, v_sha)),
      jsonb_build_object('role', 'admission', 'signer', 'gateway', 'key_id', v_ar->>'key_id', 'at', (v_ar->>'issued_at')::bigint,
                         'sig', v_ar->>'signature', 'message', rtgip.receipt_message_v3(v_ar)),
      jsonb_build_object('role', 'origin', 'signer', e->>'source_app', 'key_id', o->>'key_id', 'at', (o->>'timestamp')::bigint,
                         'sig', o->>'signature', 'message', rtgip.preimage_v3(o->>'key_id', o->>'signer', (o->'timestamp')::text,
                                                                              o->>'nonce', o->>'scope', v_sha)));
    PERFORM rtgip.v3_attest_check(p_attest, v_expected, v_conn);
  EXCEPTION WHEN raise_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
    INSERT INTO rtgip.audit_log (actor, action, detail)
    VALUES ('inbox', 'admission_rejected', jsonb_build_object('stage', 'verify_v3', 'reason', SQLERRM, 'key_id', h_key, 'body_sha256', v_sha));
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

  v_ev := rtgip.v3_evidence_write('inbox_admit_v3', p_attest, v_expected, v_conn, v_did, (e->>'event_id')::uuid);
  v_adm := nextval(pg_get_serial_sequence('rtgip.admissions', 'id'));
  IF v_have_d AND d.outcome <> 'held' THEN
    admission_id := v_adm; event_id := (e->>'event_id')::uuid; outcome := d.outcome; reason := d.reason;
    committed := d.commit_outcome IS NOT NULL; committed_outcome := d.commit_outcome; connection_id := v_conn; envelope := e;
    delivery_id := v_did; issued_at := d.issued_at; stored_receipts := d.receipts; replayed := true;
    RETURN NEXT;
    INSERT INTO rtgip.admissions (id, key_id, nonce, body_sha256, event_id, connection_id, signer, outcome, consumer_reject, protocol, evidence_id)
    VALUES (v_adm, h_key, h_nonce, v_sha, (e->>'event_id')::uuid, v_conn, h_signer, d.outcome, NULL, 'rtgip/3', v_ev);
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES ('inbox', 'admitted:' || d.outcome, (e->>'event_id')::uuid,
            jsonb_build_object('admission_id', v_adm, 'connection_id', v_conn, 'key_id', h_key, 'nonce_claim', v_claim, 'delivery_id', v_did,
                               'stored', true, 'protocol', 'rtgip/3', 'evidence_id', v_ev));
    RETURN;
  END IF;
  v_issued := CASE WHEN v_have_d THEN d.issued_at ELSE v_now END;
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
  INSERT INTO rtgip.inbox_deliveries (delivery_id, tenant_id, origin_app, event_id, connection_id, admission_digest, issued_at, outcome, commit_outcome, reason, envelope, protocol)
  VALUES (v_did, e->>'tenant_id', e#>>'{origin,app}', (e->>'event_id')::uuid, v_conn, v_adig, v_issued, v_first, v_first_commit, v_first_reason, e, 'rtgip/3')
  ON CONFLICT (delivery_id) DO UPDATE SET outcome = EXCLUDED.outcome, commit_outcome = EXCLUDED.commit_outcome, reason = EXCLUDED.reason;
  UPDATE rtgip.inbox i SET delivery_id = v_did, admission_digest = v_adig, issued_at = v_issued, protocol = 'rtgip/3'
    WHERE i.tenant_id = e->>'tenant_id' AND i.origin_app = e#>>'{origin,app}' AND i.event_id = (e->>'event_id')::uuid AND i.delivery_id IS NULL;
  INSERT INTO rtgip.admissions (id, key_id, nonce, body_sha256, event_id, connection_id, signer, outcome, consumer_reject, protocol, evidence_id)
  VALUES (v_adm, h_key, h_nonce, v_sha, (e->>'event_id')::uuid, v_conn, h_signer, v_first, v_rej_reason, 'rtgip/3', v_ev);
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES ('inbox', 'admitted:' || v_first, (e->>'event_id')::uuid,
          jsonb_build_object('admission_id', v_adm, 'connection_id', v_conn, 'key_id', h_key, 'nonce_claim', v_claim, 'delivery_id', v_did,
                             'protocol', 'rtgip/3', 'evidence_id', v_ev));
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- rtgip.inbox_record_receipts_v3: persist this target's own signed receipts for a v3 delivery (roles
-- receipt:0 target_inbox, receipt:1 consumer_commit exactly when the decision committed), chained from the
-- stored admission digest, signer = local_app. Identical texts are idempotent; other bytes raise.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rtgip.inbox_record_receipts_v3(p_delivery_id text, p_receipts text[], p_attest jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d rtgip.inbox_deliveries%ROWTYPE; r jsonb; i integer; n integer; v_want integer; v_prev_digest text; v_kind text; v_outcome text;
  v_expected jsonb := '[]'::jsonb; v_ev bigint; v_local text := rtgip.local_app();
BEGIN
  SELECT * INTO d FROM rtgip.inbox_deliveries x WHERE x.delivery_id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_delivery'; END IF;
  IF d.protocol <> 'rtgip/3' OR NOT rtgip.receipts_protocol_ok(p_receipts, 'rtgip/3-receipt/3') THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
  IF v_local IS NULL OR d.envelope->>'target_app' IS DISTINCT FROM v_local THEN RAISE EXCEPTION 'receiver_not_local_app'; END IF;
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
    r := rtgip.receipt_shape_v3(p_receipts[i]);
    v_kind := CASE i WHEN 1 THEN 'target_inbox' ELSE 'consumer_commit' END;
    v_outcome := CASE i WHEN 1 THEN d.outcome ELSE d.commit_outcome END;
    IF r->>'kind' IS DISTINCT FROM v_kind OR r->>'outcome' IS DISTINCT FROM v_outcome
       OR r->>'delivery_id' IS DISTINCT FROM d.delivery_id OR r->>'event_id' IS DISTINCT FROM d.event_id::text
       OR r->>'connection_id' IS DISTINCT FROM d.connection_id OR r->>'issuer' IS DISTINCT FROM v_local
       OR r->>'recipient' IS DISTINCT FROM 'gateway' OR r->>'envelope_sha256' IS DISTINCT FROM rtgip.envelope_sha(d.envelope)
       OR r->>'payload_sha256' IS DISTINCT FROM d.envelope->>'payload_sha256'
       OR r->>'tenant_id' IS DISTINCT FROM d.envelope->>'tenant_id' OR r->>'rooftop_id' IS DISTINCT FROM d.envelope->>'rooftop_id'
       OR r->>'route' IS DISTINCT FROM d.envelope->>'route' OR r->>'source_app' IS DISTINCT FROM d.envelope->>'source_app'
       OR r->>'target_app' IS DISTINCT FROM d.envelope->>'target_app'
       OR (r->>'issued_at') IS DISTINCT FROM d.issued_at::text THEN
      RAISE EXCEPTION 'receipt_not_bound_to_delivery';
    END IF;
    IF r->>'prev_receipt_sha256' IS DISTINCT FROM v_prev_digest THEN RAISE EXCEPTION 'ack_missing_previous_stage'; END IF;
    v_expected := v_expected || jsonb_build_array(jsonb_build_object('role', 'receipt:' || (i - 1), 'signer', v_local, 'key_id', r->>'key_id',
      'at', (r->>'issued_at')::bigint, 'sig', r->>'signature', 'message', rtgip.receipt_message_v3(r)));
    v_prev_digest := encode(sha256(convert_to(p_receipts[i], 'UTF8')), 'hex');
  END LOOP;
  PERFORM rtgip.v3_attest_check(p_attest, v_expected, d.connection_id);
  UPDATE rtgip.inbox_deliveries SET receipts = p_receipts WHERE delivery_id = p_delivery_id;
  v_ev := rtgip.v3_evidence_write('inbox_record_receipts_v3', p_attest, v_expected, d.connection_id, d.delivery_id, d.event_id);
  INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
  VALUES ('inbox', 'receipts_stored', d.event_id, jsonb_build_object('delivery_id', d.delivery_id, 'count', n, 'protocol', 'rtgip/3', 'evidence_id', v_ev));
  RETURN 'recorded';
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- rtgip.outbox_advance_v3: the source chain rule for a row pinned to rtgip/3, under the caller's lease.
--   deliver lease: exactly [adm] -> gateway_admitted.
--   confirm lease: the receipt-query chain; its first element equals the stored admission byte for byte.
--     [adm] -> pending:target_inbox_pending; [adm, inbox(held)] -> pending:target_held_awaiting_predecessor;
--     [adm, inbox(applied|duplicate|stale_ignored)] -> pending:consumer_commit_pending;
--     [adm, inbox(quarantined)] -> target_quarantined; [adm, inbox, commit] -> consumer_committed;
--     [adm, confirmation(delivery_abandoned)] -> dead_letter (abandoned).
-- Every link: receipt_verify_v3 plus attestation role receipt:<n> with signer = issuer by the kind table, at
-- issued_at. Same result vocabulary as rtgip.outbox_advance; a row pinned to rtgip/2 is rejected:protocol_mismatch.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rtgip.outbox_advance_v3(p_event_id uuid, p_worker text, p_generation integer, p_receipts text[], p_attest jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o rtgip.outbox%ROWTYPE; r jsonb; i integer; n integer; v_prev text; v_to text; v_pending text; v_all jsonb := '[]'::jsonb;
  v_expected jsonb := '[]'::jsonb; v_ev bigint;
BEGIN
  SELECT * INTO o FROM rtgip.outbox WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_event'; END IF;
  IF o.lease_owner IS DISTINCT FROM p_worker OR o.lease_generation IS DISTINCT FROM p_generation OR o.lease_action IS NULL
     OR o.state NOT IN ('in_flight','gateway_admitted') THEN
    RAISE EXCEPTION 'lost_lease';
  END IF;
  BEGIN
    IF o.protocol IS DISTINCT FROM 'rtgip/3' OR o.delivery_id_v3 IS NULL THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
    IF NOT rtgip.receipts_protocol_ok(p_receipts, 'rtgip/3-receipt/3') THEN RAISE EXCEPTION 'protocol_mismatch'; END IF;
    n := coalesce(cardinality(p_receipts), 0);
    IF n < 1 OR n > 3 THEN RAISE EXCEPTION 'chain_shape'; END IF;
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
      r := rtgip.receipt_verify_v3(p_receipts[i], v_prev, o.envelope, o.connection_id, o.delivery_id_v3);
      v_prev := p_receipts[i];
      v_all := v_all || jsonb_build_array(r);
      v_expected := v_expected || jsonb_build_array(jsonb_build_object('role', 'receipt:' || (i - 1), 'signer', r->>'issuer',
        'key_id', r->>'key_id', 'at', (r->>'issued_at')::bigint, 'sig', r->>'signature', 'message', rtgip.receipt_message_v3(r)));
    END LOOP;
    IF n = 2 AND v_all->1->>'kind' = 'gateway_confirmation' THEN
      v_to := 'dead_letter';
    ELSIF n >= 2 AND v_all->1->>'kind' IS DISTINCT FROM 'target_inbox' THEN
      RAISE EXCEPTION 'chain_shape';
    ELSIF n = 2 AND v_all->1->>'outcome' = 'quarantined' THEN
      v_to := 'target_quarantined';
    ELSIF n = 2 THEN
      v_pending := CASE WHEN v_all->1->>'outcome' = 'held' THEN 'pending:target_held_awaiting_predecessor' ELSE 'pending:consumer_commit_pending' END;
    ELSIF n = 3 AND v_all->2->>'kind' = 'consumer_commit' THEN
      v_to := 'consumer_committed';
    ELSIF n = 3 THEN
      RAISE EXCEPTION 'chain_shape';
    END IF;
    PERFORM rtgip.v3_attest_check(p_attest, v_expected, o.connection_id);

    IF o.lease_action = 'deliver' THEN
      INSERT INTO rtgip.receipts (event_id, attempt, kind, issuer, outcome, key_id, signing_text, signature, protocol)
      VALUES (o.event_id, o.attempts, 'gateway_admission', v_all->0->>'issuer', 'admitted', v_all->0->>'key_id',
              rtgip.receipt_canonical((v_all->0) - 'signature'), v_all->0->>'signature', 'rtgip/3')
      ON CONFLICT DO NOTHING;
      UPDATE rtgip.outbox SET state = 'gateway_admitted', receipts = v_all, last_error = NULL,
        lease_owner = NULL, lease_until = NULL, lease_action = NULL, next_attempt_at = now() + interval '5 seconds'
      WHERE event_id = o.event_id;
      v_to := 'gateway_admitted';
    ELSE
      IF n = 1 THEN RETURN 'pending:target_inbox_pending'; END IF;
      IF v_pending IS NOT NULL THEN RETURN v_pending; END IF;
      FOR i IN 2 .. n LOOP
        INSERT INTO rtgip.receipts (event_id, attempt, kind, issuer, outcome, key_id, signing_text, signature, protocol)
        VALUES (o.event_id, o.attempts, v_all->(i-1)->>'kind', v_all->(i-1)->>'issuer', v_all->(i-1)->>'outcome', v_all->(i-1)->>'key_id',
                rtgip.receipt_canonical((v_all->(i-1)) - 'signature'), v_all->(i-1)->>'signature', 'rtgip/3')
        ON CONFLICT DO NOTHING;
      END LOOP;
      UPDATE rtgip.outbox SET state = v_to, receipts = v_all, last_error = NULL,
        lease_owner = NULL, lease_until = NULL, lease_action = NULL
      WHERE event_id = o.event_id;
    END IF;
    v_ev := rtgip.v3_evidence_write('outbox_advance_v3', p_attest, v_expected, o.connection_id, o.delivery_id_v3, o.event_id);
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES (p_worker, 'advance:' || v_to, o.event_id, jsonb_build_object('receipts', n, 'attempt', o.attempts, 'generation', p_generation,
                                                                         'protocol', 'rtgip/3', 'evidence_id', v_ev));
    RETURN v_to;
  EXCEPTION WHEN raise_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
    INSERT INTO rtgip.audit_log (actor, action, event_id, detail)
    VALUES (coalesce(p_worker, '?'), 'receipt_rejected', p_event_id, jsonb_build_object('reason', SQLERRM, 'generation', p_generation, 'protocol', 'rtgip/3'));
    RETURN 'rejected:' || SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Least privilege. Deny everything on the new objects, then grant one duty per role.
-- ---------------------------------------------------------------------------------------------------------
DO $g$
DECLARE f text; t text; r text;
  fns constant text[] := ARRAY[
    'rtgip.ed25519_powmod(numeric,numeric)', 'rtgip.ed25519_le(bytea)', 'rtgip.ed25519_pk_usable(text)', 'rtgip.ed25519_sig_shape(text)',
    'rtgip.evidence_v3_immutable()', 'rtgip.public_keys_guard()', 'rtgip.public_keys_no_truncate()', 'rtgip.connections_protocol_guard()',
    'rtgip.gate_verdict(text[],bigint,bigint,text,bigint)', 'rtgip.delivery_identity_v3(text,jsonb)', 'rtgip.outbox_protocol_guard()',
    'rtgip.inbox_protocol_guard()', 'rtgip.inbox_deliveries_protocol_guard()', 'rtgip.admissions_protocol_gate()', 'rtgip.scope_of(jsonb)',
    'rtgip.preimage_v3(text,text,text,text,text,text)', 'rtgip.receipt_message_v3(jsonb)', 'rtgip.receipts_protocol_ok(text[],text)', 'rtgip.b64url_text(text)',
    'rtgip.v3_key_row(text,text,bigint,text)', 'rtgip.v3_attest_check(jsonb,jsonb,text)',
    'rtgip.v3_evidence_write(text,jsonb,jsonb,text,text,uuid)', 'rtgip.receipt_shape_v3(text)', 'rtgip.receipt_check_v3(text)',
    'rtgip.receipt_verify_v3(text,text,jsonb,text,text,text)', 'rtgip.connection_gate(text,text)',
    'rtgip.inbox_admit_v3(jsonb,text,text,text,jsonb,jsonb)', 'rtgip.inbox_record_receipts_v3(text,text[],jsonb)',
    'rtgip.outbox_advance_v3(uuid,text,integer,text[],jsonb)'];
  tabs constant text[] := ARRAY['public_keys','public_key_bindings','evidence_v3'];
  roles text[];
BEGIN
  SELECT array_agg(rolname ORDER BY rolname) INTO roles FROM pg_roles
   WHERE rolname IN ('anon','authenticated','service_role','rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator')
      OR rolname LIKE 'sandbox\_exec%';
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('ALTER TABLE rtgip.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON rtgip.%I FROM PUBLIC', t);
  END LOOP;
  EXECUTE 'REVOKE ALL ON SEQUENCE rtgip.evidence_v3_id_seq FROM PUBLIC';
  FOREACH f IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  FOREACH r IN ARRAY coalesce(roles, '{}') LOOP
    FOREACH t IN ARRAY tabs LOOP
      EXECUTE format('REVOKE ALL ON rtgip.%I FROM %I', t, r);
    END LOOP;
    EXECUTE format('REVOKE ALL ON SEQUENCE rtgip.evidence_v3_id_seq FROM %I', r);
    FOREACH f IN ARRAY fns LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
    END LOOP;
  END LOOP;
  -- No platform or sandbox role keeps anything in the rtgip schema (hosted default ACLs included).
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') OR rolname LIKE 'sandbox\_exec%' LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA rtgip FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA rtgip FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip FROM %I', r);
    EXECUTE format('REVOKE ALL ON SCHEMA rtgip FROM %I', r);
  END LOOP;
END $g$;

GRANT EXECUTE ON FUNCTION rtgip.inbox_admit_v3(jsonb, text, text, text, jsonb, jsonb) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.inbox_record_receipts_v3(text, text[], jsonb) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.connection_gate(text, text) TO rtgip_inbox_receiver;
GRANT EXECUTE ON FUNCTION rtgip.outbox_advance_v3(uuid, text, integer, text[], jsonb) TO rtgip_dispatcher;
GRANT SELECT ON rtgip.public_keys, rtgip.public_key_bindings, rtgip.evidence_v3 TO rtgip_operator;

DO $p$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public_keys','public_key_bindings','evidence_v3'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'rtgip' AND tablename = t AND policyname = 'operator_read') THEN
      EXECUTE format('CREATE POLICY operator_read ON rtgip.%I FOR SELECT TO rtgip_operator USING (true)', t);
    END IF;
  END LOOP;
END $p$;

COMMENT ON TABLE rtgip.evidence_v3 IS '{"version":"AR3-APP-r1","contract":"rtgip/3-contract-freeze/1","attest":"rtgip/3-attest/1"}';
COMMENT ON TABLE rtgip.public_key_bindings IS 'rtgip/3 per-connection key binding rows: a key verifies for a connection only while its row exists.';

NOTIFY pgrst, 'reload schema';
