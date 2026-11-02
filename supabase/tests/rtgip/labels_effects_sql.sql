-- Phase 3D A4/A6: durable inactive AutoLabels consumer effects. Scratch cluster from
-- pg_integration.sh only; one transaction, rolled back. Synthetic data only.
BEGIN;

CREATE TEMP TABLE _x AS SELECT
  gen_random_uuid() AS ta, gen_random_uuid() AS tb, gen_random_uuid() AS s1, gen_random_uuid() AS s2, gen_random_uuid() AS sb,
  gen_random_uuid() AS e_open, gen_random_uuid() AS e_open2, gen_random_uuid() AS e_closed, gen_random_uuid() AS mapper;
GRANT SELECT ON _x TO PUBLIC;

INSERT INTO auth.users (id, email) SELECT mapper, 'fx-' || mapper || '@example.test' FROM _x;
INSERT INTO public.tenants (id, name, slug) SELECT ta, 'Synthetic FX A', 'fx-a-' || ta FROM _x UNION ALL SELECT tb, 'Synthetic FX B', 'fx-b-' || tb FROM _x;
INSERT INTO public.dealer_stores (id, tenant_id) SELECT s1, ta FROM _x UNION ALL SELECT s2, ta FROM _x UNION ALL SELECT sb, tb FROM _x;
INSERT INTO rtgip_src.rooftop_stores (tenant_id, rooftop_id, store_id, mapped_by, reason)
  SELECT ta, 'rf-fx-01', s1, mapper, 'synthetic mapping' FROM _x UNION ALL SELECT ta, 'rf-fx-02', s2, mapper, 'synthetic mapping' FROM _x
  UNION ALL SELECT tb, 'rf-fx-b1', sb, mapper, 'synthetic mapping' FROM _x;
INSERT INTO public.vehicles (vin) VALUES ('1FX0000000000A001'), ('1FX0000000000A002'), ('1FX0000000000A003') ON CONFLICT DO NOTHING;
SELECT set_config('vehicle_history.custody_writer', 'on', true);
INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason)
  SELECT e_open, ta, '1FX0000000000A001', s1, 'active', 'in_stock', 'initial' FROM _x
  UNION ALL SELECT e_open2, ta, '1FX0000000000A003', s1, 'active', 'in_stock', 'initial' FROM _x;
INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, disposed_at, disposition)
  SELECT e_closed, ta, '1FX0000000000A002', s1, 'disposed', 'delivered', 'initial', now() - interval '5 days', 'retail_sale' FROM _x;
SELECT set_config('vehicle_history.custody_writer', '', true);

-- Envelope with only the fields the consumer reads; admission has already verified the rest.
CREATE FUNCTION pg_temp.env(p_type text, p_src text, p_evt text, p_tenant uuid, p_rooftop text, p_inst text, p_ep text, p_vin text,
  p_agg text, p_arev int, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_type', p_type, 'source_app', p_src, 'target_app', 'autolabels', 'tenant_id', p_tenant, 'rooftop_id', p_rooftop,
    'vehicle', jsonb_build_object('vin', p_vin, 'instance_id', p_inst, 'episode_id', p_ep),
    'aggregate', jsonb_build_object('id', p_agg, 'revision', p_arev),
    'origin', jsonb_build_object('app', p_src, 'event_id', p_evt, 'revision', p_arev), 'payload', p_payload);
