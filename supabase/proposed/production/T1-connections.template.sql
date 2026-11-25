-- P2 AutoLabels PRODUCTION connections TEMPLATE (PROPOSAL, NOT APPROVED; enrollment card, not part of the dark install).
-- AutoLabels production (Supabase onnbmmdbrsgytfozfozn, Lovable 1a2a5abf, server 2a05:d018:135e:166d:40ff:d4ff:1780:16c1). One DO statement, atomic.
-- Creates the four AutoLabels connection rows for ONE production tenant and rooftop with the same route shapes as the
-- staging B4 rows, rtgip/3 from creation (send_protocol rtgip/3, accept {rtgip/3}, v3_added_at stamped by the ar3 trigger,
-- v2_accept_until NULL), producer_enabled and reader_enabled false. Run before K5-v3 so the key bindings find the rows.
-- Fill p (tenant uuid and rooftop id from the enrollment card), set status FILLED, wrap with gen_ar3.wrap via
-- gen_prod_al.py --fill-conn. Rollback while every ledger is still empty: DELETE FROM rtgip.connections WHERE tenant_id = '<tenant>'.
DO $p2al$
DECLARE
  p constant jsonb := '{"rooftop_id": "<production rooftop id>", "status": "PENDING", "tenant_id": "<production tenant uuid>"}'::jsonb;
  v_shapes constant jsonb := '[{"event_types": ["appraisal.completed", "acquisition.milestone_recorded", "acquisition.purchase_completed"], "purposes": ["acquisition_evidence", "custody_evidence"], "source_app": "autocurb", "target_app": "autolabels"}, {"event_types": ["media.approved", "media.revoked"], "purposes": ["media_reference"], "source_app": "autoframe", "target_app": "autolabels"}, {"event_types": ["vehicle.identity_registered", "inventory.status_changed", "custody.episode_opened", "custody.episode_closed", "sale.milestone_recorded", "listing.price_published"], "purposes": ["inventory_sync", "custody_evidence"], "source_app": "autolabels", "target_app": "autocurb"}, {"event_types": ["vehicle.identity_registered", "inventory.status_changed", "custody.episode_opened", "custody.episode_closed", "sale.milestone_recorded", "listing.availability_changed"], "purposes": ["inventory_sync", "custody_evidence"], "source_app": "autolabels", "target_app": "autoframe"}]'::jsonb;
  v_n integer;
  t text;
BEGIN
  IF coalesce(host(inet_server_addr()), '') <> '2a05:d018:135e:166d:40ff:d4ff:1780:16c1' THEN
    RAISE EXCEPTION 'p2al_conn_stop: wrong server %', coalesce(host(inet_server_addr()), 'null');
  END IF;
  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'p2al_conn_stop: must run as postgres (session %, current %)', session_user, current_user;
  END IF;
  IF current_setting('server_version_num')::int / 10000 <> 17 THEN
    RAISE EXCEPTION 'p2al_conn_stop: server major % is not 17', current_setting('server_version_num');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  IF p->>'status' IS DISTINCT FROM 'FILLED' THEN RAISE EXCEPTION 'p2al_conn_stop: parameters are PENDING; fill them from the enrollment card'; END IF;
  IF p->>'tenant_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p->>'rooftop_id' !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION 'p2al_conn_stop: tenant_id or rooftop_id is malformed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = (p->>'tenant_id')::uuid) THEN RAISE EXCEPTION 'p2al_conn_stop: tenant does not exist'; END IF;
  IF obj_description(to_regclass('rtgip.evidence_v3'), 'pg_class') IS DISTINCT FROM '{"version":"AR3-APP-r1","contract":"rtgip/3-contract-freeze/1","attest":"rtgip/3-attest/1"}' THEN RAISE EXCEPTION 'p2al_conn_stop: ar3 is not applied'; END IF;
  IF (SELECT count(*) FROM rtgip.delivery_config) <> 1 OR EXISTS (SELECT 1 FROM rtgip.delivery_config WHERE id IS NOT TRUE OR transport_enabled IS DISTINCT FROM false OR local_app IS DISTINCT FROM 'autolabels') THEN
    RAISE EXCEPTION 'p2al_conn_stop: delivery_config is not the single dark row (transport_enabled false, local_app autolabels)';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'rtgip.delivery_config'::regclass AND contype = 'c'
        AND conname = 'delivery_config_transport_enabled_check' AND pg_get_constraintdef(oid) = 'CHECK ((transport_enabled = false))') <> 1 THEN
    RAISE EXCEPTION 'p2al_conn_stop: the transport CHECK lock is not the pinned definition';
  END IF;
  FOREACH t IN ARRAY ARRAY['connections', 'outbox', 'receipts', 'inbox', 'inbox_deliveries', 'inbox_conflicts', 'admissions', 'watermarks', 'nonce_claims', 'signing_keys'] LOOP
    EXECUTE format('SELECT count(*) FROM rtgip.%I', t) INTO v_n;
    IF v_n <> 0 THEN RAISE EXCEPTION 'p2al_conn_stop: rtgip.% has % rows, expected 0 on the dark production node', t, v_n; END IF;
  END LOOP;

  INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status,
                                 send_protocol, accept_protocols, v2_accept_until)
  SELECT 'conn:' || (s->>'source_app') || '>' || (s->>'target_app') || ':' || (p->>'tenant_id') || ':' || (p->>'rooftop_id'),
         s->>'source_app', s->>'target_app', p->>'tenant_id', ARRAY[p->>'rooftop_id'],
         ARRAY(SELECT jsonb_array_elements_text(s->'event_types')), ARRAY(SELECT jsonb_array_elements_text(s->'purposes')),
         false, false, 'active', 'rtgip/3', '{rtgip/3}', NULL
    FROM jsonb_array_elements(v_shapes) s;
  SELECT count(*) INTO v_n FROM rtgip.connections
   WHERE send_protocol = 'rtgip/3' AND accept_protocols = '{rtgip/3}' AND v3_added_at IS NOT NULL AND v2_accept_until IS NULL
     AND NOT producer_enabled AND NOT reader_enabled AND status = 'active' AND tenant_id = p->>'tenant_id';
  IF v_n <> 4 OR (SELECT count(*) FROM rtgip.connections) <> 4 THEN RAISE EXCEPTION 'p2al_conn_check: expected exactly 4 rtgip/3-only dark rows, found %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM rtgip.connections c WHERE rtgip.gate_verdict(c.accept_protocols, c.v3_added_at, c.v2_accept_until, 'rtgip/2', floor(extract(epoch FROM rtgip.clock()))::bigint) IS NULL) THEN
    RAISE EXCEPTION 'p2al_conn_check: a connection would accept rtgip/2';
  END IF;
  IF (SELECT transport_enabled FROM rtgip.delivery_config) IS DISTINCT FROM false THEN RAISE EXCEPTION 'p2al_conn_check: transport is not false'; END IF;
  RAISE NOTICE 'p2al_conn_ok: 4 connections, rtgip/3 only, flags off, transport off';
END
$p2al$;
