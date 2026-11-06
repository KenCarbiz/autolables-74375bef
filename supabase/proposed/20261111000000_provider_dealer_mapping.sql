-- PROPOSED, NOT APPLIED. Needs Ken's approval before it runs anywhere.
--
-- Secure rooftop mapping for provider (MarketCheck) dealer ids, and the
-- "no verified rooftop" rule in the scope report (PR #57 corrections, Nov 6 2026).
--
-- 1. dealer_stores provider-dealer guard: one MarketCheck dealer id belongs to
--    one store across every tenant. Enforced by a trigger, so no writer
--    (including inv_admin_save_store) can map an id to a second rooftop.
--    Ids must be digits only.
-- 2. store_provider_mapping_events: append-only record of every map/unmap with
--    the actor, time, previous and new ids, evidence, reason and the number of
--    listings that moved. Platform admins read all; tenant members read their
--    own (canonical RLS shape).
-- 3. inv_admin_map_provider_dealer(...): the only path the Inventory by store
--    screen uses. Platform admin only (server-checked), optimistic concurrency
--    on dealer_stores.updated_at, reason and evidence required, the evidence
--    must name the destination store (explicit confirmation). "unmap" is the
--    rollback of a mapping and is recorded the same way.
-- 4. inventory_scope_report: a listing with no feed owner and no provider
--    dealer id is held for rooftop review when the tenant has more than one
--    store (it was counted as primary). Matches src/lib/inventoryScope.
--
-- Preconditions: drizzle 0006 and 0018 applied. Preflight (read-only):
--   SELECT d, count(DISTINCT s.id) FROM dealer_stores s,
--     LATERAL jsonb_array_elements_text(CASE jsonb_typeof(s.provider_ids->'marketcheck_dealer_id') WHEN 'array' THEN s.provider_ids->'marketcheck_dealer_id' ELSE jsonb_build_array(s.provider_ids->'marketcheck_dealer_id') END) d
--    WHERE d IS NOT NULL GROUP BY d HAVING count(DISTINCT s.id) > 1;   -- must return 0 rows
-- Production on Nov 6 2026: every dealer_stores.provider_ids is {}.
-- Rollback: 20261111000000_provider_dealer_mapping.rollback.sql.

CREATE OR REPLACE FUNCTION public.dealer_store_mc_dealer_ids(p jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT trim(x)) FILTER (WHERE NULLIF(trim(x), '') IS NOT NULL), '{}')
    FROM (
      SELECT jsonb_array_elements_text(CASE jsonb_typeof(p->'marketcheck_dealer_id') WHEN 'array' THEN p->'marketcheck_dealer_id' ELSE '[]'::jsonb END) AS x
      UNION ALL
      SELECT p->>'marketcheck_dealer_id' WHERE jsonb_typeof(p->'marketcheck_dealer_id') IN ('string','number')
    ) ids
$$;

CREATE OR REPLACE FUNCTION public.dealer_stores_provider_dealer_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids text[] := dealer_store_mc_dealer_ids(COALESCE(NEW.provider_ids, '{}'::jsonb)); v_bad text; v_other uuid;
BEGIN
  IF cardinality(v_ids) = 0 THEN RETURN NEW; END IF;
  SELECT x INTO v_bad FROM unnest(v_ids) x WHERE x !~ '^[0-9]{1,12}$' LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'provider_dealer_id_invalid: %', v_bad USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dealer_stores.marketcheck_dealer_id'));
  SELECT s.id INTO v_other FROM dealer_stores s
   WHERE s.id <> NEW.id AND dealer_store_mc_dealer_ids(COALESCE(s.provider_ids, '{}'::jsonb)) && v_ids LIMIT 1;
  IF v_other IS NOT NULL THEN RAISE EXCEPTION 'provider_dealer_id_mapped_to_other_store' USING ERRCODE = '23505'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dealer_stores_provider_dealer_guard ON public.dealer_stores;
CREATE TRIGGER dealer_stores_provider_dealer_guard BEFORE INSERT OR UPDATE OF provider_ids ON public.dealer_stores
  FOR EACH ROW EXECUTE FUNCTION public.dealer_stores_provider_dealer_guard();

