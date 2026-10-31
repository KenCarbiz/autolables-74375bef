-- Rollback for 0014_inventory_duplicate_reconciliation. Non-destructive.
--
-- Restores the 0012 feed apply and the 0006 feed guard and removes the
-- reconciliation entry points. It does NOT drop any table or column and does
-- NOT reopen archived duplicates: candidates, previews, operations, aliases,
-- the before/after states and the archive markers on vehicle_listings stay as
-- evidence. inv_dedupe_resolve_listing, inv_dedupe_lock, inv_dedupe_norm_vin
-- and the reconciled-listing guard stay so an archived duplicate cannot be
-- republished or recreated while the alias rows exist.
--
-- To reverse an individual reconciliation, use inv_dedupe_undo BEFORE running
-- this rollback (it is version-aware and refuses to overwrite later edits).
--
-- Because the tables stay, 0014 cannot simply be re-run after this rollback
-- (CREATE TABLE would fail on inventory_dedupe_controls). Re-enabling needs a
-- forward migration that re-creates only the functions, the feed guard and
-- the 0014 inventory_apply_store_snapshot.

BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_apply_store_snapshot(p_snapshot_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.inventory_store_snapshots%ROWTYPE;
  st public.dealer_stores%ROWTYPE;
  ss public.inventory_store_state%ROWTYPE;
  c public.inventory_feed_controls%ROWTYPE;
  m public.inventory_source_mappings%ROWTYPE;
  v record;
  cur public.store_inventory%ROWTYPE;
  other public.store_inventory%ROWTYPE;
  lst record;
  v_staged integer;
  v_added integer := 0; v_updated integer := 0; v_unchanged integer := 0; v_conflicts integer := 0;
  v_missing integer := 0; v_review integer := 0; v_retired integer := 0; v_returned integer := 0;
  v_listings_created integer := 0; v_listings_updated integer := 0;
  v_inv_id uuid;
  v_listing_id uuid;
  v_ymm text;
  v_photos jsonb;
  v_live integer := 0; v_absent integer := 0; v_allowed integer := 0; v_absence_counted boolean := false; v_shrink_held boolean := false;
BEGIN
  SELECT * INTO s FROM inventory_store_snapshots WHERE id = p_snapshot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_not_found'; END IF;
  IF s.status <> 'staged' THEN RETURN jsonb_build_object('applied', false, 'reason', 'snapshot_not_staged', 'status', s.status); END IF;

  SELECT * INTO c FROM inventory_feed_controls WHERE id = 1;
  IF NOT FOUND OR c.emergency_stop OR c.ingestion_paused THEN
    UPDATE inventory_store_snapshots SET status = 'rejected', reason = 'ingestion_paused' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'ingestion_paused');
  END IF;

  SELECT * INTO st FROM dealer_stores WHERE id = s.store_id FOR UPDATE;
  SELECT * INTO m FROM inventory_source_mappings WHERE id = s.mapping_id;
  IF st.id IS NULL OR m.id IS NULL OR m.status <> 'approved' OR m.store_id <> st.id OR m.source_dealer_id <> s.source_dealer_id THEN
    UPDATE inventory_store_snapshots SET status = 'quarantined', reason = 'mapping_not_approved' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'mapping_not_approved');
  END IF;
  IF st.status <> 'active' OR NOT st.inventory_feed_enabled OR st.feed_import_paused THEN
    UPDATE inventory_store_snapshots SET status = 'rejected', reason = 'store_feed_not_enabled' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'store_feed_not_enabled');
  END IF;

  INSERT INTO inventory_store_state (store_id) VALUES (st.id) ON CONFLICT (store_id) DO NOTHING;
  SELECT * INTO ss FROM inventory_store_state WHERE store_id = st.id FOR UPDATE;
  IF ss.last_applied_source_mtime IS NOT NULL AND s.source_mtime < ss.last_applied_source_mtime THEN
    UPDATE inventory_store_snapshots SET status = 'superseded', reason = 'older_than_applied_snapshot' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'older_than_applied_snapshot');
  END IF;
  IF ss.last_applied_sha256 = s.content_sha256 AND ss.last_applied_source_mtime = s.source_mtime THEN
    UPDATE inventory_store_snapshots SET status = 'superseded', reason = 'same_version_already_applied' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'same_version_already_applied');
  END IF;

  SELECT count(*) INTO v_staged FROM inventory_snapshot_vehicles WHERE snapshot_id = s.id;
  IF v_staged = 0 OR v_staged <> s.valid_count THEN
    UPDATE inventory_store_snapshots SET status = 'rejected', reason = CASE WHEN v_staged = 0 THEN 'empty_snapshot' ELSE 'staging_incomplete' END WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', CASE WHEN v_staged = 0 THEN 'empty_snapshot' ELSE 'staging_incomplete' END);
  END IF;

  PERFORM set_config('app.inventory_writer', 'filescom_apply', true);

  FOR v IN SELECT * FROM inventory_snapshot_vehicles WHERE snapshot_id = s.id ORDER BY row_number LOOP
    v_photos := COALESCE(v.photos, '[]'::jsonb);
    SELECT * INTO cur FROM store_inventory WHERE store_id = st.id AND vin = v.vin FOR UPDATE;
    IF cur.id IS NULL OR cur.presence IN ('retired','transferred') THEN
      SELECT * INTO other FROM store_inventory WHERE group_id = st.group_id AND vin = v.vin AND store_id <> st.id AND presence NOT IN ('retired','transferred');
      IF other.id IS NOT NULL THEN
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, 'other_store', st.id, other.store_id, other.id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
        other := NULL;
        CONTINUE;
      END IF;
    END IF;

    IF cur.id IS NULL THEN
      INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, stock_number, condition, certified, year, make, model, trim, series_detail, body,
        drivetrain, engine, transmission, fuel, equipment, description, mileage, msrp, feed_price, feed_price_status, feed_price_observed_at,
        exterior_color, interior_color, photos, photo_count, photos_modified_at, inventory_date, last_snapshot_id)
      VALUES (st.id, st.group_id, v.vin, s.source_dealer_id, v.stock_number, v.condition, v.certified, v.year, v.make, v.model, v.trim, v.series_detail, v.body,
        v.drivetrain, v.engine, v.transmission, v.fuel, v.equipment, v.description, v.mileage, v.msrp, v.feed_price, v.feed_price_status, now(),
        v.exterior_color, v.interior_color, v_photos, jsonb_array_length(v_photos), v.photos_modified_at, v.inventory_date, s.id)
      RETURNING id INTO v_inv_id;
      v_added := v_added + 1;
    ELSE
      IF cur.presence IN ('retired','transferred','missing','retirement_review') THEN v_returned := v_returned + 1; END IF;
      IF cur.presence IN ('retired','transferred') THEN
        -- A retired car that reappears in its own store's feed is live again.
        UPDATE store_inventory SET presence = 'present', retired_at = NULL, retired_by = NULL, retire_reason = NULL WHERE id = cur.id;
      END IF;
      UPDATE store_inventory SET
        stock_number = v.stock_number, condition = v.condition, certified = v.certified, year = v.year, make = v.make, model = v.model, trim = v.trim,
        series_detail = v.series_detail, body = v.body, drivetrain = v.drivetrain, engine = v.engine, transmission = v.transmission, fuel = v.fuel,
        equipment = v.equipment, description = v.description, mileage = v.mileage, msrp = v.msrp,
        feed_price = v.feed_price, feed_price_status = v.feed_price_status,
        feed_price_observed_at = CASE WHEN v.feed_price IS DISTINCT FROM cur.feed_price OR v.feed_price_status <> cur.feed_price_status THEN now() ELSE cur.feed_price_observed_at END,
        exterior_color = v.exterior_color, interior_color = v.interior_color, photos = v_photos, photo_count = jsonb_array_length(v_photos),
        photos_modified_at = v.photos_modified_at, inventory_date = v.inventory_date,
        presence = 'present', missing_snapshots = 0, last_seen_at = now(), last_snapshot_id = s.id, updated_at = now()
      WHERE id = cur.id;
      IF cur.feed_price IS DISTINCT FROM v.feed_price OR cur.mileage IS DISTINCT FROM v.mileage OR cur.stock_number IS DISTINCT FROM v.stock_number
         OR cur.photos IS DISTINCT FROM v_photos OR cur.condition IS DISTINCT FROM v.condition THEN
        v_updated := v_updated + 1;
      ELSE
        v_unchanged := v_unchanged + 1;
      END IF;
      v_inv_id := cur.id;
    END IF;

    -- Optional: the store's own AutoLabels working listing (subscribed stores).
    IF st.listing_sync_enabled THEN
      v_ymm := NULLIF(trim(concat_ws(' ', v.year::text, v.make, v.model)), '');
      SELECT id, owning_store_id, inventory_record_id, status INTO lst FROM vehicle_listings
       WHERE tenant_id = st.tenant_id AND upper(trim(vin)) = v.vin FOR UPDATE;
      IF lst.id IS NULL THEN
        INSERT INTO vehicle_listings (tenant_id, store_id, owning_store_id, inventory_record_id, vin, slug, ymm, trim, mileage, condition, price,
          status, sticker_snapshot, feed_source, photos, photo_count, hero_image_url, features)
        VALUES (st.tenant_id, st.tenant_id::text, st.id, v_inv_id, v.vin, lower(v.vin) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
          v_ymm, v.trim, v.mileage, v.condition, v.feed_price, 'draft', '{}'::jsonb, 'filescom', v_photos, jsonb_array_length(v_photos),
          v_photos->>0, v.equipment)
        RETURNING id INTO v_listing_id;
        UPDATE store_inventory SET listing_id = v_listing_id WHERE id = v_inv_id;
        v_listings_created := v_listings_created + 1;
      ELSIF lst.owning_store_id = st.id THEN
        UPDATE vehicle_listings SET inventory_record_id = v_inv_id, feed_source = 'filescom', ymm = COALESCE(v_ymm, ymm), trim = COALESCE(v.trim, trim),
          mileage = COALESCE(v.mileage, mileage), condition = v.condition,
          photos = CASE WHEN jsonb_array_length(v_photos) > 0 THEN v_photos ELSE photos END,
          photo_count = CASE WHEN jsonb_array_length(v_photos) > 0 THEN jsonb_array_length(v_photos) ELSE photo_count END,
          price = CASE WHEN st.feed_price_updates_listing AND v.feed_price_status = 'known' THEN v.feed_price ELSE price END
        WHERE id = lst.id;
        UPDATE store_inventory SET listing_id = lst.id WHERE id = v_inv_id;
        v_listings_updated := v_listings_updated + 1;
      ELSIF lst.owning_store_id IS NULL AND st.adopt_legacy_matches THEN
        -- Adoption links an unassigned legacy listing; the price stays as the
        -- dealer set it unless the store's feed price is authoritative.
        UPDATE vehicle_listings SET owning_store_id = st.id, inventory_record_id = v_inv_id, feed_source = 'filescom',
          price = CASE WHEN st.feed_price_updates_listing AND v.feed_price_status = 'known' THEN v.feed_price ELSE price END
        WHERE id = lst.id;
        UPDATE store_inventory SET listing_id = lst.id WHERE id = v_inv_id;
        INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
        VALUES (st.group_id, st.id, 'vehicle_listings', lst.id::text, 'adopt_legacy_listing', jsonb_build_object('vin', v.vin, 'snapshot_id', s.id));
        v_listings_updated := v_listings_updated + 1;
      ELSE
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_listing_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, CASE WHEN lst.owning_store_id IS NULL THEN 'legacy_listing' ELSE 'other_store_listing' END, st.id, lst.owning_store_id, lst.id, v_inv_id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
      END IF;
      lst := NULL;
    END IF;
    cur := NULL;
  END LOOP;

  -- Absence: only this store's own rows, only from a clean snapshot, and only
  -- when the snapshot did not shrink beyond the store's guard. A well-formed
  -- but truncated export must not walk a store's stock towards retirement.
  IF s.clean THEN
    SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM inventory_snapshot_vehicles x WHERE x.snapshot_id = s.id AND x.vin = si.vin))
      INTO v_live, v_absent FROM store_inventory si WHERE si.store_id = st.id AND si.presence IN ('present','missing','retirement_review');
    v_allowed := GREATEST(5, ceil(v_live * st.max_snapshot_shrink_pct / 100.0)::integer);
    v_shrink_held := v_absent > v_allowed;
    IF v_shrink_held THEN
      INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
      VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'shrink_guard_held',
        jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'live', v_live, 'absent', v_absent, 'allowed', v_allowed, 'max_shrink_pct', st.max_snapshot_shrink_pct));
    END IF;
  END IF;
  v_absence_counted := s.clean AND NOT v_shrink_held;
  IF v_absence_counted THEN
    WITH gone AS (
      UPDATE store_inventory si SET
        missing_snapshots = si.missing_snapshots + 1,
        presence = CASE
          WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold AND st.retirement_automation_enabled THEN 'retired'
          WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold THEN 'retirement_review'
          ELSE 'missing' END,
        retired_at = CASE WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold AND st.retirement_automation_enabled THEN now() ELSE si.retired_at END,
        retire_reason = CASE WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold AND st.retirement_automation_enabled THEN 'absent_from_feed' ELSE si.retire_reason END,
        updated_at = now()
      WHERE si.store_id = st.id AND si.presence IN ('present','missing','retirement_review')
        AND NOT EXISTS (SELECT 1 FROM inventory_snapshot_vehicles x WHERE x.snapshot_id = s.id AND x.vin = si.vin)
      RETURNING si.presence
    )
    SELECT count(*) FILTER (WHERE presence = 'missing'), count(*) FILTER (WHERE presence = 'retirement_review'), count(*) FILTER (WHERE presence = 'retired')
      INTO v_missing, v_review, v_retired FROM gone;
  END IF;

  UPDATE inventory_store_snapshots SET status = 'applied', applied_at = now(),
    report = COALESCE(report, '{}'::jsonb) || jsonb_build_object('apply', jsonb_build_object(
      'added', v_added, 'updated', v_updated, 'unchanged', v_unchanged, 'returned', v_returned, 'conflicts', v_conflicts,
      'missing', v_missing, 'retirement_review', v_review, 'retired', v_retired, 'absence_counted', v_absence_counted,
      'shrink_guard', jsonb_build_object('held', v_shrink_held, 'live', v_live, 'absent', v_absent, 'allowed', v_allowed),
      'listings_created', v_listings_created, 'listings_updated', v_listings_updated, 'provider_calls', 0))
  WHERE id = s.id;
  UPDATE inventory_store_state SET last_applied_snapshot_id = s.id, last_applied_source_mtime = s.source_mtime, last_applied_sha256 = s.content_sha256,
    last_applied_at = now(), last_run_id = s.run_id, updated_at = now() WHERE store_id = st.id;
  INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
  VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'apply_snapshot',
    jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'added', v_added, 'updated', v_updated, 'conflicts', v_conflicts, 'missing', v_missing, 'retired', v_retired));

  RETURN jsonb_build_object('applied', true, 'added', v_added, 'updated', v_updated, 'unchanged', v_unchanged, 'returned', v_returned,
    'conflicts', v_conflicts, 'missing', v_missing, 'retirement_review', v_review, 'retired', v_retired,
    'listings_created', v_listings_created, 'listings_updated', v_listings_updated, 'absence_counted', v_absence_counted, 'shrink_guard_held', v_shrink_held);
