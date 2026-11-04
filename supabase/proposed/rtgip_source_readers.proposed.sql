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
--   rooftop_id  = rtgip_src.rooftop_stores maps the RooftopOS rooftop id to exactly one
--                 dealer_stores row of the tenant. Every reader takes (tenant, rooftop,
--                 episode) and re-derives the binding tenant -> rooftop -> store ->
--                 episode -> listing -> VIN from rows; a missing, mismatched or ambiguous
--                 link returns {"refused": "<code>"} and nothing else.
--
-- Concurrency: each reader takes the shared episode advisory lock that
-- vehicle_history_record_milestone takes exclusively, so a fact read for publication and
-- the outbox row enqueued in the same READ COMMITTED transaction cannot interleave with a
-- custody change. Revisions and occurrence times come from the rows, never the caller.
--
-- Hosted dependencies: public.dealer_stores and vehicle_listings.owning_store_id come from
-- drizzle 0006 (multistore inventory network), not supabase/migrations; dealer_profiles
-- settings supply the tenant's price display mode exactly as public-listing-view does.

CREATE SCHEMA IF NOT EXISTS rtgip_src;
REVOKE ALL ON SCHEMA rtgip_src FROM PUBLIC;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_source_reader') THEN
    CREATE ROLE rtgip_source_reader NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA rtgip_src TO rtgip_source_reader;