$$;
CREATE FUNCTION pg_temp.ap(e jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('role', 'rtgip_labels_consumer', true);
  r := rtgip_fx.labels_apply(e);
  PERFORM set_config('role', 'postgres', true);
  RETURN r;
END $$;
CREATE FUNCTION pg_temp.check(p_got jsonb, p_ok boolean, p_reason text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (p_got->>'ok')::boolean IS DISTINCT FROM p_ok OR (p_reason IS NOT NULL AND p_got->>'reason' IS DISTINCT FROM p_reason) THEN
    RAISE EXCEPTION 'FAIL %: got %', p_label, p_got;
  END IF;
END $$;
CREATE FUNCTION pg_temp.purchase(p_evt text, p_tenant uuid, p_rooftop text, p_inst text, p_ep text, p_vin text, p_agg text, p_rev int,
  p_audit text DEFAULT 'audit-1') RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.env('acquisition.purchase_completed', 'autocurb', p_evt, p_tenant, p_rooftop, p_inst, p_ep, p_vin, p_agg, p_rev,
    jsonb_build_object('purchase_ref', 'po-' || p_agg, 'custody_transferred', true, 'custody_at', '2026-11-01T15:00:00Z',
      'verified_by_ref', 'staff-ref-1', 'audit_ref', p_audit, 'ownership_evidence_refs', jsonb_build_array('title-1'),
      'condition_evidence_refs', jsonb_build_array('insp-1')));
$$;
CREATE FUNCTION pg_temp.media(p_type text, p_evt text, p_tenant uuid, p_inst text, p_ep text, p_vin text, p_media text, p_rev int,
  p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.env(p_type, 'autoframe', p_evt, p_tenant, 'rf-fx-01', p_inst, p_ep, p_vin, p_media, p_rev,
    CASE WHEN p_type = 'media.approved' THEN jsonb_build_object('media_id', p_media, 'rendition_id', 'r-' || p_rev,
      'storage_ref', jsonb_build_object('bucket', 'af', 'object_key', p_tenant || '/rf-fx-01/' || p_inst || '/' || p_media || '.jpg'),
      'content_sha256', repeat('a', 64), 'media_order', 1, 'shot_type', 'front_3q')
    ELSE jsonb_build_object('media_id', p_media, 'reason', 'dealer_removed', 'revoked_at', '2026-11-01T16:00:00Z',
      'revocation_audit_ref', 'rev-audit-' || p_rev) END || p_extra);
$$;

CREATE TEMP TABLE _before AS
  SELECT (SELECT md5(string_agg(to_jsonb(v)::text, ',' ORDER BY v.id)) FROM public.vehicle_instances v) AS inst,
         (SELECT md5(coalesce(string_agg(to_jsonb(l)::text, ',' ORDER BY l.id), '')) FROM public.vehicle_listings l) AS listings,
         (SELECT count(*) FROM public.vehicle_custody_milestones) AS milestones;

-- X1 (A6.10). Acquisition evidence aimed at the wrong tenant, rooftop, VIN, instance or episode is refused.
DO $$
DECLARE x _x%ROWTYPE; o text; c text;
BEGIN
  SELECT * INTO x FROM _x; o := x.e_open::text; c := x.e_closed::text;
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.tb, 'rf-fx-b1', o, o, '1FX0000000000A001', 'acq-1', 1)), false, 'episode_not_registered', 'other tenant');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-02', o, o, '1FX0000000000A001', 'acq-1', 1)), false, 'episode_rooftop_mismatch', 'other rooftop');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-09', o, o, '1FX0000000000A001', 'acq-1', 1)), false, 'rooftop_unmapped', 'unmapped rooftop');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-01', o, o, '1FX0000000000A002', 'acq-1', 1)), false, 'vin_mismatch', 'vin');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-01', c, o, '1FX0000000000A001', 'acq-1', 1)), false, 'instance_mismatch', 'instance');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-01', o, 'not-a-uuid', '1FX0000000000A001', 'acq-1', 1)), false, 'bad_reference', 'episode ref');
  IF EXISTS (SELECT 1 FROM rtgip_fx.acquisition_evidence) OR EXISTS (SELECT 1 FROM rtgip_fx.applied) THEN RAISE EXCEPTION 'FAIL X1: refused evidence was stored'; END IF;
  -- The correct binding is accepted; the same acquisition cannot then move to another episode.
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-01', o, o, '1FX0000000000A001', 'acq-1', 1)), true, NULL, 'accepted');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-2', x.ta, 'rf-fx-01', x.e_open2::text, x.e_open2::text, '1FX0000000000A003', 'acq-1', 2)),
    false, 'acquisition_episode_reassignment', 'reassignment');
  RAISE NOTICE 'PASS X1 acquisition evidence on the wrong tenant, rooftop, VIN, instance or episode is refused';
END $$;

-- X2 (A6.4/5). Duplicates are idempotent, a changed body is refused, an older revision is ignored.
DO $$
DECLARE x _x%ROWTYPE; o text; r jsonb;
BEGIN
  SELECT * INTO x FROM _x; o := x.e_open::text;
  r := pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-01', o, o, '1FX0000000000A001', 'acq-1', 1));
  IF NOT (r->>'duplicate')::boolean THEN RAISE EXCEPTION 'FAIL X2 duplicate: %', r; END IF;
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-1', x.ta, 'rf-fx-01', o, o, '1FX0000000000A001', 'acq-1', 1, 'audit-changed')),
    false, 'conflicting_duplicate', 'changed body');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-3', x.ta, 'rf-fx-01', o, o, '1FX0000000000A001', 'acq-1', 1)), false, 'stale_revision', 'stale');
  IF (SELECT count(*) FROM rtgip_fx.acquisition_evidence) <> 1 THEN RAISE EXCEPTION 'FAIL X2: evidence rows'; END IF;
  RAISE NOTICE 'PASS X2 duplicate replays return the first answer; changed or stale events are refused';
END $$;

