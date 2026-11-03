-- Test-only table for the local four-node staging harness (pg_staging.sh). Holds the consumer
-- projection each target app's real consumer code mutates inside the admission transaction,
-- and a per-event effect ledger so a test can count committed effects. Never applied anywhere
-- but a throwaway cluster.
CREATE SCHEMA IF NOT EXISTS rtgip_stage;
CREATE TABLE IF NOT EXISTS rtgip_stage.projection (
  app text PRIMARY KEY,
  doc jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rtgip_stage.effects (
  seq bigserial PRIMARY KEY,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rtgip_stage.source_writes (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL,
  note text NOT NULL
);
REVOKE ALL ON SCHEMA rtgip_stage FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA rtgip_stage FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA rtgip_stage TO rtgip_inbox_receiver, rtgip_outbox_writer;
GRANT SELECT, INSERT, UPDATE ON rtgip_stage.projection TO rtgip_inbox_receiver;
GRANT SELECT, INSERT ON rtgip_stage.effects TO rtgip_inbox_receiver;
GRANT USAGE ON SEQUENCE rtgip_stage.effects_seq_seq TO rtgip_inbox_receiver;
GRANT SELECT, INSERT ON rtgip_stage.source_writes TO rtgip_outbox_writer;
GRANT USAGE ON SEQUENCE rtgip_stage.source_writes_id_seq TO rtgip_outbox_writer;

-- The staging targets run each app's real consumer in TypeScript inside the admission
-- transaction (admitDelivery's effect), so the SQL hook only lets the event through. An app
-- node that carries its effects in SQL (AutoLabels: rtgip_fx.labels_apply) replaces this.
CREATE OR REPLACE FUNCTION rtgip.consumer_effect(e jsonb) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS 'SELECT ''{"ok":true}''::jsonb';
