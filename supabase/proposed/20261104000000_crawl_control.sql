-- PROPOSED, NOT APPLIED. Server-side controls for the advertised-price crawl.
--
-- crawl_control (one row) holds two switches, both OFF by default:
--   execution_enabled  the crawler answers every request with "Temporarily
--                      paused for pricing verification" unless this is on
--   promotion_enabled  observation-only mode unless this is on: observations
--                      and evidence are stored, listing prices are never
--                      changed
-- The crawler treats a missing row, a missing table or any read error as both
-- switches OFF.
--
-- Listing prices change only through crawl_promote_listing(), which reads
-- promotion_enabled under a row lock in the same transaction as the guarded
-- listing update. platform_set_crawl_control() takes the conflicting lock, so
-- once a hold is committed no promotion that starts afterwards can write, and
-- a run already in flight is held at its next vehicle.
--
-- Only a platform admin can change the switches, through
-- platform_set_crawl_control(), which records who, when, why and the before
-- and after state in the row and in audit_log. Nobody else writes the table,
-- the service role included.

CREATE TABLE IF NOT EXISTS public.crawl_control (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  execution_enabled boolean NOT NULL DEFAULT false,
  promotion_enabled boolean NOT NULL DEFAULT false,
  version           bigint  NOT NULL DEFAULT 1,
  reason            text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);
INSERT INTO public.crawl_control (id, reason) VALUES (true, 'created paused: pricing verification')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.crawl_control ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crawl_control platform admin read" ON public.crawl_control;
CREATE POLICY "crawl_control platform admin read"
  ON public.crawl_control FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));
REVOKE ALL ON public.crawl_control FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.crawl_control TO authenticated, service_role;

-- The new observation outcome: stored, promotion held by the control. Only
-- where 20261102000000 added listing_promotion; without it the crawler stores
-- observations the old way and never promotes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'advertised_prices' AND column_name = 'listing_promotion') THEN
    ALTER TABLE public.advertised_prices DROP CONSTRAINT IF EXISTS advertised_prices_listing_promotion_check;
    ALTER TABLE public.advertised_prices ADD CONSTRAINT advertised_prices_listing_promotion_check
      CHECK (listing_promotion IS NULL OR listing_promotion IN (
        'pending', 'promoted', 'not_required', 'promotion_failed', 'promotion_conflict',
        'held_fee_basis', 'held_evidence', 'held_promotion_off'));
  END IF;
END $$;

-- What the crawler reads at the start of a request and before each vehicle.
CREATE OR REPLACE FUNCTION public.crawl_control_state()
RETURNS TABLE (execution_enabled boolean, promotion_enabled boolean, version bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT coalesce(bool_or(c.execution_enabled), false), coalesce(bool_or(c.promotion_enabled), false), coalesce(max(c.version), 0)
  FROM public.crawl_control c WHERE c.id;
$$;
REVOKE ALL ON FUNCTION public.crawl_control_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crawl_control_state() TO service_role;

-- The only way a crawl observation changes a listing's price.
CREATE OR REPLACE FUNCTION public.crawl_promote_listing(p_listing_id uuid, p_expected jsonb, p_patch jsonb, p_observation_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_on boolean;
  v_new public.vehicle_listings;
  v_n integer;
BEGIN
  SELECT c.promotion_enabled INTO v_on FROM public.crawl_control c WHERE c.id FOR SHARE;
  IF v_on IS NOT TRUE THEN
    RETURN 'held_promotion_off';
  END IF;
  IF p_patch - ARRAY['advertised_price_before_doc', 'doc_fee', 'website_sale_price', 'retail_cash', 'dealer_discount',
      'price_source_url', 'price_parse_status', 'price_parse_notes', 'price_last_verified_at', 'website_price_term'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'crawl_promote_listing: unexpected field in patch' USING ERRCODE = '22023';
  END IF;
  v_new := jsonb_populate_record(NULL::public.vehicle_listings, p_patch);
  UPDATE public.vehicle_listings v SET
    advertised_price_before_doc = CASE WHEN p_patch ? 'advertised_price_before_doc' THEN v_new.advertised_price_before_doc ELSE v.advertised_price_before_doc END,
    doc_fee                     = CASE WHEN p_patch ? 'doc_fee' THEN v_new.doc_fee ELSE v.doc_fee END,
    website_sale_price          = CASE WHEN p_patch ? 'website_sale_price' THEN v_new.website_sale_price ELSE v.website_sale_price END,
    retail_cash                 = CASE WHEN p_patch ? 'retail_cash' THEN v_new.retail_cash ELSE v.retail_cash END,
    dealer_discount             = CASE WHEN p_patch ? 'dealer_discount' THEN v_new.dealer_discount ELSE v.dealer_discount END,
    price_source_url            = CASE WHEN p_patch ? 'price_source_url' THEN v_new.price_source_url ELSE v.price_source_url END,
    price_parse_status          = CASE WHEN p_patch ? 'price_parse_status' THEN v_new.price_parse_status ELSE v.price_parse_status END,
    price_parse_notes           = CASE WHEN p_patch ? 'price_parse_notes' THEN v_new.price_parse_notes ELSE v.price_parse_notes END,
    price_last_verified_at      = CASE WHEN p_patch ? 'price_last_verified_at' THEN v_new.price_last_verified_at ELSE v.price_last_verified_at END,
    website_price_term          = CASE WHEN p_patch ? 'website_price_term' THEN v_new.website_price_term ELSE v.website_price_term END
  WHERE v.id = p_listing_id
    AND v.advertised_price_before_doc IS NOT DISTINCT FROM (p_expected->>'advertised_price_before_doc')::numeric
    AND v.doc_fee IS NOT DISTINCT FROM (p_expected->>'doc_fee')::numeric
    AND v.website_sale_price IS NOT DISTINCT FROM (p_expected->>'website_sale_price')::numeric;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n = 1 THEN 'promoted' ELSE 'conflict' END;
END $$;
REVOKE ALL ON FUNCTION public.crawl_promote_listing(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crawl_promote_listing(uuid, jsonb, jsonb, uuid) TO service_role;

-- Platform admins only; every change is recorded with who, when and why.
CREATE OR REPLACE FUNCTION public.platform_set_crawl_control(
  p_execution_enabled boolean, p_promotion_enabled boolean, p_reason text, p_expected_version bigint)
RETURNS public.crawl_control
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_before public.crawl_control;
  v_row public.crawl_control;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;
  IF p_execution_enabled IS NULL OR p_promotion_enabled IS NULL THEN
    RAISE EXCEPTION 'both switches must be stated' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.crawl_control WHERE id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crawl_control row missing' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_before.version THEN
    RAISE EXCEPTION 'crawl_control changed since it was read (version %, expected %)', v_before.version, p_expected_version
      USING ERRCODE = '40001';
  END IF;
  UPDATE public.crawl_control SET
    execution_enabled = p_execution_enabled, promotion_enabled = p_promotion_enabled,
    version = version + 1, reason = btrim(p_reason), updated_at = now(), updated_by = v_uid
  WHERE id RETURNING * INTO v_row;
  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, details)
  VALUES ('crawl_control_changed', 'crawl_control', 'advertised_price_crawl', v_uid,
          jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_row)));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.platform_set_crawl_control(boolean, boolean, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_crawl_control(boolean, boolean, text, bigint) TO authenticated;
