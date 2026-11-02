-- Gateway STAND-IN for the local four-node staging harness only. It is not the hosted Gateway
-- and is never applied anywhere but a throwaway cluster. It gives the stand-in what the real
-- Gateway must provide durably: a source-nonce claim bound to the body hash, one admission per
-- (event, target) with the forwarding nonce fixed at admission, and an append-only audit.
CREATE SCHEMA IF NOT EXISTS gw_standin;
CREATE TABLE IF NOT EXISTS gw_standin.source_nonces (
  key_id text NOT NULL,
  nonce text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_id, nonce)
);
CREATE TABLE IF NOT EXISTS gw_standin.admissions (
  event_id uuid NOT NULL,
  target_app text NOT NULL,
  source_app text NOT NULL,
  connection_id text NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  gateway_nonce text NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, target_app)
);
CREATE TABLE IF NOT EXISTS gw_standin.audit (
  seq bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  decision text NOT NULL CHECK (decision IN ('admitted','forwarded','rejected','target_error')),
  reason text,
  event_id uuid,
  route text,
  key_id text,
  http_status integer
);
CREATE OR REPLACE FUNCTION gw_standin.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append_only'; END $$;
DROP TRIGGER IF EXISTS audit_immutable ON gw_standin.audit;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON gw_standin.audit
  FOR EACH STATEMENT EXECUTE FUNCTION gw_standin.audit_immutable();
REVOKE ALL ON SCHEMA gw_standin FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA gw_standin FROM PUBLIC, anon, authenticated, service_role;
