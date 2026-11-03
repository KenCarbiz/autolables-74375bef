-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- Durable, inactive AutoLabels consumer effects for rtgip/2 (Phase 3D A4). Requires the
-- spine, PR #46 20261109000000_vehicle_history_foundation.sql and
-- rtgip_source_readers.proposed.sql (for rtgip_src.labels_authority and the rooftop map).
--
-- What an inbound AutoCurb or AutoFrame message may do here: append acquisition evidence,
-- open a reconciliation or custody review, record an approved media reference, append a
-- revocation tombstone, or record an audited reinstatement. Nothing here writes
-- vehicle_instances, vehicle_listings, prices or custody milestones; a provisional
-- acquisition never creates inventory. Every row keeps its source event id and revision.
--
-- Entry point: rtgip_fx.labels_apply(envelope jsonb), executed by the NOLOGIN
-- rtgip_labels_consumer role inside the same transaction as the inbox commit, after the
-- shared admission has verified signature, scope, connection and canonical form. The
-- function re-checks tenant -> rooftop -> store -> episode -> instance -> VIN itself.

CREATE SCHEMA IF NOT EXISTS rtgip_fx;
REVOKE ALL ON SCHEMA rtgip_fx FROM PUBLIC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_labels_consumer') THEN
    CREATE ROLE rtgip_labels_consumer NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA rtgip_fx TO rtgip_labels_consumer;

CREATE TABLE IF NOT EXISTS rtgip_fx.acquisition_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  rooftop_id      text NOT NULL,
  store_id        uuid NOT NULL,
  episode_id      uuid NOT NULL,
  instance_root   uuid NOT NULL,
  vin             text NOT NULL,
  source_app      text NOT NULL CHECK (source_app = 'autocurb'),
  source_event_id text NOT NULL,
  aggregate_id    text NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision >= 1),
  kind            text NOT NULL,
  refs            text[] NOT NULL,
  occurred_at     timestamptz NOT NULL,
  envelope_sha256 text NOT NULL CHECK (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_app, source_event_id)
);
CREATE INDEX IF NOT EXISTS acquisition_evidence_episode_idx ON rtgip_fx.acquisition_evidence (tenant_id, episode_id);

-- Provisional acquisitions and identity questions wait here for a person; nothing is created.
CREATE TABLE IF NOT EXISTS rtgip_fx.reconciliation_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL CHECK (kind IN ('identity_reconciliation','reappearance','custody_review')),
  tenant_id           uuid NOT NULL,
  rooftop_id          text NOT NULL,
  vin                 text NOT NULL,
  source_app          text NOT NULL,
  source_instance_ref text NOT NULL,
  source_episode_ref  text NOT NULL,
  prior_episode_id    uuid,
  source_event_id     text NOT NULL,
  evidence_refs       text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  envelope_sha256     text NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_app, source_event_id)
);

CREATE TABLE IF NOT EXISTS rtgip_fx.media_refs (
  media_id          text PRIMARY KEY,
  tenant_id         uuid NOT NULL,
  rooftop_id        text NOT NULL,
  episode_id        uuid NOT NULL,
  instance_root     uuid NOT NULL,
  state             text NOT NULL CHECK (state IN ('approved','revoked')),
  active_in_gallery boolean NOT NULL,
  approval_revision bigint NOT NULL,
  rendition_id      text,
  storage_bucket    text,
  storage_object_key text,
  content_sha256    text,
  media_order       integer,
  shot_type         text,
  source_event_id   text NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rtgip_fx.media_revocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id        text NOT NULL,
  tenant_id       uuid NOT NULL,
  episode_id      uuid NOT NULL,
  revision        bigint NOT NULL,
  reason          text NOT NULL,
  audit_ref       text NOT NULL,
  source_event_id text NOT NULL UNIQUE,
  episode_closed  boolean NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rtgip_fx.media_reinstatements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id        text NOT NULL,
  tenant_id       uuid NOT NULL,
  audit_ref       text NOT NULL,
  revision        bigint NOT NULL,
  source_event_id text NOT NULL UNIQUE,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, audit_ref)
);

-- One row per accepted event id (rtgip/2-event/v2, bound to one full envelope): a replay returns
-- the first answer, a different envelope under a known id is refused. The origin event is kept
-- as provenance and is unique too, so one source fact lands once whatever id it travels under.
CREATE TABLE IF NOT EXISTS rtgip_fx.applied (
  event_id        uuid PRIMARY KEY,
  source_app      text NOT NULL,
  source_event_id text NOT NULL,
  envelope_sha256 text NOT NULL,
  event_type      text NOT NULL,
  tenant_id       uuid NOT NULL,
  outcome         jsonb NOT NULL,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_app, source_event_id)
);

