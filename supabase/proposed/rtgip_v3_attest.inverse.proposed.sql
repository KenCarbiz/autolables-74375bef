-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- Inverse of rtgip_v3_attest.proposed.sql: back to the rtgip/2 delivery package plus AR-1, byte for byte in
-- every rtgip/2 object. It refuses while any rtgip/3 state exists (a key row, evidence, a connection that
-- sends or accepts rtgip/3, or a row recorded under rtgip/3), because removing it would destroy evidence or
-- strand a delivery. Idempotent: a rerun after success is a no-op.

DO $stop$
DECLARE v_rows boolean;
BEGIN
  IF to_regclass('rtgip.evidence_v3') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM rtgip.evidence_v3)' INTO v_rows;
    IF v_rows THEN RAISE EXCEPTION 'rtgip_v3_inverse_refused: rtgip.evidence_v3 has rows'; END IF;
  END IF;
  IF to_regclass('rtgip.public_keys') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM rtgip.public_keys)' INTO v_rows;
    IF v_rows THEN RAISE EXCEPTION 'rtgip_v3_inverse_refused: rtgip.public_keys has rows (run the K5-v3 inverse first)'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'rtgip.connections'::regclass AND attname = 'send_protocol' AND NOT attisdropped) THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM rtgip.connections WHERE send_protocol <> 'rtgip/2' OR accept_protocols <> '{rtgip/2}'
                                OR v3_added_at IS NOT NULL OR v2_accept_until IS NOT NULL)$q$ INTO v_rows;
    IF v_rows THEN RAISE EXCEPTION 'rtgip_v3_inverse_refused: a connection carries rtgip/3 protocol state'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'rtgip.outbox'::regclass AND attname = 'protocol' AND NOT attisdropped) THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM rtgip.outbox WHERE protocol = 'rtgip/3')$q$ INTO v_rows;
    IF v_rows THEN RAISE EXCEPTION 'rtgip_v3_inverse_refused: an outbox row is pinned to rtgip/3'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'rtgip.receipts'::regclass AND attname = 'protocol' AND NOT attisdropped) THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM rtgip.receipts WHERE protocol = 'rtgip/3') OR EXISTS (SELECT 1 FROM rtgip.admissions WHERE protocol = 'rtgip/3')
                OR EXISTS (SELECT 1 FROM rtgip.inbox WHERE protocol = 'rtgip/3') OR EXISTS (SELECT 1 FROM rtgip.inbox_deliveries WHERE protocol = 'rtgip/3')$q$ INTO v_rows;
    IF v_rows THEN RAISE EXCEPTION 'rtgip_v3_inverse_refused: rows were recorded under rtgip/3'; END IF;
  END IF;
END $stop$;

