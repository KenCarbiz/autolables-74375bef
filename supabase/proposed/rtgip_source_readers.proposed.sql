-- PROPOSED ONLY. NOT A MIGRATION. DO NOT APPLY WITHOUT SEPARATE PRIVILEGED APPROVAL.
-- rtgip/2 authoritative source readers for AutoLabels. Requires the (also unapplied) spine
-- 20261030000000_rooftopos_spine.sql and PR #46 20261109000000_vehicle_history_foundation.sql.
-- Read-only: no table, column, trigger or policy is created or changed outside rtgip_src.
-- Each reader returns exactly the record shape the parked producers in
-- src/lib/rooftopos-parked/rtgip2-autolabels/producer.ts take, read from the tenant-scoped
-- custody tables, so a producer never relies on a caller-supplied "trusted" object.
-- Only the NOLOGIN rtgip_source_reader role may execute them; a deployment grants it to the
-- server's dispatch login only. Browser roles and service_role are explicitly denied.
--
-- Identity mapping (rtgip/2 vehicle ref):
--   episode_id  = public.vehicle_instances.id (one row per custody episode)
--   instance_id = the root of that row's previous_instance_id chain (stable across reacquisitions)
--   stock_number = public.vehicle_files.stock_number of the episode's listing

CREATE SCHEMA IF NOT EXISTS rtgip_src;
REVOKE ALL ON SCHEMA rtgip_src FROM PUBLIC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_source_reader') THEN
    CREATE ROLE rtgip_source_reader NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA rtgip_src TO rtgip_source_reader;

CREATE OR REPLACE FUNCTION rtgip_src.labels_episode_json(v public.vehicle_instances) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'episode_id', v.id::text, 'tenant_id', v.tenant_id::text, 'vin', v.vin,
    'instance_id', (WITH RECURSIVE chain(id, prev, depth) AS (
        SELECT v.id, v.previous_instance_id, 0
        UNION ALL
        SELECT p.id, p.previous_instance_id, c.depth + 1 FROM chain c
        JOIN public.vehicle_instances p ON p.id = c.prev AND p.tenant_id = v.tenant_id AND p.vin = v.vin
        WHERE c.depth < 64)
      SELECT id::text FROM chain ORDER BY depth DESC LIMIT 1),
    'opened_reason', v.opened_reason, 'previous_episode_id', v.previous_instance_id::text,
    'custody_state', v.custody_state,
    'status', CASE WHEN v.status = 'active' THEN 'active' ELSE 'disposed' END)
$$;

CREATE OR REPLACE FUNCTION rtgip_src.labels_milestone_json(m public.vehicle_custody_milestones) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', m.id::text, 'tenant_id', m.tenant_id::text, 'episode_id', m.instance_id::text, 'vin', m.vin,
    'milestone', m.milestone, 'to_state', m.to_state,
    'occurred_at', to_char(m.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source', m.source, 'confirmed_by', m.confirmed_by::text, 'corrects_id', m.corrects_id::text)
$$;

-- Everything episodeOpened() needs, for one episode of one tenant. NULL when the episode is
-- not this tenant's (the caller cannot learn whether it exists elsewhere).
CREATE OR REPLACE FUNCTION rtgip_src.labels_episode_history(p_tenant uuid, p_episode uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.vehicle_instances%ROWTYPE; stock text; ep jsonb;
BEGIN
  SELECT * INTO v FROM public.vehicle_instances vi WHERE vi.id = p_episode AND vi.tenant_id = p_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT f.stock_number INTO stock FROM public.vehicle_listings l
    JOIN public.vehicle_files f ON f.id = l.vehicle_file_id AND f.tenant_id = l.tenant_id
    WHERE l.id = v.listing_id AND l.tenant_id = p_tenant;
  ep := rtgip_src.labels_episode_json(v);
  RETURN jsonb_build_object(
    'instance', jsonb_build_object('vin', v.vin, 'instance_id', ep->>'instance_id', 'episode_id', v.id::text,
      'episode_state', CASE WHEN v.status = 'active' AND v.custody_state IN ('in_stock','sold','awaiting_delivery') THEN 'open' ELSE 'closed' END,
      'stock_number', stock),
    'episode', ep,
    'vin_episodes', coalesce((SELECT jsonb_agg(rtgip_src.labels_episode_json(o) ORDER BY o.created_at, o.id)
      FROM public.vehicle_instances o WHERE o.tenant_id = p_tenant AND o.vin = v.vin AND o.id <> v.id), '[]'::jsonb),
    'predecessor_milestones', coalesce((SELECT jsonb_agg(rtgip_src.labels_milestone_json(m) ORDER BY m.occurred_at, m.id)
      FROM public.vehicle_custody_milestones m
      WHERE m.tenant_id = p_tenant AND m.vin = v.vin AND m.instance_id = v.previous_instance_id), '[]'::jsonb),
    'review', (SELECT jsonb_build_object('id', r.id::text, 'tenant_id', r.tenant_id::text, 'vin', r.vin,
        'prior_episode_id', r.prior_instance_id::text, 'status', r.status, 'decision', r.decision,
        'decided_by', r.decided_by::text, 'resulting_episode_id', r.resulting_instance_id::text)
      FROM public.vehicle_reappearance_reviews r
      WHERE r.tenant_id = p_tenant AND r.vin = v.vin AND r.resulting_instance_id = v.id
      ORDER BY r.decided_at DESC NULLS LAST, r.id LIMIT 1));
END $$;

-- Every milestone of one episode (saleMilestone() needs the row and its corrections).
CREATE OR REPLACE FUNCTION rtgip_src.labels_episode_milestones(p_tenant uuid, p_episode uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.vehicle_instances vi WHERE vi.id = p_episode AND vi.tenant_id = p_tenant) THEN NULL
    ELSE coalesce((SELECT jsonb_agg(rtgip_src.labels_milestone_json(m) ORDER BY m.occurred_at, m.id)
      FROM public.vehicle_custody_milestones m WHERE m.tenant_id = p_tenant AND m.instance_id = p_episode), '[]'::jsonb) END
$$;

DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip_src FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip_src FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA rtgip_src FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION rtgip_src.labels_episode_history(uuid, uuid) TO rtgip_source_reader;
GRANT EXECUTE ON FUNCTION rtgip_src.labels_episode_milestones(uuid, uuid) TO rtgip_source_reader;

NOTIFY pgrst, 'reload schema';