-- RooftopOS rooftop id -> AutoLabels store. One active mapping per rooftop and per store.
CREATE TABLE IF NOT EXISTS rtgip_src.rooftop_stores (
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  rooftop_id  text NOT NULL CHECK (rooftop_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  store_id    uuid NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  mapped_by   uuid NOT NULL,
  reason      text NOT NULL CHECK (length(trim(reason)) >= 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS rooftop_stores_one_active_rooftop ON rtgip_src.rooftop_stores (tenant_id, rooftop_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS rooftop_stores_one_active_store ON rtgip_src.rooftop_stores (store_id) WHERE status = 'active';
REVOKE ALL ON rtgip_src.rooftop_stores FROM PUBLIC;

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
      -- A chain that ends on a link outside this tenant and VIN (or deeper than 64) has no root:
      -- NULL, which the server reader refuses, instead of silently re-rooting the vehicle here.
      SELECT CASE WHEN prev IS NULL THEN id::text END FROM chain ORDER BY depth DESC LIMIT 1),
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
    'source', m.source, 'confirmed_by', m.confirmed_by::text, 'corrects_id', m.corrects_id::text,
    'seq', m.seq)
$$;

-- tenant -> rooftop -> store -> episode -> listing -> VIN, from rows only. NULL when the
-- episode is not this tenant's; {"refused": code} when any link is missing or disagrees.
CREATE OR REPLACE FUNCTION rtgip_src.labels_authority(p_tenant uuid, p_rooftop text, p_episode uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.vehicle_instances%ROWTYPE; l jsonb; v_store uuid; n int;
BEGIN
  IF p_tenant IS NULL OR p_rooftop IS NULL OR p_episode IS NULL THEN RETURN jsonb_build_object('refused', 'bad_reference'); END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('vehicle_history.episode:' || p_episode::text, 0));
  SELECT * INTO v FROM public.vehicle_instances vi WHERE vi.id = p_episode AND vi.tenant_id = p_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v.store_id IS NULL THEN RETURN jsonb_build_object('refused', 'episode_rooftop_unbound'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dealer_stores ds WHERE ds.id = v.store_id AND ds.tenant_id = p_tenant
                 AND COALESCE(to_jsonb(ds)->>'status', 'active') = 'active') THEN
    RETURN jsonb_build_object('refused', 'episode_store_not_active_in_tenant');
  END IF;
  SELECT count(*), min(m.store_id::text)::uuid INTO n, v_store FROM rtgip_src.rooftop_stores m
   WHERE m.tenant_id = p_tenant AND m.rooftop_id = p_rooftop AND m.status = 'active';
  IF n = 0 THEN RETURN jsonb_build_object('refused', 'rooftop_unmapped'); END IF;
  IF n > 1 THEN RETURN jsonb_build_object('refused', 'rooftop_mapping_ambiguous'); END IF;
  IF v_store <> v.store_id THEN RETURN jsonb_build_object('refused', 'episode_rooftop_mismatch'); END IF;
  IF v.listing_id IS NOT NULL THEN
    SELECT to_jsonb(x) INTO l FROM public.vehicle_listings x WHERE x.id = v.listing_id;
    IF l IS NULL OR (l->>'tenant_id') IS DISTINCT FROM p_tenant::text THEN RETURN jsonb_build_object('refused', 'listing_outside_tenant'); END IF;
    IF upper(trim(l->>'vin')) IS DISTINCT FROM v.vin THEN RETURN jsonb_build_object('refused', 'listing_vin_mismatch'); END IF;
    IF (l->>'owning_store_id') IS NULL THEN RETURN jsonb_build_object('refused', 'listing_store_ambiguous'); END IF;
    IF (l->>'owning_store_id') <> v.store_id::text THEN RETURN jsonb_build_object('refused', 'listing_store_mismatch'); END IF;
    IF EXISTS (SELECT 1 FROM public.vehicle_instances o WHERE o.listing_id = v.listing_id AND o.id <> v.id AND o.status = 'active') THEN
      RETURN jsonb_build_object('refused', 'listing_claimed_by_other_episode');
    END IF;
  END IF;
  RETURN jsonb_build_object('tenant_id', p_tenant::text, 'rooftop_id', p_rooftop, 'store_id', v.store_id::text,
    'episode_id', v.id::text, 'vin', v.vin, 'listing_id', v.listing_id::text,
    'custody_revision', (SELECT COALESCE(max(m.seq), 0) FROM public.vehicle_custody_milestones m WHERE m.instance_id = v.id));
END $$;

-- Everything episodeOpened() needs, for one episode of one tenant and rooftop.
DROP FUNCTION IF EXISTS rtgip_src.labels_episode_history(uuid, uuid);
CREATE OR REPLACE FUNCTION rtgip_src.labels_episode_history(p_tenant uuid, p_rooftop text, p_episode uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.vehicle_instances%ROWTYPE; stock text; ep jsonb; a jsonb;
BEGIN
  a := rtgip_src.labels_authority(p_tenant, p_rooftop, p_episode);
  IF a IS NULL OR a ? 'refused' THEN RETURN a; END IF;
  SELECT * INTO v FROM public.vehicle_instances vi WHERE vi.id = p_episode AND vi.tenant_id = p_tenant;
  SELECT f.stock_number INTO stock FROM public.vehicle_listings l
    JOIN public.vehicle_files f ON f.id = l.vehicle_file_id AND f.tenant_id = l.tenant_id
    WHERE l.id = v.listing_id AND l.tenant_id = p_tenant;
  ep := rtgip_src.labels_episode_json(v);
  RETURN jsonb_build_object(
    'authority', a,
    'instance', jsonb_build_object('vin', v.vin, 'instance_id', ep->>'instance_id', 'episode_id', v.id::text,
      'episode_state', CASE WHEN v.status = 'active' AND v.custody_state IN ('in_stock','sold','awaiting_delivery') THEN 'open' ELSE 'closed' END,
      'stock_number', NULLIF(stock, '')),
    'episode', ep,
    'opened_at', to_char(COALESCE(v.acquired_at, v.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'vin_episodes', coalesce((SELECT jsonb_agg(rtgip_src.labels_episode_json(o) ORDER BY o.created_at, o.id)
      FROM public.vehicle_instances o WHERE o.tenant_id = p_tenant AND o.vin = v.vin AND o.id <> v.id), '[]'::jsonb),
    'predecessor_milestones', coalesce((SELECT jsonb_agg(rtgip_src.labels_milestone_json(m) ORDER BY m.seq)
      FROM public.vehicle_custody_milestones m
      WHERE m.tenant_id = p_tenant AND m.vin = v.vin AND m.instance_id = v.previous_instance_id), '[]'::jsonb),
    'review', (SELECT jsonb_build_object('id', r.id::text, 'tenant_id', r.tenant_id::text, 'vin', r.vin,
        'prior_episode_id', r.prior_instance_id::text, 'status', r.status, 'decision', r.decision,
        'decided_by', r.decided_by::text, 'resulting_episode_id', r.resulting_instance_id::text)
      FROM public.vehicle_reappearance_reviews r
      WHERE r.tenant_id = p_tenant AND r.vin = v.vin AND r.resulting_instance_id = v.id
      ORDER BY r.decided_at DESC NULLS LAST, r.id LIMIT 1));
END $$;

-- Every milestone of one episode (sale/delivery facts and episode closure need the row and its corrections).
DROP FUNCTION IF EXISTS rtgip_src.labels_episode_milestones(uuid, uuid);
CREATE OR REPLACE FUNCTION rtgip_src.labels_episode_milestones(p_tenant uuid, p_rooftop text, p_episode uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb;
BEGIN
  a := rtgip_src.labels_authority(p_tenant, p_rooftop, p_episode);
  IF a IS NULL OR a ? 'refused' THEN RETURN a; END IF;
  RETURN jsonb_build_object('authority', a, 'milestones', coalesce((SELECT jsonb_agg(rtgip_src.labels_milestone_json(m) ORDER BY m.seq)
    FROM public.vehicle_custody_milestones m WHERE m.tenant_id = p_tenant AND m.instance_id = p_episode), '[]'::jsonb));
END $$;

-- The episode's listing as persisted: identity decode, inventory status, availability and the
-- stored price inputs plus the tenant's display settings. No price is computed here; the
-- server applies the existing Passport resolver (resolvePassportSellingPrice +
-- buildPassportSaleCard) to exactly these values.
CREATE OR REPLACE FUNCTION rtgip_src.labels_listing_state(p_tenant uuid, p_rooftop text, p_episode uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb; l jsonb; f jsonb; s jsonb; v public.vehicle_instances%ROWTYPE;
BEGIN
  a := rtgip_src.labels_authority(p_tenant, p_rooftop, p_episode);
  IF a IS NULL OR a ? 'refused' THEN RETURN a; END IF;
  SELECT * INTO v FROM public.vehicle_instances vi WHERE vi.id = p_episode AND vi.tenant_id = p_tenant;
  IF v.listing_id IS NULL THEN RETURN jsonb_build_object('refused', 'episode_has_no_listing'); END IF;
  SELECT to_jsonb(x) INTO l FROM public.vehicle_listings x WHERE x.id = v.listing_id AND x.tenant_id = p_tenant;
  SELECT to_jsonb(x) INTO f FROM public.vehicle_files x WHERE x.id = (l->>'vehicle_file_id')::uuid AND x.tenant_id = p_tenant;
  SELECT dp.settings INTO s FROM public.dealer_profiles dp WHERE dp.tenant_id = p_tenant;
  RETURN jsonb_build_object(
    'authority', a,
    'listing', jsonb_build_object(
      'listing_id', l->>'id', 'status', l->>'status', 'slug', l->>'slug', 'condition', l->>'condition',
      'published_at', l->>'published_at', 'updated_at', l->>'updated_at',
      'revision', floor(extract(epoch FROM (l->>'updated_at')::timestamptz) * 1000)::bigint,
      'price', l->'price', 'advertised_price_before_doc', l->'advertised_price_before_doc',
      'doc_fee', l->'doc_fee', 'website_sale_price', l->'website_sale_price'),
    'identity', CASE WHEN f IS NULL THEN NULL ELSE jsonb_build_object(
      'year', NULLIF(f->>'year', ''), 'make', NULLIF(f->>'make', ''), 'model', NULLIF(f->>'model', ''),
      'trim', NULLIF(f->>'trim', ''), 'vin', upper(trim(f->>'vin')),
      'registered_at', to_char(COALESCE((f->>'created_at')::timestamptz, v.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) END,
    'price_settings', jsonb_build_object('price_display_mode', s->'price_display_mode',
      'advertised_includes_doc_fee', s->'advertised_includes_doc_fee'));
END $$;

DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip_src FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rtgip_src FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA rtgip_src FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA rtgip_src FROM %I', r);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION rtgip_src.labels_episode_history(uuid, text, uuid) TO rtgip_source_reader;
GRANT EXECUTE ON FUNCTION rtgip_src.labels_episode_milestones(uuid, text, uuid) TO rtgip_source_reader;
GRANT EXECUTE ON FUNCTION rtgip_src.labels_listing_state(uuid, text, uuid) TO rtgip_source_reader;

NOTIFY pgrst, 'reload schema';