END $$;

REVOKE ALL ON FUNCTION public.inventory_apply_store_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_apply_store_snapshot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_listings_store_feed_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.owning_store_id IS NULL OR current_setting('app.inventory_writer', true) = 'filescom_apply' THEN
    RETURN NEW;
  END IF;
  NEW.owning_store_id := OLD.owning_store_id;
  NEW.inventory_record_id := OLD.inventory_record_id;
  IF OLD.feed_source = 'filescom' AND NEW.feed_source IS DISTINCT FROM 'filescom' THEN
    NEW.feed_source := OLD.feed_source;
    NEW.condition := OLD.condition;
    NEW.ymm := OLD.ymm;
    NEW.trim := OLD.trim;
    NEW.mileage := OLD.mileage;
    NEW.price := OLD.price;
    NEW.doc_fee := OLD.doc_fee;
    NEW.advertised_price_before_doc := OLD.advertised_price_before_doc;
    NEW.website_sale_price := OLD.website_sale_price;
    NEW.price_source_url := OLD.price_source_url;
    NEW.price_parse_status := OLD.price_parse_status;
    NEW.price_parse_notes := OLD.price_parse_notes;
    NEW.price_last_verified_at := OLD.price_last_verified_at;
    NEW.hero_image_url := OLD.hero_image_url;
    NEW.source_url := OLD.source_url;
  END IF;
  RETURN NEW;