-- X3. A provisional AutoCurb acquisition opens a review and creates no inventory.
DO $$
DECLARE x _x%ROWTYPE; n int := (SELECT count(*) FROM public.vehicle_instances);
BEGIN
  SELECT * INTO x FROM _x;
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-4', x.ta, 'rf-fx-01', 'acq:inst-9', 'acq:ep-9', '1FX0000000000A009', 'acq-9', 1)), true, NULL, 'provisional');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.purchase('ac-5', x.ta, 'rf-fx-01', 'acq:inst-8', 'acq:ep-8', '1FX0000000000A002', 'acq-8', 1)), true, NULL, 'provisional known vin');
  IF (SELECT count(*) FROM public.vehicle_instances) <> n THEN RAISE EXCEPTION 'FAIL X3: inventory created'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rtgip_fx.reconciliation_reviews WHERE source_event_id = 'ac-4' AND kind = 'identity_reconciliation' AND prior_episode_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM rtgip_fx.reconciliation_reviews WHERE source_event_id = 'ac-5' AND kind = 'reappearance' AND prior_episode_id = x.e_closed) THEN
    RAISE EXCEPTION 'FAIL X3: reviews missing';
  END IF;
  RAISE NOTICE 'PASS X3 provisional acquisitions open a review and never create inventory';
END $$;

-- X4. Acquisition evidence for a delivered episode becomes a custody review; the episode stays closed.
DO $$
DECLARE x _x%ROWTYPE; c text; r jsonb;
BEGIN
  SELECT * INTO x FROM _x; c := x.e_closed::text;
  r := pg_temp.ap(pg_temp.purchase('ac-6', x.ta, 'rf-fx-01', c, c, '1FX0000000000A002', 'acq-6', 1));
  IF NOT (r->>'review')::boolean OR r->>'reason' <> 'episode_closed' THEN RAISE EXCEPTION 'FAIL X4: %', r; END IF;
  IF EXISTS (SELECT 1 FROM rtgip_fx.acquisition_evidence WHERE episode_id = x.e_closed)
     OR NOT EXISTS (SELECT 1 FROM rtgip_fx.reconciliation_reviews WHERE source_event_id = 'ac-6' AND kind = 'custody_review')
     OR (SELECT status || '/' || custody_state FROM public.vehicle_instances WHERE id = x.e_closed) <> 'disposed/delivered' THEN
    RAISE EXCEPTION 'FAIL X4: closed episode changed or evidence attached';
  END IF;
  RAISE NOTICE 'PASS X4 evidence for a delivered episode opens a custody review and reopens nothing';
END $$;

-- X5. Media: scoped storage, revocation tombstone, reinstatement only with a fresh audited reference.
DO $$
DECLARE x _x%ROWTYPE; o text;
BEGIN
  SELECT * INTO x FROM _x; o := x.e_open::text;
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-0', x.ta, o, o, '1FX0000000000A001', 'm-1', 1,
    jsonb_build_object('storage_ref', jsonb_build_object('bucket', 'af', 'object_key', x.tb || '/rf-fx-01/' || o || '/m-1.jpg')))), false, 'storage_ref_out_of_scope', 'scope');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-1', x.ta, o, o, '1FX0000000000A001', 'm-1', 1)), true, NULL, 'approve');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.revoked', 'af-2', x.ta, o, o, '1FX0000000000A001', 'm-1', 2)), true, NULL, 'revoke');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-1b', x.ta, o, o, '1FX0000000000A001', 'm-1', 1)), false, 'stale_revision', 'stale approve');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-3', x.ta, o, o, '1FX0000000000A001', 'm-1', 3)), false, 'revoked_media_requires_reinstatement', 'no reinstatement');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-3', x.ta, o, o, '1FX0000000000A001', 'm-1', 3,
    '{"reinstatement_audit_ref":"rev-audit-2"}')), false, 'reinstatement_ref_reused', 'revocation ref reused');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-3', x.ta, o, o, '1FX0000000000A001', 'm-1', 3,
    '{"reinstatement_audit_ref":"reinst-1"}')), true, NULL, 'reinstated');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.revoked', 'af-4', x.ta, o, o, '1FX0000000000A001', 'm-1', 4)), true, NULL, 'revoke again');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-5', x.ta, o, o, '1FX0000000000A001', 'm-1', 5,
    '{"reinstatement_audit_ref":"reinst-1"}')), false, 'reinstatement_ref_reused', 'reinstatement ref reused');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-6', x.ta, x.e_open2::text, x.e_open2::text, '1FX0000000000A003', 'm-1', 6,
    '{"reinstatement_audit_ref":"reinst-2"}')), false, 'media_vehicle_reassignment', 'media moved');
  IF (SELECT state FROM rtgip_fx.media_refs WHERE media_id = 'm-1') <> 'revoked' OR (SELECT count(*) FROM rtgip_fx.media_revocations WHERE media_id = 'm-1') <> 2 THEN
    RAISE EXCEPTION 'FAIL X5: media state';
  END IF;
  RAISE NOTICE 'PASS X5 media stays scoped; revocations are tombstones; reinstatement needs a fresh audited reference';
