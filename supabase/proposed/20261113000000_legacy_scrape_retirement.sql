-- PROPOSED, NOT APPLIED. Needs Ken's approval before it runs anywhere.
--
-- Legacy scraped-listing retirement and null-owner rooftop guard (Nov 7 2026).
--
-- 1. legacy_listing_retirements: one audit row per retired listing, with the
--    full prior row, the SFTP match evidence, the factory-sticker and
--    description-case states the archive triggers change, the approval text
--    and the restore stamp. Append-only except for the restore stamp.
-- 2. legacy_listing_retire(...): archives an exact, named batch of published
--    MarketCheck-scraped listings (status archived, archive_reason
--    legacy_scrape_retired). Fails closed: every id must pass every check and
--    the VIN list must match exactly, or nothing changes. Dry run returns the
--    same report without writing. Not callable by anon or authenticated.
-- 3. legacy_listing_restore(batch): the rollback. Restores status, archive
--    fields, sticker generation states and description cases from the audit.
-- 4. vehicle_listings_legacy_retired_guard: a retired listing cannot be
--    republished, repriced, re-owned or hard-deleted by anything except
--    legacy_listing_restore or legacy_listing_rehome. The dealer feed apply
--    does not need a bypass: it already routes an archived listing for a feed
--    VIN to an 'archived_listing' conflict for a person, and the conflict
--    resolver can only dismiss that kind. marketcheck_revive_listing only
--    revives archive_reason = 'left_feed', so it never touches these.
-- 4b. legacy_listing_rehome(listing, store, approval): the reviewed path for a
--    retired row whose car is in a store's own SFTP feed (batch B). Links it to
--    that store's inventory record as a DRAFT, takes the price from the
--    store's current feed (or none), drops the scraped price fields, and never
--    publishes. The tenant+VIN unique index means this is the only way that
--    store can ever get a listing for the VIN.
-- 4c. legacy_retirement_batches: the exact batch, its approved VIN list and
--    the pre-run baseline (store_inventory hash and count, tenant status
--    counts, each feed's latest applied snapshot), written in the same
--    transaction as the retirement.
-- 5. vehicle_listings_owner_assignment_guard: owning_store_id and
--    inventory_record_id can only be set from NULL (insert or update) by the
--    dealer feed apply or the reviewed reconcile. Closes the gap where the
--    0014 store-feed guard returns early for null-owner rows.
--
-- Leaves alone: store_inventory, inventory snapshots, vehicle_files (VIN
-- history and service linkage), every child table, MarketCheck enrichment,
-- auto-publish, feed price updates, legacy adoption, retirement automation.
-- Rollback: 20261113000000_legacy_scrape_retirement.rollback.sql (drops the
-- guards and functions; run legacy_listing_restore first to un-retire).

CREATE TABLE IF NOT EXISTS public.legacy_listing_retirements (
  id bigserial PRIMARY KEY,
  batch_id uuid NOT NULL,
  listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  vin text NOT NULL,
  prior_row jsonb NOT NULL,
  sftp_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  prior_sticker_states jsonb NOT NULL DEFAULT '[]'::jsonb,
  prior_description_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  approval text NOT NULL CHECK (length(trim(approval)) >= 10),
  retired_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restore_approval text,
  rehomed_at timestamptz,
  rehome_store_id uuid,
  rehome_inventory_id uuid,
  rehome_approval text,
  UNIQUE (batch_id, listing_id)
);
ALTER TABLE public.legacy_listing_retirements ADD COLUMN IF NOT EXISTS rehomed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rehome_store_id uuid, ADD COLUMN IF NOT EXISTS rehome_inventory_id uuid, ADD COLUMN IF NOT EXISTS rehome_approval text;

CREATE TABLE IF NOT EXISTS public.legacy_retirement_batches (
  batch_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  listing_ids uuid[] NOT NULL,
  expected_vins text[] NOT NULL,
  allow_sftp_vins text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  approval text NOT NULL,
  baseline jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.legacy_retirement_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant members read legacy retirement batches" ON public.legacy_retirement_batches;
CREATE POLICY "Tenant members read legacy retirement batches" ON public.legacy_retirement_batches
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.legacy_retirement_batches FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.legacy_retirement_batches_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'legacy_retirement_batches_immutable'; END $$;
DROP TRIGGER IF EXISTS legacy_retirement_batches_immutable ON public.legacy_retirement_batches;
CREATE TRIGGER legacy_retirement_batches_immutable BEFORE UPDATE OR DELETE ON public.legacy_retirement_batches
  FOR EACH ROW EXECUTE FUNCTION public.legacy_retirement_batches_immutable();
CREATE INDEX IF NOT EXISTS legacy_listing_retirements_listing ON public.legacy_listing_retirements (listing_id);
ALTER TABLE public.legacy_listing_retirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant members read legacy retirements" ON public.legacy_listing_retirements;
CREATE POLICY "Tenant members read legacy retirements" ON public.legacy_listing_retirements
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.legacy_listing_retirements FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.legacy_listing_retirements_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'legacy_listing_retirements_append_only'; END IF;
  -- One closing stamp per row: restored or rehomed, once.
  IF OLD.restored_at IS NOT NULL OR OLD.rehomed_at IS NOT NULL THEN RAISE EXCEPTION 'legacy_listing_retirements_append_only'; END IF;
  IF current_setting('app.inventory_writer', true) = 'legacy_restore'
     AND (to_jsonb(NEW) - 'restored_at' - 'restore_approval') = (to_jsonb(OLD) - 'restored_at' - 'restore_approval') THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.inventory_writer', true) = 'legacy_rehome'
     AND (to_jsonb(NEW) - 'rehomed_at' - 'rehome_store_id' - 'rehome_inventory_id' - 'rehome_approval')
       = (to_jsonb(OLD) - 'rehomed_at' - 'rehome_store_id' - 'rehome_inventory_id' - 'rehome_approval') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'legacy_listing_retirements_append_only';
END $$;
DROP TRIGGER IF EXISTS legacy_listing_retirements_append_only ON public.legacy_listing_retirements;
CREATE TRIGGER legacy_listing_retirements_append_only BEFORE UPDATE OR DELETE ON public.legacy_listing_retirements
  FOR EACH ROW EXECUTE FUNCTION public.legacy_listing_retirements_append_only();

-- Per-listing eligibility. Returns the blocking reasons (empty = eligible) and
-- the evidence the report shows.
CREATE OR REPLACE FUNCTION public.legacy_listing_check(p_listing_id uuid, p_tenant_id uuid, p_source_domains text[], p_allow_sftp_vins text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.vehicle_listings%ROWTYPE;
  v_blocks text[] := '{}';
  v_sftp jsonb;
  v_host text;
BEGIN
  SELECT * INTO l FROM public.vehicle_listings WHERE id = p_listing_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('listing_id', p_listing_id, 'blocks', jsonb_build_array('not_found')); END IF;
  IF l.tenant_id IS DISTINCT FROM p_tenant_id THEN v_blocks := array_append(v_blocks, 'other_tenant'); END IF;
  IF l.status IS DISTINCT FROM 'published' THEN v_blocks := array_append(v_blocks, 'not_published'); END IF;
  IF l.owning_store_id IS NOT NULL OR l.inventory_record_id IS NOT NULL THEN v_blocks := array_append(v_blocks, 'has_store_owner'); END IF;
  IF l.feed_source IS DISTINCT FROM 'marketcheck' THEN v_blocks := array_append(v_blocks, 'not_marketcheck_scrape'); END IF;
  IF l.created_by IS NOT NULL THEN v_blocks := array_append(v_blocks, 'created_by_user'); END IF;
  v_host := lower(substring(coalesce(l.source_url, '') FROM '^https?://(?:www\.)?([^/:?#]+)'));
  IF v_host IS NULL OR NOT (v_host = ANY (p_source_domains)) THEN v_blocks := array_append(v_blocks, 'source_not_scraped_site'); END IF;
  IF EXISTS (SELECT 1 FROM public.store_inventory si WHERE si.listing_id = l.id) THEN v_blocks := array_append(v_blocks, 'linked_from_feed'); END IF;
  IF EXISTS (SELECT 1 FROM public.addendum_signings s WHERE s.vehicle_listing_id = l.id OR (s.tenant_id = l.tenant_id AND upper(s.vin) = upper(l.vin))) THEN
    v_blocks := array_append(v_blocks, 'customer_signing'); END IF;
  IF EXISTS (SELECT 1 FROM public.leads x WHERE x.tenant_id = l.tenant_id AND upper(x.vehicle_vin) = upper(l.vin) AND coalesce(x.status, 'new') IN ('new', 'contacted')) THEN
    v_blocks := array_append(v_blocks, 'open_lead'); END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_files f WHERE f.tenant_id = l.tenant_id AND upper(f.vin) = upper(l.vin)
             AND (f.sold_at IS NOT NULL OR nullif(trim(coalesce(f.customer_name, '')), '') IS NOT NULL
                  OR coalesce(f.deal_status, 'stickered') NOT IN ('stickered', ''))) THEN
    v_blocks := array_append(v_blocks, 'active_deal'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('store_id', si.store_id, 'presence', si.presence, 'stock_number', si.stock_number, 'feed_price', si.feed_price) ORDER BY si.store_id), '[]'::jsonb)
    INTO v_sftp FROM public.store_inventory si WHERE upper(si.vin) = upper(l.vin);
  IF jsonb_array_length(v_sftp) > 0 AND NOT (upper(l.vin) = ANY (SELECT upper(x) FROM unnest(coalesce(p_allow_sftp_vins, '{}')) x)) THEN
    v_blocks := array_append(v_blocks, 'in_current_sftp_feed'); END IF;
  RETURN jsonb_build_object('listing_id', l.id, 'vin', upper(l.vin), 'ymm', l.ymm, 'price', l.price, 'slug', l.slug,
    'source_host', v_host, 'sftp_matches', v_sftp, 'blocks', to_jsonb(v_blocks));
END $$;

-- Everything the retirement promises not to change, in one value, so the
-- execution script can compare before and after inside the transaction.
CREATE OR REPLACE FUNCTION public.legacy_retirement_baseline(p_tenant_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'taken_at', now(),
    'store_inventory_rows', (SELECT count(*) FROM public.store_inventory),
    'store_inventory_hash', (SELECT md5(coalesce(string_agg(to_jsonb(si)::text, ',' ORDER BY si.id), '')) FROM public.store_inventory si),
    'listing_status', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) n FROM public.vehicle_listings WHERE tenant_id = p_tenant_id GROUP BY status) x),
    'null_owner_published', (SELECT count(*) FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND status = 'published' AND owning_store_id IS NULL),
    'store_snapshots', (SELECT coalesce(jsonb_object_agg(st.store_id, jsonb_build_object('snapshot_id', st.last_applied_snapshot_id, 'source_mtime', st.last_applied_source_mtime, 'applied_at', st.last_applied_at)), '{}'::jsonb)
                          FROM public.inventory_store_state st JOIN public.dealer_stores ds ON ds.id = st.store_id WHERE ds.tenant_id = p_tenant_id));