CREATE OR REPLACE FUNCTION rtgip_fx.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append_only: % rows cannot be changed or deleted', TG_TABLE_NAME; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['applied','acquisition_evidence','reconciliation_reviews','media_revocations','media_reinstatements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON rtgip_fx.%I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON rtgip_fx.%I FOR EACH ROW EXECUTE FUNCTION rtgip_fx.append_only()', t || '_append_only', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION rtgip_fx.envelope_sha(e jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(e::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION rtgip_fx.labels_effect(e jsonb, v_sha text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid; v_rooftop text; v_episode uuid; v_inst text; v_vin text; v_type text := e->>'event_type';
  v_src text := e#>>'{origin,app}'; v_evt text := e#>>'{origin,event_id}'; v_rev bigint := (e#>>'{origin,revision}')::bigint;
  v_agg text := e#>>'{aggregate,id}'; v_arev bigint := (e#>>'{aggregate,revision}')::bigint;
  pl jsonb := e->'payload';
  a jsonb; ep public.vehicle_instances%ROWTYPE; v_root text; v_open boolean; prior rtgip_fx.media_refs%ROWTYPE;
  v_prior_ep uuid; v_reinst text; v_refs text[]; v_kind text; v_at timestamptz;
BEGIN
  IF e->>'target_app' IS DISTINCT FROM 'autolabels' THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_destination'); END IF;
  IF v_src NOT IN ('autocurb','autoframe') THEN RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_source'); END IF;
  IF v_evt IS NULL OR v_rev IS NULL OR v_rev < 1 OR v_arev IS NULL OR v_arev < 1 OR v_agg IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'provenance_missing'); END IF;
  BEGIN
    v_tenant := (e->>'tenant_id')::uuid;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_reference');
  END;
  v_rooftop := e->>'rooftop_id'; v_inst := e#>>'{vehicle,instance_id}'; v_vin := e#>>'{vehicle,vin}';

  -- Provisional AutoCurb acquisition: a review, never inventory.
  IF v_src = 'autocurb' AND (v_inst LIKE 'acq:%' OR (e#>>'{vehicle,episode_id}') LIKE 'acq:%') THEN
    IF v_type <> 'acquisition.purchase_completed' THEN RETURN jsonb_build_object('ok', false, 'reason', 'provisional_ref_requires_purchase_completed'); END IF;
    IF NOT EXISTS (SELECT 1 FROM rtgip_src.rooftop_stores m WHERE m.tenant_id = v_tenant AND m.rooftop_id = v_rooftop AND m.status = 'active') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'rooftop_unmapped');
    END IF;
    SELECT vi.id INTO v_prior_ep FROM public.vehicle_instances vi WHERE vi.tenant_id = v_tenant AND vi.vin = v_vin ORDER BY vi.created_at DESC, vi.id LIMIT 1;
    INSERT INTO rtgip_fx.reconciliation_reviews (kind, tenant_id, rooftop_id, vin, source_app, source_instance_ref, source_episode_ref,
        prior_episode_id, source_event_id, evidence_refs, envelope_sha256)
    VALUES (CASE WHEN v_prior_ep IS NULL THEN 'identity_reconciliation' ELSE 'reappearance' END, v_tenant, v_rooftop, v_vin, v_src,
        v_inst, e#>>'{vehicle,episode_id}', v_prior_ep, v_evt,
        ARRAY[pl->>'purchase_ref', pl->>'audit_ref'] || ARRAY(SELECT jsonb_array_elements_text(COALESCE(pl->'ownership_evidence_refs', '[]'))), v_sha);
    RETURN jsonb_build_object('ok', true, 'review', true);
  END IF;

  BEGIN
    v_episode := (e#>>'{vehicle,episode_id}')::uuid;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_reference');
  END;
  a := rtgip_src.labels_authority(v_tenant, v_rooftop, v_episode);
  IF a IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'episode_not_registered'); END IF;
  IF a ? 'refused' THEN RETURN jsonb_build_object('ok', false, 'reason', a->>'refused'); END IF;
  SELECT * INTO ep FROM public.vehicle_instances vi WHERE vi.id = v_episode;
  IF ep.vin IS DISTINCT FROM v_vin THEN RETURN jsonb_build_object('ok', false, 'reason', 'vin_mismatch'); END IF;
  v_root := rtgip_src.labels_episode_json(ep)->>'instance_id';
  IF v_root IS NULL OR v_root IS DISTINCT FROM v_inst THEN RETURN jsonb_build_object('ok', false, 'reason', 'instance_mismatch'); END IF;
  v_open := ep.status = 'active' AND ep.custody_state IN ('in_stock','sold','awaiting_delivery');

  IF v_src = 'autocurb' THEN
    -- An acquisition belongs to one episode: the first evidence row fixes it.
    IF EXISTS (SELECT 1 FROM rtgip_fx.acquisition_evidence x WHERE x.tenant_id = v_tenant AND x.aggregate_id = v_agg AND x.episode_id <> v_episode) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'acquisition_episode_reassignment');
    END IF;
    IF EXISTS (SELECT 1 FROM rtgip_fx.acquisition_evidence x WHERE x.tenant_id = v_tenant AND x.aggregate_id = v_agg AND x.source_revision >= v_arev) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'stale_revision');
    END IF;
    -- Evidence for a closed episode never reopens it: a person reviews it instead.
    IF NOT v_open THEN
      INSERT INTO rtgip_fx.reconciliation_reviews (kind, tenant_id, rooftop_id, vin, source_app, source_instance_ref, source_episode_ref,
          prior_episode_id, source_event_id, envelope_sha256)
      VALUES ('custody_review', v_tenant, v_rooftop, v_vin, v_src, v_inst, v_episode::text, v_episode, v_evt, v_sha);
      RETURN jsonb_build_object('ok', true, 'review', true, 'reason', 'custody_review_opened');
    END IF;
    IF v_type = 'appraisal.completed' THEN
      v_kind := 'appraisal_finalized'; v_refs := ARRAY[pl->>'appraisal_ref', pl->>'audit_ref']; v_at := (pl->>'finalized_at')::timestamptz;
    ELSIF v_type = 'acquisition.milestone_recorded' THEN
      v_kind := 'acquisition_milestone:' || (pl->>'milestone'); v_refs := ARRAY[pl->>'audit_ref']; v_at := (pl->>'recorded_at')::timestamptz;
    ELSIF v_type = 'acquisition.purchase_completed' THEN
      v_kind := 'purchase_completed_custody_received';
      v_refs := ARRAY[pl->>'purchase_ref', pl->>'audit_ref']
        || ARRAY(SELECT jsonb_array_elements_text(COALESCE(pl->'ownership_evidence_refs', '[]')))
        || ARRAY(SELECT jsonb_array_elements_text(COALESCE(pl->'condition_evidence_refs', '[]')));
      v_at := (pl->>'custody_at')::timestamptz;
    ELSE
      RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_event_for_consumer');
    END IF;
    IF v_at IS NULL OR array_position(v_refs, NULL) IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'evidence_incomplete'); END IF;
    INSERT INTO rtgip_fx.acquisition_evidence (tenant_id, rooftop_id, store_id, episode_id, instance_root, vin, source_app, source_event_id,
        aggregate_id, source_revision, kind, refs, occurred_at, envelope_sha256)
    VALUES (v_tenant, v_rooftop, (a->>'store_id')::uuid, v_episode, v_root::uuid, v_vin, v_src, v_evt, v_agg, v_arev, v_kind, v_refs, v_at, v_sha);
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- AutoFrame media.
  IF pl->>'media_id' IS DISTINCT FROM v_agg THEN RETURN jsonb_build_object('ok', false, 'reason', 'media_aggregate_mismatch'); END IF;
  SELECT * INTO prior FROM rtgip_fx.media_refs m WHERE m.media_id = v_agg FOR UPDATE;
  IF FOUND AND (prior.tenant_id <> v_tenant OR prior.episode_id <> v_episode) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'media_vehicle_reassignment');
  END IF;
  IF FOUND AND v_arev <= prior.approval_revision THEN RETURN jsonb_build_object('ok', false, 'reason', 'stale_revision'); END IF;

  IF v_type = 'media.revoked' THEN
    -- A revocation always lands, also after the episode closed; it never reopens anything.
    INSERT INTO rtgip_fx.media_revocations (media_id, tenant_id, episode_id, revision, reason, audit_ref, source_event_id, episode_closed)
    VALUES (v_agg, v_tenant, v_episode, v_arev, pl->>'reason', pl->>'revocation_audit_ref', v_evt, NOT v_open);
    INSERT INTO rtgip_fx.media_refs AS m (media_id, tenant_id, rooftop_id, episode_id, instance_root, state, active_in_gallery, approval_revision, source_event_id)
    VALUES (v_agg, v_tenant, v_rooftop, v_episode, v_root::uuid, 'revoked', false, v_arev, v_evt)
    ON CONFLICT (media_id) DO UPDATE SET state = 'revoked', active_in_gallery = false, approval_revision = EXCLUDED.approval_revision,
      source_event_id = EXCLUDED.source_event_id, updated_at = now();
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF v_type <> 'media.approved' THEN RETURN jsonb_build_object('ok', false, 'reason', 'unsupported_event_for_consumer'); END IF;
  IF position((v_tenant::text || '/' || v_rooftop || '/' || v_inst || '/') IN COALESCE(pl#>>'{storage_ref,object_key}', '')) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'storage_ref_out_of_scope');
  END IF;
  v_reinst := pl->>'reinstatement_audit_ref';
  IF EXISTS (SELECT 1 FROM rtgip_fx.media_revocations r WHERE r.media_id = v_agg) THEN
    IF v_reinst IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'revoked_media_requires_reinstatement'); END IF;
    IF EXISTS (SELECT 1 FROM rtgip_fx.media_reinstatements r WHERE r.media_id = v_agg AND r.audit_ref = v_reinst)
       OR EXISTS (SELECT 1 FROM rtgip_fx.media_revocations r WHERE r.media_id = v_agg AND r.audit_ref = v_reinst) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'reinstatement_ref_reused');
    END IF;
    IF NOT v_open THEN RETURN jsonb_build_object('ok', false, 'reason', 'closed_episode_cannot_reinstate'); END IF;
    INSERT INTO rtgip_fx.media_reinstatements (media_id, tenant_id, audit_ref, revision, source_event_id)
    VALUES (v_agg, v_tenant, v_reinst, v_arev, v_evt);
  END IF;
  INSERT INTO rtgip_fx.media_refs AS m (media_id, tenant_id, rooftop_id, episode_id, instance_root, state, active_in_gallery, approval_revision,
      rendition_id, storage_bucket, storage_object_key, content_sha256, media_order, shot_type, source_event_id)
  VALUES (v_agg, v_tenant, v_rooftop, v_episode, v_root::uuid, 'approved', v_open, v_arev, pl->>'rendition_id', pl#>>'{storage_ref,bucket}',
      pl#>>'{storage_ref,object_key}', pl->>'content_sha256', (pl->>'media_order')::integer, pl->>'shot_type', v_evt)
  ON CONFLICT (media_id) DO UPDATE SET state = 'approved', active_in_gallery = EXCLUDED.active_in_gallery,
    approval_revision = EXCLUDED.approval_revision, rendition_id = EXCLUDED.rendition_id, storage_bucket = EXCLUDED.storage_bucket,
    storage_object_key = EXCLUDED.storage_object_key, content_sha256 = EXCLUDED.content_sha256, media_order = EXCLUDED.media_order,
    shot_type = EXCLUDED.shot_type, source_event_id = EXCLUDED.source_event_id, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION rtgip_fx.labels_apply(e jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid; v_src text := e#>>'{origin,app}'; v_evt text := e#>>'{origin,event_id}'; v_sha text := rtgip_fx.envelope_sha(e);
  prev rtgip_fx.applied%ROWTYPE; r jsonb;
BEGIN
  BEGIN
    v_id := (e->>'event_id')::uuid;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_reference');
  END;
  IF v_id IS NULL OR v_src IS NULL OR v_evt IS NULL OR e->>'source_app' IS DISTINCT FROM v_src THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'provenance_missing');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rtgip_fx.event:' || v_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('rtgip_fx.origin:' || v_src || ':' || v_evt, 0));
  SELECT * INTO prev FROM rtgip_fx.applied a WHERE a.event_id = v_id;
  IF FOUND THEN
    RETURN CASE WHEN prev.envelope_sha256 = v_sha THEN prev.outcome || jsonb_build_object('duplicate', true)
      ELSE jsonb_build_object('ok', false, 'reason', 'conflicting_duplicate') END;
  END IF;
  IF EXISTS (SELECT 1 FROM rtgip_fx.applied a WHERE a.source_app = v_src AND a.source_event_id = v_evt) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'origin_event_reused');
  END IF;
  r := rtgip_fx.labels_effect(e, v_sha);
  IF (r->>'ok')::boolean THEN
    r := jsonb_build_object('reason', CASE WHEN (r->>'review')::boolean THEN 'review_opened' ELSE 'applied' END) || r;
    -- Only accepted effects are remembered, so a refusal (unmapped rooftop, unknown episode) can succeed once fixed.
    INSERT INTO rtgip_fx.applied (event_id, source_app, source_event_id, envelope_sha256, event_type, tenant_id, outcome)
    VALUES (v_id, v_src, v_evt, v_sha, e->>'event_type', (e->>'tenant_id')::uuid, r);
  END IF;
  RETURN r;
END $$;

DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip_fx FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','rtgip_source_reader'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip_fx FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA rtgip_fx FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA rtgip_fx FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION rtgip_fx.labels_apply(jsonb) TO rtgip_labels_consumer;
-- The inbox receiver runs the effect inside its own admission transaction: it may assume the
-- consumer role for that call, and nothing else.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_inbox_receiver') THEN
    GRANT rtgip_labels_consumer TO rtgip_inbox_receiver;
  END IF;
END $$;
