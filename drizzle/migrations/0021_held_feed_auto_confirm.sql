-- -- Held feeds recover on agreement (applies after 0016) -----------------------
--
-- Owner decision 2026-11-21: a store whose files were held kept its last good
-- import forever, because sold cars stayed live and every new file looked
-- worse. A held file is now applied automatically when the next clean file
-- agrees with it (loses no more than the guard relative to it), provided the
-- drop is no more than twice the guard. Anything larger still waits in Held
-- files. Only inventory_apply_store_snapshot_mode changes; grants are kept.

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
  p public.inventory_store_snapshots%ROWTYPE;
  v_since_prior integer := 0; v_prior_allowed integer := 0; v_confirmed_by uuid;
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
  -- Two clean files in a row that agree with each other are evidence the
  -- stock really fell (weekend sales), not a cut-off export. Without this a
  -- held store never recovers: sold cars stay live, so every later file looks
  -- worse than the one before. A drop of more than twice the guard still
  -- waits for a person.
  IF cardinality(v_rules) > 0 AND s.clean AND v_absent * 100 <= v_live * 2 * st.max_snapshot_shrink_pct
     AND (ss.last_trusted_valid_count IS NULL OR st.max_count_drop_pct IS NULL
          OR v_drop * 100 <= ss.last_trusted_valid_count * 2 * st.max_count_drop_pct) THEN
    SELECT * INTO p FROM inventory_store_snapshots
     WHERE store_id = st.id AND status = 'held' AND id <> s.id AND clean
       AND source_mtime < s.source_mtime AND content_sha256 IS DISTINCT FROM s.content_sha256
     ORDER BY source_mtime DESC LIMIT 1;
    IF p.id IS NOT NULL THEN
      SELECT count(*) INTO v_since_prior FROM inventory_snapshot_vehicles x
       WHERE x.snapshot_id = p.id AND NOT EXISTS (SELECT 1 FROM inventory_snapshot_vehicles y WHERE y.snapshot_id = s.id AND y.vin = x.vin);
      v_prior_allowed := GREATEST(v_min_absent - 1, ceil(p.valid_count * st.max_snapshot_shrink_pct / 100.0)::integer);
      IF p.valid_count > 0 AND v_since_prior <= v_prior_allowed THEN
        v_confirmed_by := p.id;
        INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
        VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'snapshot_auto_confirmed',
          jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'rules', to_jsonb(v_rules), 'live', v_live, 'absent', v_absent,
            'allowed_absent', v_allowed, 'valid', s.valid_count, 'confirmed_by_snapshot_id', p.id, 'missing_since_prior', v_since_prior));
        v_rules := '{}';
      END IF;
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
      'mode', p_mode, 'trusted', v_trusted, 'auto_confirmed_by', v_confirmed_by,
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