END $$;

DROP FUNCTION IF EXISTS public.inv_dedupe_scan(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_create_preview(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_approve(uuid, text);
DROP FUNCTION IF EXISTS public.inv_dedupe_apply(uuid, text);
DROP FUNCTION IF EXISTS public.inv_dedupe_apply_internal(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_batch_create(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.inv_dedupe_batch_step(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_batch_resume(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_batch_progress(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_undo(uuid, text, text);
DROP FUNCTION IF EXISTS public.inv_dedupe_undo_plan(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_recovery_plan(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_purge_check(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_set_controls(jsonb);
DROP FUNCTION IF EXISTS public.inv_dedupe_set_store_pause(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.inv_dedupe_overview(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_get_preview(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_reveal_vin(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_build_plan(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_state(uuid[], uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_dependencies(uuid);
DROP FUNCTION IF EXISTS public.inv_dedupe_listing_view(uuid);

-- The wider conflict kinds stay while archived_listing or reconciled_listing_unresolved rows exist, so their
-- history remains valid.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inventory_vin_conflicts WHERE kind IN ('archived_listing', 'reconciled_listing_unresolved')) THEN
    ALTER TABLE public.inventory_vin_conflicts DROP CONSTRAINT IF EXISTS inventory_vin_conflicts_kind_check;
    ALTER TABLE public.inventory_vin_conflicts ADD CONSTRAINT inventory_vin_conflicts_kind_check CHECK (kind IN ('other_store','legacy_listing','other_store_listing'));
  END IF;
END $$;

UPDATE public.inventory_dedupe_controls SET auto_reconcile_enabled = false, emergency_stop = true, reason = 'Rolled back 0014', updated_at = now() WHERE id = 1;

COMMIT;