CREATE TABLE IF NOT EXISTS public.store_provider_mapping_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid NOT NULL,
  tenant_id uuid NOT NULL,
  group_id uuid,
  store_id uuid NOT NULL REFERENCES public.dealer_stores(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'marketcheck' CHECK (provider = 'marketcheck'),
  provider_dealer_id text NOT NULL CHECK (provider_dealer_id ~ '^[0-9]{1,12}$'),
  action text NOT NULL CHECK (action IN ('map','unmap')),
  previous_ids jsonb NOT NULL,
  next_ids jsonb NOT NULL,
  evidence jsonb NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  affected_listings integer NOT NULL
);
CREATE INDEX IF NOT EXISTS store_provider_mapping_events_tenant_at ON public.store_provider_mapping_events (tenant_id, at DESC);

CREATE OR REPLACE FUNCTION public.store_provider_mapping_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'store_provider_mapping_events_append_only'; END $$;
DROP TRIGGER IF EXISTS store_provider_mapping_events_append_only ON public.store_provider_mapping_events;
CREATE TRIGGER store_provider_mapping_events_append_only BEFORE UPDATE OR DELETE ON public.store_provider_mapping_events
  FOR EACH ROW EXECUTE FUNCTION public.store_provider_mapping_events_append_only();

ALTER TABLE public.store_provider_mapping_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Platform admins read mapping events" ON public.store_provider_mapping_events;
CREATE POLICY "Platform admins read mapping events" ON public.store_provider_mapping_events FOR SELECT
  TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Members read own mapping events" ON public.store_provider_mapping_events;
