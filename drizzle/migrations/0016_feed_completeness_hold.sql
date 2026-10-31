-- -- Feed completeness hold (applies after 0014) --------------------------------
--
-- Owner requirement 2026-10-31: a suspicious snapshot must not increment
-- missing counters, retire vehicles, reprice listings or replace the trusted
-- baseline; it is held for review with its reason. Feeds declare full-snapshot
-- or incremental semantics. Thresholds below are proposals: new columns are
-- NULL (check off) until the owner sets them, except where noted.
--
--   feed_semantics        'full_snapshot' (default; today's behaviour) or
--                         'incremental' (absence is never counted).
--   max_snapshot_shrink_pct  existing (0012, live at 20).
--   min_absent_vehicles   smallest absent count that can trip a hold. NULL keeps
--                         0012's floor (6, i.e. more than 5). Proposed: 2.
--   max_count_drop_pct    hold when the file has this much fewer vehicles than
--                         the last trusted snapshot. NULL = off. Proposed: 20.
--
-- Held snapshots are resolved by inv_admin_resolve_held_snapshot: apply as a
-- confirmed full snapshot, apply without counting absence, or reject.

ALTER TABLE public.dealer_stores
  ADD COLUMN IF NOT EXISTS feed_semantics text NOT NULL DEFAULT 'full_snapshot' CHECK (feed_semantics IN ('full_snapshot','incremental')),
  ADD COLUMN IF NOT EXISTS min_absent_vehicles integer CHECK (min_absent_vehicles IS NULL OR min_absent_vehicles BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS max_count_drop_pct integer CHECK (max_count_drop_pct IS NULL OR max_count_drop_pct BETWEEN 1 AND 100);

ALTER TABLE public.inventory_store_state
  ADD COLUMN IF NOT EXISTS last_trusted_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS last_trusted_valid_count integer,
  ADD COLUMN IF NOT EXISTS last_trusted_at timestamptz;

ALTER TABLE public.inventory_store_snapshots DROP CONSTRAINT IF EXISTS inventory_store_snapshots_status_check;
ALTER TABLE public.inventory_store_snapshots ADD CONSTRAINT inventory_store_snapshots_status_check
  CHECK (status IN ('staged','held','applied','quarantined','rejected','superseded','failed'));
CREATE INDEX IF NOT EXISTS inventory_store_snapshots_held_idx ON public.inventory_store_snapshots (store_id) WHERE status = 'held';

-- The trusted baseline starts at the last applied snapshot that counted
-- absence, so it was clean and passed the 0012 guard.
UPDATE public.inventory_store_state ss SET last_trusted_snapshot_id = s.id, last_trusted_valid_count = s.valid_count, last_trusted_at = s.applied_at
  FROM public.inventory_store_snapshots s
 WHERE s.id = ss.last_applied_snapshot_id AND s.status = 'applied' AND (s.report->'apply'->>'absence_counted')::boolean IS TRUE
   AND ss.last_trusted_snapshot_id IS NULL;

CREATE OR REPLACE FUNCTION public.inventory_apply_store_snapshot_mode(p_snapshot_id uuid, p_mode text)
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
  v_min_absent integer; v_drop integer := 0; v_rules text[] := '{}'; v_full boolean; v_trusted boolean := false;
  v_canonical uuid;
  v_alias_id uuid;
BEGIN
  SELECT * INTO s FROM inventory_store_snapshots WHERE id = p_snapshot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_not_found'; END IF;
  IF p_mode NOT IN ('auto','confirm_full','no_absence') THEN RAISE EXCEPTION 'bad_apply_mode'; END IF;
  -- A held snapshot is applied only by an explicit admin decision.
  IF NOT (s.status = 'staged' OR (s.status = 'held' AND p_mode <> 'auto')) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'snapshot_not_staged', 'status', s.status);
  END IF;

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

  -- Completeness. A full-snapshot feed is compared with the store's live
  -- stock and with the last trusted snapshot before anything is written. A
  -- suspicious snapshot is held whole: no additions, prices, listing changes,
  -- absence counters or baseline move until an admin decides.
  v_full := st.feed_semantics = 'full_snapshot';
  SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM inventory_snapshot_vehicles x WHERE x.snapshot_id = s.id AND x.vin = si.vin))
    INTO v_live, v_absent FROM store_inventory si WHERE si.store_id = st.id AND si.presence IN ('present','missing','retirement_review');
  v_min_absent := COALESCE(st.min_absent_vehicles, 6);
  v_allowed := GREATEST(v_min_absent - 1, ceil(v_live * st.max_snapshot_shrink_pct / 100.0)::integer);
  IF ss.last_trusted_valid_count IS NOT NULL THEN v_drop := GREATEST(ss.last_trusted_valid_count - s.valid_count, 0); END IF;
  IF p_mode = 'auto' AND v_full THEN
    IF v_absent > v_allowed THEN v_rules := array_append(v_rules, 'absent_vs_live'); END IF;
    IF st.max_count_drop_pct IS NOT NULL AND ss.last_trusted_valid_count > 0 AND v_drop >= v_min_absent
       AND v_drop * 100 > ss.last_trusted_valid_count * st.max_count_drop_pct THEN
      v_rules := array_append(v_rules, 'count_drop_vs_trusted');
    END IF;
  END IF;
  IF cardinality(v_rules) > 0 THEN
    -- Only the newest suspicious file waits; older held files are superseded.
    UPDATE inventory_store_snapshots SET status = 'superseded', reason = 'newer_snapshot_held'
     WHERE store_id = st.id AND status = 'held' AND id <> s.id;
    UPDATE inventory_store_snapshots SET status = 'held', reason = 'held_for_review',
      report = COALESCE(report, '{}'::jsonb) || jsonb_build_object('hold', jsonb_build_object(
        'rules', to_jsonb(v_rules), 'live', v_live, 'absent', v_absent, 'allowed_absent', v_allowed,
        'valid', s.valid_count, 'trusted_valid', ss.last_trusted_valid_count, 'trusted_snapshot_id', ss.last_trusted_snapshot_id,
        'drop_vs_trusted', v_drop, 'max_shrink_pct', st.max_snapshot_shrink_pct, 'max_count_drop_pct', st.max_count_drop_pct,
        'min_absent_vehicles', v_min_absent, 'held_at', now()))
     WHERE id = s.id;
    INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
    VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'snapshot_held',
      jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'rules', to_jsonb(v_rules), 'live', v_live, 'absent', v_absent,
        'allowed_absent', v_allowed, 'valid', s.valid_count, 'trusted_valid', ss.last_trusted_valid_count));
    RETURN jsonb_build_object('applied', false, 'reason', 'held_for_review', 'rules', to_jsonb(v_rules), 'live', v_live, 'absent', v_absent, 'allowed_absent', v_allowed);
  END IF;

  PERFORM set_config('app.inventory_writer', 'filescom_apply', true);

  FOR v IN SELECT * FROM inventory_snapshot_vehicles WHERE snapshot_id = s.id ORDER BY row_number LOOP
    v_photos := COALESCE(v.photos, '[]'::jsonb);
    -- Before any row lock for this VIN (see inv_dedupe_lock).
    PERFORM inv_dedupe_lock(st.tenant_id, v.vin);
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
      v_alias_id := NULL;
      v_ymm := NULLIF(trim(concat_ws(' ', v.year::text, v.make, v.model)), '');
      SELECT id, owning_store_id, inventory_record_id, status, reconciled_into_listing_id INTO lst FROM vehicle_listings
       WHERE tenant_id = st.tenant_id AND upper(trim(vin)) = v.vin
       ORDER BY (reconciled_into_listing_id IS NULL) DESC, (status <> 'archived') DESC, id LIMIT 1 FOR UPDATE;
      -- A reconciled duplicate resolves to its canonical listing, so a reimport
      -- or delayed job never revives or recreates it.
      IF lst.id IS NOT NULL AND lst.reconciled_into_listing_id IS NOT NULL THEN
        v_alias_id := lst.id;
        v_canonical := inv_dedupe_resolve_listing(lst.id);
        lst := NULL;
        SELECT id, owning_store_id, inventory_record_id, status, reconciled_into_listing_id INTO lst FROM vehicle_listings WHERE id = v_canonical FOR UPDATE;
      END IF;
      IF v_alias_id IS NOT NULL AND (lst.id IS NULL OR lst.reconciled_into_listing_id IS NOT NULL) THEN
        -- The alias chain is broken, too long or points at a missing listing.
        -- Creating a listing here would recreate the duplicate, so skip the
        -- listing step and leave it for a person.
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_listing_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, 'reconciled_listing_unresolved', st.id, NULL, v_alias_id, v_inv_id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
      ELSIF lst.id IS NULL THEN
        INSERT INTO vehicle_listings (tenant_id, store_id, owning_store_id, inventory_record_id, vin, slug, ymm, trim, mileage, condition, price,
          status, sticker_snapshot, feed_source, photos, photo_count, hero_image_url, features)
        VALUES (st.tenant_id, st.tenant_id::text, st.id, v_inv_id, v.vin, lower(v.vin) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
          v_ymm, v.trim, v.mileage, v.condition, v.feed_price, 'draft', '{}'::jsonb, 'filescom', v_photos, jsonb_array_length(v_photos),
          v_photos->>0, v.equipment)
        RETURNING id INTO v_listing_id;
        UPDATE store_inventory SET listing_id = v_listing_id WHERE id = v_inv_id;
        v_listings_created := v_listings_created + 1;
      ELSIF lst.status = 'archived' AND (lst.owning_store_id IS NULL OR lst.owning_store_id = st.id) THEN
        -- An archived listing may belong to an earlier inventory episode or a
        -- recorded sale. Linking it to today's car is a person's decision.
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_listing_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, 'archived_listing', st.id, lst.owning_store_id, lst.id, v_inv_id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
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

  -- Absence: only this store's own rows, only from a clean full snapshot that
  -- passed the completeness checks above (or that an admin confirmed as full).
  v_absence_counted := s.clean AND v_full AND p_mode <> 'no_absence';
  v_trusted := v_absence_counted;
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
      'shrink_guard', jsonb_build_object('held', false, 'live', v_live, 'absent', v_absent, 'allowed', v_allowed),
      'mode', p_mode, 'trusted', v_trusted,
      'listings_created', v_listings_created, 'listings_updated', v_listings_updated, 'provider_calls', 0))
  WHERE id = s.id;
  UPDATE inventory_store_state SET last_applied_snapshot_id = s.id, last_applied_source_mtime = s.source_mtime, last_applied_sha256 = s.content_sha256,
    last_applied_at = now(), last_run_id = s.run_id, updated_at = now(),
    last_trusted_snapshot_id = CASE WHEN v_trusted THEN s.id ELSE last_trusted_snapshot_id END,
    last_trusted_valid_count = CASE WHEN v_trusted THEN s.valid_count ELSE last_trusted_valid_count END,
    last_trusted_at = CASE WHEN v_trusted THEN now() ELSE last_trusted_at END
  WHERE store_id = st.id;
  -- A held file older than the one just applied can no longer be applied.
  UPDATE inventory_store_snapshots SET status = 'superseded', reason = 'newer_snapshot_applied'
   WHERE store_id = st.id AND status = 'held' AND id <> s.id AND source_mtime <= s.source_mtime;
  INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
  VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'apply_snapshot',
    jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'added', v_added, 'updated', v_updated, 'conflicts', v_conflicts, 'missing', v_missing, 'retired', v_retired));

  RETURN jsonb_build_object('applied', true, 'added', v_added, 'updated', v_updated, 'unchanged', v_unchanged, 'returned', v_returned,
    'conflicts', v_conflicts, 'missing', v_missing, 'retirement_review', v_review, 'retired', v_retired,
    'listings_created', v_listings_created, 'listings_updated', v_listings_updated, 'absence_counted', v_absence_counted, 'shrink_guard_held', false,
    'trusted', v_trusted, 'mode', p_mode);