END $$;

-- X6 (A6.11). Media revoked after the episode closed is recorded and reactivates nothing.
DO $$
DECLARE x _x%ROWTYPE; c text;
BEGIN
  SELECT * INTO x FROM _x; c := x.e_closed::text;
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-c1', x.ta, c, c, '1FX0000000000A002', 'm-c', 1)), true, NULL, 'closed approve');
  IF (SELECT active_in_gallery FROM rtgip_fx.media_refs WHERE media_id = 'm-c') THEN RAISE EXCEPTION 'FAIL X6: closed episode gallery active'; END IF;
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.revoked', 'af-c2', x.ta, c, c, '1FX0000000000A002', 'm-c', 2)), true, NULL, 'closed revoke');
  PERFORM pg_temp.check(pg_temp.ap(pg_temp.media('media.approved', 'af-c3', x.ta, c, c, '1FX0000000000A002', 'm-c', 3,
    '{"reinstatement_audit_ref":"reinst-c"}')), false, 'closed_episode_cannot_reinstate', 'closed reinstate');
  IF NOT (SELECT episode_closed FROM rtgip_fx.media_revocations WHERE source_event_id = 'af-c2')
     OR (SELECT status || '/' || custody_state FROM public.vehicle_instances WHERE id = x.e_closed) <> 'disposed/delivered' THEN
    RAISE EXCEPTION 'FAIL X6: tombstone or episode state';
  END IF;
  RAISE NOTICE 'PASS X6 a revocation after closure is a tombstone and the episode stays closed';
END $$;

-- X7 (A6.12). No consumer effect wrote inventory, listings, prices or custody milestones.
DO $$
BEGIN
  IF (SELECT md5(string_agg(to_jsonb(v)::text, ',' ORDER BY v.id)) FROM public.vehicle_instances v) IS DISTINCT FROM (SELECT inst FROM _before)
     OR (SELECT md5(coalesce(string_agg(to_jsonb(l)::text, ',' ORDER BY l.id), '')) FROM public.vehicle_listings l) IS DISTINCT FROM (SELECT listings FROM _before)
     OR (SELECT count(*) FROM public.vehicle_custody_milestones) <> (SELECT milestones FROM _before) THEN
    RAISE EXCEPTION 'FAIL X7: consumer changed inventory, listing, price or custody rows';
  END IF;
  RAISE NOTICE 'PASS X7 inventory, listings, prices and custody milestones are byte-identical after every effect';
END $$;

-- X8. Ledgers are append-only and the entry point is only for the consumer role.
DO $$
DECLARE ok boolean;
BEGIN
  BEGIN UPDATE rtgip_fx.acquisition_evidence SET kind = 'x'; RAISE EXCEPTION 'FAIL X8: evidence updated';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'append_only%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM rtgip_fx.media_revocations; RAISE EXCEPTION 'FAIL X8: tombstone deleted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'append_only%' THEN RAISE; END IF; END;
  BEGIN DELETE FROM rtgip_fx.applied; RAISE EXCEPTION 'FAIL X8: ledger deleted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'append_only%' THEN RAISE; END IF; END;
  FOREACH ok IN ARRAY ARRAY[
    has_function_privilege('authenticated', 'rtgip_fx.labels_apply(jsonb)', 'EXECUTE'),
    has_function_privilege('anon', 'rtgip_fx.labels_apply(jsonb)', 'EXECUTE'),
    has_function_privilege('service_role', 'rtgip_fx.labels_apply(jsonb)', 'EXECUTE'),
    has_function_privilege('rtgip_labels_consumer', 'rtgip_fx.labels_effect(jsonb, text)', 'EXECUTE'),
    has_table_privilege('rtgip_labels_consumer', 'rtgip_fx.media_refs', 'SELECT'),
    has_table_privilege('authenticated', 'rtgip_fx.applied', 'SELECT')] LOOP
    IF ok THEN RAISE EXCEPTION 'FAIL X8: privilege leak'; END IF;
  END LOOP;
  IF NOT has_function_privilege('rtgip_labels_consumer', 'rtgip_fx.labels_apply(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL X8: consumer cannot apply'; END IF;
  RAISE NOTICE 'PASS X8 ledgers are append-only and only the consumer role can apply';
END $$;

ROLLBACK;