DROP FUNCTION IF EXISTS rtgip.outbox_advance_v3(uuid, text, integer, text[], jsonb);
DROP FUNCTION IF EXISTS rtgip.inbox_record_receipts_v3(text, text[], jsonb);
DROP FUNCTION IF EXISTS rtgip.inbox_admit_v3(jsonb, text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS rtgip.connection_gate(text, text);
DROP FUNCTION IF EXISTS rtgip.receipt_verify_v3(text, text, jsonb, text, text, text);
DROP FUNCTION IF EXISTS rtgip.receipt_check_v3(text);
DROP FUNCTION IF EXISTS rtgip.receipt_shape_v3(text);
DROP FUNCTION IF EXISTS rtgip.v3_evidence_write(text, jsonb, jsonb, text, text, uuid);
DROP FUNCTION IF EXISTS rtgip.v3_attest_check(jsonb, jsonb, text);
DROP FUNCTION IF EXISTS rtgip.v3_key_row(text, text, bigint, text);
DROP FUNCTION IF EXISTS rtgip.b64url_text(text);
DROP FUNCTION IF EXISTS rtgip.receipts_protocol_ok(text[], text);
DROP FUNCTION IF EXISTS rtgip.receipt_message_v3(jsonb);
DROP FUNCTION IF EXISTS rtgip.preimage_v3(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS rtgip.scope_of(jsonb);

DROP TRIGGER IF EXISTS admissions_protocol_gate ON rtgip.admissions;
DROP TRIGGER IF EXISTS inbox_deliveries_protocol_guard ON rtgip.inbox_deliveries;
DROP TRIGGER IF EXISTS inbox_protocol_guard ON rtgip.inbox;
DROP TRIGGER IF EXISTS outbox_protocol_guard ON rtgip.outbox;
DROP TRIGGER IF EXISTS connections_protocol_guard ON rtgip.connections;
DROP FUNCTION IF EXISTS rtgip.admissions_protocol_gate();
DROP FUNCTION IF EXISTS rtgip.inbox_deliveries_protocol_guard();
DROP FUNCTION IF EXISTS rtgip.inbox_protocol_guard();
DROP FUNCTION IF EXISTS rtgip.outbox_protocol_guard();
DROP FUNCTION IF EXISTS rtgip.connections_protocol_guard();

ALTER TABLE rtgip.receipts DROP CONSTRAINT IF EXISTS receipts_signature_check;
ALTER TABLE rtgip.receipts DROP COLUMN IF EXISTS protocol;
DO $sig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rtgip.receipts'::regclass AND conname = 'receipts_signature_check') THEN
    ALTER TABLE rtgip.receipts ADD CONSTRAINT receipts_signature_check CHECK (signature ~ '^[0-9a-f]{64}$');
  END IF;
END $sig$;
ALTER TABLE rtgip.admissions DROP COLUMN IF EXISTS evidence_id;
ALTER TABLE rtgip.admissions DROP COLUMN IF EXISTS protocol;
ALTER TABLE rtgip.inbox DROP COLUMN IF EXISTS protocol;
ALTER TABLE rtgip.inbox_deliveries DROP COLUMN IF EXISTS protocol;
ALTER TABLE rtgip.outbox DROP CONSTRAINT IF EXISTS outbox_v3_identity_check;
ALTER TABLE rtgip.outbox DROP COLUMN IF EXISTS delivery_id_v3;
ALTER TABLE rtgip.outbox DROP COLUMN IF EXISTS protocol;
DROP FUNCTION IF EXISTS rtgip.delivery_identity_v3(text, jsonb);
DROP FUNCTION IF EXISTS rtgip.gate_verdict(text[], bigint, bigint, text, bigint);
ALTER TABLE rtgip.connections DROP CONSTRAINT IF EXISTS connections_v3_added_check;
ALTER TABLE rtgip.connections DROP COLUMN IF EXISTS v2_accept_until;
ALTER TABLE rtgip.connections DROP COLUMN IF EXISTS v3_added_at;
ALTER TABLE rtgip.connections DROP COLUMN IF EXISTS accept_protocols;
ALTER TABLE rtgip.connections DROP COLUMN IF EXISTS send_protocol;

DROP TABLE IF EXISTS rtgip.public_key_bindings;
DROP TABLE IF EXISTS rtgip.evidence_v3;
DROP TABLE IF EXISTS rtgip.public_keys;
DROP FUNCTION IF EXISTS rtgip.public_keys_no_truncate();
DROP FUNCTION IF EXISTS rtgip.public_keys_guard();
DROP FUNCTION IF EXISTS rtgip.evidence_v3_immutable();
DROP FUNCTION IF EXISTS rtgip.ed25519_sig_shape(text);
DROP FUNCTION IF EXISTS rtgip.ed25519_pk_usable(text);
DROP FUNCTION IF EXISTS rtgip.ed25519_le(bytea);
DROP FUNCTION IF EXISTS rtgip.ed25519_powmod(numeric, numeric);

NOTIFY pgrst, 'reload schema';
