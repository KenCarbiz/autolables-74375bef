-- Test-only helper for the local four-node staging harness (pg_staging.sh). A marker table so a
-- test can prove the source side's business write and its outbox row commit or roll back together.
-- It carries no consumer logic: the destination effect on every node is the app's own
-- rtgip.consumer_effect hook (the AutoLabels node installs rtgip_fx.labels_apply through
-- rtgip_labels_effects.proposed.sql) and the staging adapter's apply(). Never applied anywhere
-- but a throwaway cluster.
CREATE SCHEMA IF NOT EXISTS rtgip_stage;
CREATE TABLE IF NOT EXISTS rtgip_stage.source_writes (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL,
  note text NOT NULL
);
REVOKE ALL ON SCHEMA rtgip_stage FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA rtgip_stage FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA rtgip_stage TO rtgip_outbox_writer;
GRANT SELECT, INSERT ON rtgip_stage.source_writes TO rtgip_outbox_writer;
GRANT USAGE ON SEQUENCE rtgip_stage.source_writes_id_seq TO rtgip_outbox_writer;