$$;

CREATE OR REPLACE FUNCTION public.legacy_listing_retire(
  p_tenant_id uuid, p_listing_ids uuid[], p_expected_vins text[], p_source_domains text[],
  p_allow_sftp_vins text[], p_reason text, p_approval text, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_rows jsonb := '[]'::jsonb;
  v_check jsonb;
  v_id uuid;
  v_vins text[];
  v_blocked integer := 0;
BEGIN
  IF p_listing_ids IS NULL OR cardinality(p_listing_ids) = 0 THEN RAISE EXCEPTION 'legacy_retire_empty_batch'; END IF;
  IF cardinality(p_listing_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_listing_ids) x) THEN RAISE EXCEPTION 'legacy_retire_duplicate_ids'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'legacy_retire_reason_required'; END IF;
  IF NOT p_dry_run AND length(trim(coalesce(p_approval, ''))) < 10 THEN RAISE EXCEPTION 'legacy_retire_approval_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('legacy_listing_retire:' || p_tenant_id::text));

  SELECT array_agg(upper(vin) ORDER BY upper(vin)) INTO v_vins FROM public.vehicle_listings WHERE id = ANY (p_listing_ids);
  IF v_vins IS DISTINCT FROM (SELECT array_agg(upper(x) ORDER BY upper(x)) FROM unnest(p_expected_vins) x) THEN
    RAISE EXCEPTION 'legacy_retire_vin_list_mismatch' USING DETAIL = 'The listing ids do not resolve to exactly the approved VIN list.';
  END IF;

  FOREACH v_id IN ARRAY p_listing_ids LOOP
    PERFORM 1 FROM public.vehicle_listings WHERE id = v_id FOR UPDATE;
    v_check := legacy_listing_check(v_id, p_tenant_id, p_source_domains, p_allow_sftp_vins);
    IF jsonb_array_length(v_check->'blocks') > 0 THEN v_blocked := v_blocked + 1; END IF;
    v_rows := v_rows || v_check;
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'eligible', cardinality(p_listing_ids) - v_blocked, 'blocked', v_blocked, 'rows', v_rows);
  END IF;
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'legacy_retire_blocked: % of % listings failed a check; nothing was changed', v_blocked, cardinality(p_listing_ids)
      USING DETAIL = v_rows::text;
  END IF;

  INSERT INTO public.legacy_listing_retirements (batch_id, listing_id, tenant_id, vin, prior_row, sftp_matches, prior_sticker_states, prior_description_cases, reason, approval)
  SELECT v_batch, l.id, l.tenant_id, upper(l.vin), to_jsonb(l),
         coalesce((SELECT r->'sftp_matches' FROM jsonb_array_elements(v_rows) r WHERE (r->>'listing_id')::uuid = l.id), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'generation_status', f.generation_status)) FROM public.factory_sticker_records f WHERE f.vehicle_id = l.id), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'archived_at', d.archived_at)) FROM public.description_cases d WHERE d.vehicle_id = l.id), '[]'::jsonb),
         p_reason, p_approval
    FROM public.vehicle_listings l WHERE l.id = ANY (p_listing_ids);

  INSERT INTO public.legacy_retirement_batches (batch_id, tenant_id, listing_ids, expected_vins, allow_sftp_vins, reason, approval, baseline)
  VALUES (v_batch, p_tenant_id, p_listing_ids, p_expected_vins, coalesce(p_allow_sftp_vins, '{}'), p_reason, p_approval,
          legacy_retirement_baseline(p_tenant_id));

  PERFORM set_config('app.inventory_writer', 'legacy_retire', true);
  UPDATE public.vehicle_listings
     SET status = 'archived', archived_at = now(), archive_reason = 'legacy_scrape_retired'
   WHERE id = ANY (p_listing_ids);
  PERFORM set_config('app.inventory_writer', '', true);

  RETURN jsonb_build_object('dry_run', false, 'batch_id', v_batch, 'retired', cardinality(p_listing_ids), 'rows', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.legacy_listing_restore(p_batch_id uuid, p_approval text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.legacy_listing_retirements%ROWTYPE; v_restored integer := 0; v_skipped jsonb := '[]'::jsonb; s jsonb;
BEGIN
  IF length(trim(coalesce(p_approval, ''))) < 10 THEN RAISE EXCEPTION 'legacy_restore_approval_required'; END IF;
  PERFORM set_config('app.inventory_writer', 'legacy_restore', true);
  FOR r IN SELECT * FROM public.legacy_listing_retirements WHERE batch_id = p_batch_id AND restored_at IS NULL FOR UPDATE LOOP
    UPDATE public.vehicle_listings
       SET status = r.prior_row->>'status',
           archived_at = (r.prior_row->>'archived_at')::timestamptz,
           archive_reason = r.prior_row->>'archive_reason'
     WHERE id = r.listing_id AND archive_reason = 'legacy_scrape_retired';
    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('listing_id', r.listing_id, 'reason', 'no_longer_legacy_retired');
      CONTINUE;
    END IF;
    FOR s IN SELECT * FROM jsonb_array_elements(r.prior_sticker_states) LOOP
      UPDATE public.factory_sticker_records SET generation_status = s->>'generation_status' WHERE id = (s->>'id')::uuid;
    END LOOP;
    FOR s IN SELECT * FROM jsonb_array_elements(r.prior_description_cases) LOOP
      UPDATE public.description_cases SET archived_at = (s->>'archived_at')::timestamptz WHERE id = (s->>'id')::uuid;
    END LOOP;
    UPDATE public.legacy_listing_retirements SET restored_at = now(), restore_approval = p_approval WHERE id = r.id;
    v_restored := v_restored + 1;
  END LOOP;
  PERFORM set_config('app.inventory_writer', '', true);
  RETURN jsonb_build_object('batch_id', p_batch_id, 'restored', v_restored, 'skipped', v_skipped);
END $$;

-- Reviewed hand-over of one retired listing to the store whose SFTP feed has
-- the car. Draft only; price from that store's current feed or none.
CREATE OR REPLACE FUNCTION public.legacy_listing_rehome(p_listing_id uuid, p_store_id uuid, p_approval text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.legacy_listing_retirements%ROWTYPE;
  l public.vehicle_listings%ROWTYPE;
  st public.dealer_stores%ROWTYPE;
  si public.store_inventory%ROWTYPE;
  v_price numeric;
BEGIN
  IF length(trim(coalesce(p_approval, ''))) < 10 THEN RAISE EXCEPTION 'legacy_rehome_approval_required'; END IF;
  SELECT * INTO l FROM public.vehicle_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND OR l.archive_reason IS DISTINCT FROM 'legacy_scrape_retired' THEN RAISE EXCEPTION 'legacy_rehome_not_retired'; END IF;
  SELECT * INTO r FROM public.legacy_listing_retirements WHERE listing_id = p_listing_id AND restored_at IS NULL AND rehomed_at IS NULL
   ORDER BY retired_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy_rehome_no_open_retirement'; END IF;
  SELECT * INTO st FROM public.dealer_stores WHERE id = p_store_id;
  IF NOT FOUND OR st.tenant_id IS DISTINCT FROM l.tenant_id THEN RAISE EXCEPTION 'legacy_rehome_store_not_in_tenant'; END IF;
  SELECT * INTO si FROM public.store_inventory WHERE store_id = p_store_id AND upper(vin) = upper(l.vin) AND presence = 'present' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'legacy_rehome_not_in_store_feed' USING DETAIL = 'The store''s current SFTP inventory must have this VIN present.'; END IF;
  v_price := CASE WHEN si.feed_price_status = 'known' THEN si.feed_price ELSE NULL END;

  PERFORM set_config('app.inventory_writer', 'legacy_rehome', true);
  UPDATE public.vehicle_listings
     SET status = 'draft', archived_at = NULL, archive_reason = NULL, published_at = NULL,
         owning_store_id = p_store_id, inventory_record_id = si.id, feed_source = 'filescom',
         price = v_price, advertised_price_before_doc = NULL, website_sale_price = NULL,
         mileage = COALESCE(si.mileage, mileage), condition = COALESCE(si.condition, condition)
   WHERE id = l.id;
  UPDATE public.legacy_listing_retirements SET rehomed_at = now(), rehome_store_id = p_store_id, rehome_inventory_id = si.id, rehome_approval = p_approval
   WHERE id = r.id;
  UPDATE public.inventory_vin_conflicts SET status = 'dismissed', resolved_at = now(), note = left('Rehomed retired legacy listing as draft: ' || p_approval, 300)
   WHERE existing_listing_id = l.id AND claiming_store_id = p_store_id AND kind = 'archived_listing' AND status = 'open';
  PERFORM set_config('app.inventory_writer', '', true);
  RETURN jsonb_build_object('listing_id', l.id, 'vin', upper(l.vin), 'store_id', p_store_id, 'inventory_id', si.id, 'status', 'draft',
                            'price', v_price, 'prior_price', l.price, 'batch_id', r.batch_id);
END $$;

-- A retired legacy listing stays retired. Only the restore and rehome
-- functions may change its status, price, owner or publish fields.
CREATE OR REPLACE FUNCTION public.vehicle_listings_legacy_retired_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_writer text := coalesce(current_setting('app.inventory_writer', true), '');
BEGIN
  IF OLD.archive_reason IS DISTINCT FROM 'legacy_scrape_retired' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legacy_listing_retired' USING ERRCODE = '42501',
      DETAIL = 'Retired legacy listings keep their history and cannot be deleted.';
  END IF;
  IF v_writer IN ('legacy_restore', 'legacy_rehome') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.archive_reason IS DISTINCT FROM OLD.archive_reason OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.price IS DISTINCT FROM OLD.price OR NEW.advertised_price_before_doc IS DISTINCT FROM OLD.advertised_price_before_doc
     OR NEW.website_sale_price IS DISTINCT FROM OLD.website_sale_price OR NEW.doc_fee IS DISTINCT FROM OLD.doc_fee
     OR NEW.owning_store_id IS DISTINCT FROM OLD.owning_store_id OR NEW.inventory_record_id IS DISTINCT FROM OLD.inventory_record_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.vin IS DISTINCT FROM OLD.vin THEN
    RAISE EXCEPTION 'legacy_listing_retired' USING ERRCODE = '42501',
      DETAIL = 'This listing came from the retired website scrape. Restore it through legacy_listing_restore.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vehicle_listings_legacy_retired_guard ON public.vehicle_listings;
CREATE TRIGGER vehicle_listings_legacy_retired_guard BEFORE UPDATE OR DELETE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_listings_legacy_retired_guard();

-- Rooftop ownership is assigned only by the dealer feed or the reviewed
-- reconcile, never by a client write. Runs on insert and on every update, so
-- a null-owner row is protected the same as an owned one.
CREATE OR REPLACE FUNCTION public.vehicle_listings_owner_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_writer text := coalesce(current_setting('app.inventory_writer', true), '');
BEGIN
  IF v_writer IN ('filescom_apply', 'inventory_reconcile', 'legacy_rehome') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.owning_store_id IS NOT NULL OR NEW.inventory_record_id IS NOT NULL THEN
      RAISE EXCEPTION 'owning_store_assignment_requires_feed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.owning_store_id IS NULL AND NEW.owning_store_id IS NOT NULL
     OR OLD.inventory_record_id IS NULL AND NEW.inventory_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'owning_store_assignment_requires_feed' USING ERRCODE = '42501',
      DETAIL = 'Rooftop ownership is set only by the dealer feed or a reviewed reconcile.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vehicle_listings_owner_assignment_guard ON public.vehicle_listings;
CREATE TRIGGER vehicle_listings_owner_assignment_guard BEFORE INSERT OR UPDATE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_listings_owner_assignment_guard();

REVOKE ALL ON FUNCTION public.legacy_listing_check(uuid, uuid, text[], text[]),
  public.legacy_listing_retire(uuid, uuid[], text[], text[], text[], text, text, boolean),
  public.legacy_listing_restore(uuid, text), public.legacy_listing_rehome(uuid, uuid, text),
  public.legacy_retirement_baseline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_listing_check(uuid, uuid, text[], text[]),
  public.legacy_listing_retire(uuid, uuid[], text[], text[], text[], text, text, boolean),
  public.legacy_listing_restore(uuid, text), public.legacy_listing_rehome(uuid, uuid, text),
  public.legacy_retirement_baseline(uuid) TO service_role;
