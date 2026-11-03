-- PROPOSED ONLY. Not a migration; never apply to a hosted database without separate approval.
-- RooftopOS rooftop identity registry: the single owner-reviewed binding of one physical
-- dealership rooftop to its AutoLabels store, AutoCurb dealership/store location and AutoFrame
-- rooftop. Rows start pending; only a second person with a stated reason activates one. Nothing
-- here infers identity from a VIN or a dealership name. Exports are views over active rows only,
-- so a revocation takes effect for every consumer in the same commit. Idempotent.

CREATE SCHEMA IF NOT EXISTS rooftop_registry;
REVOKE ALL ON SCHEMA rooftop_registry FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rooftop_registry_operator') THEN CREATE ROLE rooftop_registry_operator NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rooftop_registry_reviewer') THEN CREATE ROLE rooftop_registry_reviewer NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rooftop_registry_reader') THEN CREATE ROLE rooftop_registry_reader NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA rooftop_registry TO rooftop_registry_operator, rooftop_registry_reviewer, rooftop_registry_reader;

CREATE TABLE IF NOT EXISTS rooftop_registry.rooftops (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL CHECK (tenant_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  rooftop_id            text NOT NULL CHECK (rooftop_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  dealership_ref        text NOT NULL CHECK (length(trim(dealership_ref)) BETWEEN 3 AND 200),
  al_tenant_id          uuid NOT NULL,
  al_store_id           uuid NOT NULL,
  ac_dealership_id      text NOT NULL CHECK (length(ac_dealership_id) BETWEEN 1 AND 128),
  ac_store_location_id  uuid,
  af_tenant_id          uuid NOT NULL,
  af_rooftop_id         uuid NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_by            uuid NOT NULL,
  created_reason        text NOT NULL CHECK (length(trim(created_reason)) >= 10),
  created_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_by           uuid,
  review_reason         text,
  reviewed_at           timestamptz,
  revoked_by            uuid,
  revoke_reason         text,
  revoked_at            timestamptz,
  CHECK (al_tenant_id::text = tenant_id),
  CHECK (status <> 'active' OR (reviewed_by IS NOT NULL AND reviewed_by <> created_by AND length(trim(review_reason)) >= 10)),
  CHECK (status <> 'revoked' OR (revoked_by IS NOT NULL AND length(trim(revoke_reason)) >= 10 AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_active_rooftop ON rooftop_registry.rooftops (tenant_id, rooftop_id) WHERE status <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_active_al_store ON rooftop_registry.rooftops (al_store_id) WHERE status <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_active_ac_store ON rooftop_registry.rooftops (ac_dealership_id, coalesce(ac_store_location_id::text, '')) WHERE status <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_active_af_rooftop ON rooftop_registry.rooftops (af_rooftop_id) WHERE status <> 'revoked';
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_active_dealership ON rooftop_registry.rooftops (tenant_id, dealership_ref) WHERE status <> 'revoked';

CREATE TABLE IF NOT EXISTS rooftop_registry.grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  source_app   text NOT NULL CHECK (source_app IN ('autolabels','autocurb','autoframe')),
  target_app   text NOT NULL CHECK (target_app IN ('autolabels','autocurb','autoframe')),
  events       text[] NOT NULL CHECK (cardinality(events) > 0),
  purposes     text[] NOT NULL CHECK (cardinality(purposes) > 0),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_by   uuid NOT NULL,
  created_reason text NOT NULL CHECK (length(trim(created_reason)) >= 10),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid,
  review_reason text,
  reviewed_at  timestamptz,
  revoked_by   uuid,
  revoke_reason text,
  revoked_at   timestamptz,
  CHECK (source_app <> target_app),
  CHECK (status <> 'active' OR (reviewed_by IS NOT NULL AND reviewed_by <> created_by AND length(trim(review_reason)) >= 10)),
  CHECK (status <> 'revoked' OR (revoked_by IS NOT NULL AND length(trim(revoke_reason)) >= 10 AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_live_grant ON rooftop_registry.grants (tenant_id, source_app, target_app) WHERE status <> 'revoked';

-- Vehicle episode bindings are not reviewed one by one: each is anchored to the AutoLabels
-- custody event that opened the episode at an active rooftop, never to a VIN lookup.
CREATE TABLE IF NOT EXISTS rooftop_registry.episodes (
  rooftop          uuid NOT NULL REFERENCES rooftop_registry.rooftops(id) ON DELETE RESTRICT,
  instance_id      text NOT NULL CHECK (instance_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  episode_id       text NOT NULL CHECK (episode_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  vin              text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  labels_event_id  uuid NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  bound_by         uuid NOT NULL,
  bound_at         timestamptz NOT NULL DEFAULT now(),
  revoked_by       uuid,
  revoke_reason    text,
  revoked_at       timestamptz,
  PRIMARY KEY (rooftop, instance_id, episode_id),
  UNIQUE (labels_event_id),
  CHECK (status <> 'revoked' OR (revoked_by IS NOT NULL AND length(trim(revoke_reason)) >= 10))
);
CREATE UNIQUE INDEX IF NOT EXISTS rr_one_active_episode ON rooftop_registry.episodes (instance_id, episode_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS rooftop_registry.audit (
  seq      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  subject  text NOT NULL CHECK (subject IN ('rooftop','grant','episode')),
  ref      text NOT NULL,
  action   text NOT NULL CHECK (action IN ('proposed','activated','revoked','refused')),
  actor    uuid NOT NULL,
  reason   text NOT NULL,
  detail   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE OR REPLACE FUNCTION rooftop_registry.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'rooftop_registry_audit_immutable'; END $$;
DROP TRIGGER IF EXISTS audit_immutable ON rooftop_registry.audit;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON rooftop_registry.audit
  FOR EACH STATEMENT EXECUTE FUNCTION rooftop_registry.append_only();

-- Revoked is terminal; registry rows are never deleted.
CREATE OR REPLACE FUNCTION rooftop_registry.guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rooftop_registry_rows_are_never_deleted'; END IF;
  IF OLD.status = 'revoked' THEN RAISE EXCEPTION 'rooftop_registry_revoked_is_terminal'; END IF;
  IF OLD.status = 'active' AND NEW.status = 'pending' THEN RAISE EXCEPTION 'rooftop_registry_no_reactivation_path'; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['rooftops','grants','episodes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard ON rooftop_registry.%I', t);
    EXECUTE format('CREATE TRIGGER guard BEFORE UPDATE OR DELETE ON rooftop_registry.%I FOR EACH ROW EXECUTE FUNCTION rooftop_registry.guard()', t);
  END LOOP;
END $$;
-- Identity columns of a rooftop are immutable once proposed: a correction is a revoke plus a new proposal.
CREATE OR REPLACE FUNCTION rooftop_registry.freeze_identity() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.tenant_id, NEW.rooftop_id, NEW.dealership_ref, NEW.al_tenant_id, NEW.al_store_id, NEW.ac_dealership_id,
      NEW.ac_store_location_id, NEW.af_tenant_id, NEW.af_rooftop_id, NEW.created_by, NEW.created_reason)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.rooftop_id, OLD.dealership_ref, OLD.al_tenant_id, OLD.al_store_id, OLD.ac_dealership_id,
      OLD.ac_store_location_id, OLD.af_tenant_id, OLD.af_rooftop_id, OLD.created_by, OLD.created_reason) THEN
    RAISE EXCEPTION 'rooftop_registry_identity_is_immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS freeze_identity ON rooftop_registry.rooftops;
CREATE TRIGGER freeze_identity BEFORE UPDATE ON rooftop_registry.rooftops FOR EACH ROW EXECUTE FUNCTION rooftop_registry.freeze_identity();

REVOKE ALL ON ALL TABLES IN SCHEMA rooftop_registry FROM PUBLIC;

CREATE OR REPLACE FUNCTION rooftop_registry.propose_rooftop(
  p_actor uuid, p_reason text, p_tenant_id text, p_rooftop_id text, p_dealership_ref text,
  p_al_tenant_id uuid, p_al_store_id uuid, p_ac_dealership_id text, p_ac_store_location_id uuid,
  p_af_tenant_id uuid, p_af_rooftop_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO rooftop_registry.rooftops (tenant_id, rooftop_id, dealership_ref, al_tenant_id, al_store_id,
    ac_dealership_id, ac_store_location_id, af_tenant_id, af_rooftop_id, created_by, created_reason)
  VALUES (p_tenant_id, p_rooftop_id, p_dealership_ref, p_al_tenant_id, p_al_store_id,
    p_ac_dealership_id, p_ac_store_location_id, p_af_tenant_id, p_af_rooftop_id, p_actor, p_reason)
  RETURNING id INTO v_id;
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason)
  VALUES ('rooftop', v_id::text, 'proposed', p_actor, p_reason);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION rooftop_registry.activate_rooftop(p_id uuid, p_reviewer uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r rooftop_registry.rooftops;
BEGIN
  SELECT * INTO r FROM rooftop_registry.rooftops WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN 'not_found'; END IF;
  IF r.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF p_reviewer = r.created_by THEN
    INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason, detail)
    VALUES ('rooftop', p_id::text, 'refused', p_reviewer, coalesce(p_reason, ''), '{"why":"reviewer_is_creator"}');
    RETURN 'reviewer_is_creator';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN RETURN 'reason_required'; END IF;
  UPDATE rooftop_registry.rooftops SET status = 'active', reviewed_by = p_reviewer, review_reason = p_reason, reviewed_at = clock_timestamp()
   WHERE id = p_id;
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason) VALUES ('rooftop', p_id::text, 'activated', p_reviewer, p_reason);
  RETURN 'activated';
END $$;

CREATE OR REPLACE FUNCTION rooftop_registry.revoke_rooftop(p_id uuid, p_actor uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r rooftop_registry.rooftops; n int;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN RETURN 'reason_required'; END IF;
  SELECT * INTO r FROM rooftop_registry.rooftops WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN 'not_found'; END IF;
  IF r.status = 'revoked' THEN RETURN 'already_revoked'; END IF;
  UPDATE rooftop_registry.rooftops SET status = 'revoked', revoked_by = p_actor, revoke_reason = p_reason, revoked_at = clock_timestamp()
   WHERE id = p_id;
  UPDATE rooftop_registry.episodes SET status = 'revoked', revoked_by = p_actor, revoke_reason = 'rooftop revoked: ' || p_reason, revoked_at = clock_timestamp()
   WHERE rooftop = p_id AND status = 'active';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason, detail)
  VALUES ('rooftop', p_id::text, 'revoked', p_actor, p_reason, jsonb_build_object('episodes_revoked', n, 'prior_status', r.status));
  RETURN 'revoked';
END $$;

CREATE OR REPLACE FUNCTION rooftop_registry.propose_grant(
  p_actor uuid, p_reason text, p_tenant_id text, p_source text, p_target text, p_events text[], p_purposes text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO rooftop_registry.grants (tenant_id, source_app, target_app, events, purposes, created_by, created_reason)
  VALUES (p_tenant_id, p_source, p_target, p_events, p_purposes, p_actor, p_reason) RETURNING id INTO v_id;
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason) VALUES ('grant', v_id::text, 'proposed', p_actor, p_reason);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION rooftop_registry.activate_grant(p_id uuid, p_reviewer uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g rooftop_registry.grants;
BEGIN
  SELECT * INTO g FROM rooftop_registry.grants WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL THEN RETURN 'not_found'; END IF;
  IF g.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF p_reviewer = g.created_by THEN
    INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason, detail)
    VALUES ('grant', p_id::text, 'refused', p_reviewer, coalesce(p_reason, ''), '{"why":"reviewer_is_creator"}');
    RETURN 'reviewer_is_creator';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN RETURN 'reason_required'; END IF;
  UPDATE rooftop_registry.grants SET status = 'active', reviewed_by = p_reviewer, review_reason = p_reason, reviewed_at = clock_timestamp() WHERE id = p_id;
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason) VALUES ('grant', p_id::text, 'activated', p_reviewer, p_reason);
  RETURN 'activated';
END $$;

CREATE OR REPLACE FUNCTION rooftop_registry.revoke_grant(p_id uuid, p_actor uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g rooftop_registry.grants;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN RETURN 'reason_required'; END IF;
  SELECT * INTO g FROM rooftop_registry.grants WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL THEN RETURN 'not_found'; END IF;
  IF g.status = 'revoked' THEN RETURN 'already_revoked'; END IF;
  UPDATE rooftop_registry.grants SET status = 'revoked', revoked_by = p_actor, revoke_reason = p_reason, revoked_at = clock_timestamp() WHERE id = p_id;
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason) VALUES ('grant', p_id::text, 'revoked', p_actor, p_reason);
  RETURN 'revoked';
END $$;

-- Bind one AutoLabels custody episode at an active rooftop. The caller supplies the AutoLabels
-- custody event id that opened it; the binding refuses a pending or revoked rooftop and any
-- instance/episode already bound elsewhere. A VIN alone never creates or selects a binding.
CREATE OR REPLACE FUNCTION rooftop_registry.bind_episode(
  p_actor uuid, p_rooftop uuid, p_instance_id text, p_episode_id text, p_vin text, p_labels_event_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r rooftop_registry.rooftops; e rooftop_registry.episodes;
BEGIN
  SELECT * INTO r FROM rooftop_registry.rooftops WHERE id = p_rooftop FOR SHARE;
  IF r.id IS NULL OR r.status <> 'active' THEN RETURN 'rooftop_not_active'; END IF;
  SELECT * INTO e FROM rooftop_registry.episodes WHERE labels_event_id = p_labels_event_id;
  IF e.rooftop IS NOT NULL THEN
    RETURN CASE WHEN e.rooftop = p_rooftop AND e.instance_id = p_instance_id AND e.episode_id = p_episode_id AND e.vin = p_vin
                THEN 'exact_retry' ELSE 'labels_event_reused' END;
  END IF;
  IF EXISTS (SELECT 1 FROM rooftop_registry.episodes WHERE instance_id = p_instance_id AND episode_id = p_episode_id AND status = 'active') THEN
    RETURN 'episode_already_bound';
  END IF;
  INSERT INTO rooftop_registry.episodes (rooftop, instance_id, episode_id, vin, labels_event_id, bound_by)
  VALUES (p_rooftop, p_instance_id, p_episode_id, p_vin, p_labels_event_id, p_actor);
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason, detail)
  VALUES ('episode', p_instance_id || '/' || p_episode_id, 'activated', p_actor, 'labels custody event', jsonb_build_object('labels_event_id', p_labels_event_id));
  RETURN 'bound';
END $$;

CREATE OR REPLACE FUNCTION rooftop_registry.revoke_episode(p_actor uuid, p_instance_id text, p_episode_id text, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN RETURN 'reason_required'; END IF;
  UPDATE rooftop_registry.episodes SET status = 'revoked', revoked_by = p_actor, revoke_reason = p_reason, revoked_at = clock_timestamp()
   WHERE instance_id = p_instance_id AND episode_id = p_episode_id AND status = 'active';
  IF NOT FOUND THEN RETURN 'not_active'; END IF;
  INSERT INTO rooftop_registry.audit (subject, ref, action, actor, reason) VALUES ('episode', p_instance_id || '/' || p_episode_id, 'revoked', p_actor, p_reason);
  RETURN 'revoked';
END $$;

-- Exports. Every view reads active rows only; pending and revoked rows export nothing.
CREATE OR REPLACE VIEW rooftop_registry.export_al_rooftop_stores WITH (security_barrier) AS
  SELECT r.al_tenant_id AS tenant_id, r.rooftop_id, r.al_store_id AS store_id, r.id AS registry_id
    FROM rooftop_registry.rooftops r WHERE r.status = 'active';

CREATE OR REPLACE VIEW rooftop_registry.export_ac_rooftop_scope WITH (security_barrier) AS
  SELECT r.ac_dealership_id AS dealership_id, r.ac_store_location_id AS store_location_id,
         r.tenant_id, r.rooftop_id, r.id AS registry_id
    FROM rooftop_registry.rooftops r WHERE r.status = 'active';

CREATE OR REPLACE VIEW rooftop_registry.export_af_rooftop_scope WITH (security_barrier) AS
  SELECT r.af_tenant_id, r.af_rooftop_id, r.tenant_id, r.rooftop_id, r.id AS registry_id
    FROM rooftop_registry.rooftops r WHERE r.status = 'active';

CREATE OR REPLACE FUNCTION rooftop_registry.connection_id(p_source text, p_target text, p_tenant text, p_rooftop text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'conn:' || p_source || '>' || p_target || ':' || p_tenant || ':' || p_rooftop
$$;

-- One Gateway connection per (route, tenant, rooftop), matching gw_r2_connections. The registry
-- never enables transport: source_enabled and target_enabled are always false here, and turning
-- them on is a separate privileged activation step.
CREATE OR REPLACE VIEW rooftop_registry.export_gw_connections WITH (security_barrier) AS
  SELECT rooftop_registry.connection_id(g.source_app, g.target_app, r.tenant_id, r.rooftop_id) AS id,
         g.source_app, g.target_app, r.tenant_id, r.rooftop_id, g.events, g.purposes,
         'active'::text AS status, false AS source_enabled, false AS target_enabled,
         r.id AS registry_id, g.id AS grant_id
    FROM rooftop_registry.grants g
    JOIN rooftop_registry.rooftops r ON r.tenant_id = g.tenant_id
   WHERE g.status = 'active' AND r.status = 'active';

-- One Gateway identity mapping per connection and bound episode, matching gw_r2_mappings.
-- source_store_id is the source app's own reviewed store reference from the same registry row.
CREATE OR REPLACE VIEW rooftop_registry.export_gw_mappings WITH (security_barrier) AS
  SELECT c.id AS connection_id, e.instance_id, e.episode_id,
         CASE c.source_app
           WHEN 'autolabels' THEN r.al_store_id::text
           WHEN 'autocurb'   THEN r.ac_dealership_id || coalesce(':' || r.ac_store_location_id::text, '')
           WHEN 'autoframe'  THEN r.af_rooftop_id::text END AS source_store_id,
         e.vin, 'rooftop_registry:' || r.id::text || ':' || e.labels_event_id::text AS reviewed_ref,
         'active'::text AS status
    FROM rooftop_registry.episodes e
    JOIN rooftop_registry.rooftops r ON r.id = e.rooftop AND r.status = 'active'
    JOIN rooftop_registry.export_gw_connections c ON c.registry_id = r.id
   WHERE e.status = 'active';

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rooftop_registry FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rooftop_registry.propose_rooftop(uuid, text, text, text, text, uuid, uuid, text, uuid, uuid, uuid),
  rooftop_registry.revoke_rooftop(uuid, uuid, text), rooftop_registry.propose_grant(uuid, text, text, text, text, text[], text[]),
  rooftop_registry.revoke_grant(uuid, uuid, text), rooftop_registry.bind_episode(uuid, uuid, text, text, text, uuid),
  rooftop_registry.revoke_episode(uuid, text, text, text)
  TO rooftop_registry_operator;
GRANT EXECUTE ON FUNCTION rooftop_registry.activate_rooftop(uuid, uuid, text), rooftop_registry.activate_grant(uuid, uuid, text),
  rooftop_registry.revoke_rooftop(uuid, uuid, text), rooftop_registry.revoke_grant(uuid, uuid, text)
  TO rooftop_registry_reviewer;
GRANT EXECUTE ON FUNCTION rooftop_registry.connection_id(text, text, text, text) TO rooftop_registry_reader;
GRANT SELECT ON rooftop_registry.export_al_rooftop_stores, rooftop_registry.export_ac_rooftop_scope,
  rooftop_registry.export_af_rooftop_scope, rooftop_registry.export_gw_connections, rooftop_registry.export_gw_mappings,
  rooftop_registry.audit
  TO rooftop_registry_reader;