END $$;

CREATE OR REPLACE FUNCTION public.inventory_apply_store_snapshot(p_snapshot_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.inventory_apply_store_snapshot_mode(p_snapshot_id, 'auto')
$$;

CREATE OR REPLACE FUNCTION public.inv_admin_resolve_held_snapshot(p_snapshot_id uuid, p_action text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); s public.inventory_store_snapshots%ROWTYPE; r jsonb;
BEGIN
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO s FROM inventory_store_snapshots WHERE id = p_snapshot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_not_found'; END IF;
  IF s.status <> 'held' THEN RAISE EXCEPTION 'snapshot_not_held'; END IF;
  IF p_action = 'reject' THEN
    UPDATE inventory_store_snapshots SET status = 'rejected', reason = 'rejected_after_hold' WHERE id = s.id;
    r := jsonb_build_object('applied', false, 'reason', 'rejected_after_hold');
  ELSIF p_action = 'apply_full' THEN
    r := inventory_apply_store_snapshot_mode(s.id, 'confirm_full');
  ELSIF p_action = 'apply_without_absence' THEN
    r := inventory_apply_store_snapshot_mode(s.id, 'no_absence');
  ELSE
    RAISE EXCEPTION 'bad_action';
  END IF;
  INSERT INTO inventory_network_audit (group_id, store_id, actor, entity, entity_id, action, after)
  VALUES (s.group_id, s.store_id, v_uid, 'inventory_store_snapshots', s.id::text, 'resolve_held_snapshot',
    jsonb_build_object('action', p_action, 'reason', left(p_reason, 300), 'result', r));
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_set_feed_completeness(p_store_id uuid, p jsonb, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); st public.dealer_stores%ROWTYPE;
BEGIN
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO st FROM dealer_stores WHERE id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'store_not_found'; END IF;
  UPDATE dealer_stores SET
    feed_semantics = COALESCE(p->>'feed_semantics', feed_semantics),
    max_snapshot_shrink_pct = COALESCE((p->>'max_snapshot_shrink_pct')::integer, max_snapshot_shrink_pct),
    min_absent_vehicles = CASE WHEN p ? 'min_absent_vehicles' THEN (p->>'min_absent_vehicles')::integer ELSE min_absent_vehicles END,
    max_count_drop_pct = CASE WHEN p ? 'max_count_drop_pct' THEN (p->>'max_count_drop_pct')::integer ELSE max_count_drop_pct END,
    updated_by = v_uid
  WHERE id = st.id;
  INSERT INTO inventory_network_audit (group_id, store_id, actor, entity, entity_id, action, before, after)
  VALUES (st.group_id, st.id, v_uid, 'dealer_stores', st.id::text, 'set_feed_completeness',
    jsonb_build_object('feed_semantics', st.feed_semantics, 'max_snapshot_shrink_pct', st.max_snapshot_shrink_pct,
      'min_absent_vehicles', st.min_absent_vehicles, 'max_count_drop_pct', st.max_count_drop_pct),
    p || jsonb_build_object('reason', left(p_reason, 300)));
END $$;

REVOKE ALL ON FUNCTION public.inventory_apply_store_snapshot_mode(uuid, text), public.inventory_apply_store_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_apply_store_snapshot_mode(uuid, text), public.inventory_apply_store_snapshot(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.inv_admin_resolve_held_snapshot(uuid, text, text), public.inv_admin_set_feed_completeness(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_admin_resolve_held_snapshot(uuid, text, text), public.inv_admin_set_feed_completeness(uuid, jsonb, text) TO authenticated;