CREATE POLICY "Members read own mapping events" ON public.store_provider_mapping_events FOR SELECT
  TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.store_provider_mapping_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.inv_admin_map_provider_dealer(
  p_store_id uuid, p_dealer_id text, p_action text, p_expected_updated_at timestamptz, p_evidence jsonb, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin();
  v_store public.dealer_stores%ROWTYPE;
  v_dealer text := trim(COALESCE(p_dealer_id, ''));
  v_prev text[]; v_next text[]; v_affected integer; v_event bigint;
BEGIN
  IF p_action NOT IN ('map','unmap') THEN RAISE EXCEPTION 'action_invalid' USING ERRCODE = '22023'; END IF;
  IF v_dealer !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'provider_dealer_id_invalid' USING ERRCODE = '22023'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' OR NULLIF(trim(p_evidence->>'source'), '') IS NULL THEN
    RAISE EXCEPTION 'evidence_required' USING ERRCODE = '22023';
  END IF;
  IF p_evidence->>'confirmed_destination' IS DISTINCT FROM p_store_id::text THEN
    RAISE EXCEPTION 'destination_not_confirmed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_store FROM dealer_stores WHERE id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'store_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_updated_at IS NOT NULL AND p_expected_updated_at IS DISTINCT FROM v_store.updated_at THEN
    RAISE EXCEPTION 'store_changed_since_loaded' USING ERRCODE = '40001';
  END IF;
  IF p_action = 'map' AND v_store.status <> 'active' THEN RAISE EXCEPTION 'store_inactive' USING ERRCODE = '22023'; END IF;

  v_prev := dealer_store_mc_dealer_ids(COALESCE(v_store.provider_ids, '{}'::jsonb));
  IF p_action = 'map' THEN
    IF v_dealer = ANY (v_prev) THEN RAISE EXCEPTION 'already_mapped' USING ERRCODE = '22023'; END IF;
    v_next := v_prev || v_dealer;
  ELSE
    IF NOT (v_dealer = ANY (v_prev)) THEN RAISE EXCEPTION 'not_mapped' USING ERRCODE = '22023'; END IF;
    v_next := array_remove(v_prev, v_dealer);
  END IF;

  SELECT count(*) INTO v_affected FROM vehicle_listings vl
   WHERE vl.tenant_id = v_store.tenant_id AND vl.owning_store_id IS NULL AND vl.status <> 'archived'
     AND NULLIF(trim(vl.mc_raw->'dealer'->>'id'), '') = v_dealer;

  -- The provider-dealer guard trigger refuses an id mapped to any other store;
  -- the inventory_network_audit trigger records the before/after row.
  UPDATE dealer_stores
     SET provider_ids = jsonb_set(COALESCE(provider_ids, '{}'::jsonb), '{marketcheck_dealer_id}', to_jsonb(v_next)),
         updated_by = v_uid
   WHERE id = p_store_id;

  INSERT INTO store_provider_mapping_events (actor, tenant_id, group_id, store_id, provider_dealer_id, action, previous_ids, next_ids, evidence, reason, affected_listings)
  VALUES (v_uid, v_store.tenant_id, v_store.group_id, p_store_id, v_dealer, p_action, to_jsonb(v_prev), to_jsonb(v_next), p_evidence, left(trim(p_reason), 500), v_affected)
  RETURNING id INTO v_event;

  RETURN jsonb_build_object('event_id', v_event, 'store_id', p_store_id, 'action', p_action, 'previous', to_jsonb(v_prev), 'next', to_jsonb(v_next), 'affected_listings', v_affected);
END $$;
REVOKE ALL ON FUNCTION public.inv_admin_map_provider_dealer(uuid, text, text, timestamptz, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_admin_map_provider_dealer(uuid, text, text, timestamptz, jsonb, text) TO authenticated;

-- Scope report: same rules as the app. No feed owner and no provider dealer id
-- resolves to the only store of a single-rooftop tenant, otherwise to review.
CREATE OR REPLACE FUNCTION public.inventory_scope_report(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
          OR EXISTS (SELECT 1 FROM public.tenant_members tm
                      WHERE tm.tenant_id = p_tenant_id AND tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;
  WITH stores AS (
    SELECT s.id, s.display_name, s.is_primary_inventory_store AS is_primary FROM dealer_stores s WHERE s.tenant_id = p_tenant_id
  ), primary_store AS (
    SELECT id FROM stores WHERE is_primary
  ), single AS (
    SELECT CASE WHEN (SELECT count(*) FROM stores) <= 1 THEN (SELECT id FROM stores LIMIT 1) END AS id,
           (SELECT count(*) FROM stores) <= 1 AS yes
  ), dealer_map AS (
    SELECT d.dealer_id, min(s.id::text)::uuid AS store_id, count(DISTINCT s.id) AS n
      FROM dealer_stores s CROSS JOIN LATERAL unnest(dealer_store_mc_dealer_ids(COALESCE(s.provider_ids, '{}'::jsonb))) AS d(dealer_id)
     WHERE s.tenant_id = p_tenant_id
     GROUP BY d.dealer_id
  ), listings AS (
    SELECT vl.id, vl.condition, vl.owning_store_id, NULLIF(trim(vl.mc_raw->'dealer'->>'id'), '') AS mc_dealer
      FROM vehicle_listings vl WHERE vl.tenant_id = p_tenant_id AND vl.status <> 'archived'
  ), resolved AS (
    SELECT l.condition,
           CASE
             WHEN l.owning_store_id IS NOT NULL THEN CASE WHEN EXISTS (SELECT 1 FROM stores WHERE id = l.owning_store_id) THEN l.owning_store_id END
             WHEN (SELECT yes FROM single) THEN (SELECT id FROM single)
             WHEN l.mc_dealer IS NOT NULL THEN (SELECT dm.store_id FROM dealer_map dm WHERE dm.dealer_id = l.mc_dealer AND dm.n = 1)
             ELSE NULL
           END AS store_id,
           CASE WHEN l.owning_store_id IS NOT NULL THEN 'unknown_store' ELSE COALESCE(l.mc_dealer, 'no_verified_rooftop') END AS review_key
      FROM listings l
  )
  SELECT jsonb_build_object(
    'tenant_id', p_tenant_id,
    'generated_at', now(),
    'primary_store_id', (SELECT id FROM primary_store),
    'stores', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'store_id', s.id, 'name', s.display_name, 'primary', s.is_primary,
        'feed', (SELECT jsonb_build_object('present', count(*) FILTER (WHERE si.presence = 'present'),
                   'new', count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'new'),
                   'used', count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'used'),
                   'cpo', count(*) FILTER (WHERE si.presence = 'present' AND si.condition = 'cpo'),
                   'absent_not_removed', count(*) FILTER (WHERE si.presence IN ('missing','retirement_review')),
                   'last_feed_update', max(si.last_seen_at))
                 FROM store_inventory si WHERE si.store_id = s.id),
        'listings', (SELECT jsonb_build_object('total', count(*), 'new', count(*) FILTER (WHERE r.condition = 'new'),
                   'used', count(*) FILTER (WHERE r.condition = 'used'), 'cpo', count(*) FILTER (WHERE r.condition = 'cpo'))
                 FROM resolved r WHERE r.store_id = s.id)
      ) ORDER BY s.is_primary DESC, s.display_name) FROM stores s), '[]'::jsonb),
    'rooftop_review', (SELECT jsonb_build_object('total', count(*),
        'by_dealer', COALESCE(jsonb_object_agg(x.k, x.n) FILTER (WHERE x.k IS NOT NULL), '{}'::jsonb))
      FROM (SELECT r.review_key AS k, count(*) AS n FROM resolved r WHERE r.store_id IS NULL GROUP BY 1) x)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.inventory_scope_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_scope_report(uuid) TO authenticated;
