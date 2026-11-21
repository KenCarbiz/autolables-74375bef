-- Legacy scrape retirement, BATCH B: 14 legacy scrape rows for cars that are in George Harte INFINITI's SFTP feed.
-- The cars stay in George Harte INFINITI's store_inventory untouched; only the stale, unowned legacy listing is retired.
--
-- PRODUCTION EXECUTION SCRIPT. Do not run until Ken gives the final execution
-- approval for this exact batch. Do not edit the lists.
--
-- This is ONE statement (a DO block), so it is atomic on any client: if any
-- gate or check fails it raises, and nothing is written. There is no
-- separate COMMIT to forget and no boolean SELECT to read by eye.
--
-- Before running: fill c_approval with Ken's exact approval text and set
-- c_passport_release_verified to true once PR #54 is verified live.
-- Rollback after success: see the RESTORE section at the end.

DO $exec$
DECLARE
  c_tenant constant uuid := '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142';
  c_ids constant uuid[] := ARRAY[
    'a229e4e0-5b2c-458f-a511-b1f928509fb8',
    '2c64a0bf-b1ff-4874-833b-e0ac7a267fd9',
    'fcf35d65-a0f7-418b-ba3f-35fbeff66da0',
    '890cf6c3-d7e9-430d-843a-177639fd7bb0',
    '9aab1999-3189-4a7e-8dd9-7993ffd3df79',
    'c9c28607-06d6-4845-a15c-bc31e1a90feb',
    'bedb5f21-7c2f-4a55-9115-50af26c0468b',
    '3405fdde-1c7b-4efc-a58c-974046b9d7fd',
    'a8e2e604-d0aa-4124-a7cc-483cf3b35ced',
    'e4dca5a4-f114-4817-98fb-e8493a7241ba',
    '7f2a9c62-8a38-4c4c-989e-63641299087d',
    '93977a96-0eae-4ef9-bb5b-83b748f0dce6',
    'c7dab285-ed21-4bbc-8ab9-b4a850925319',
    'd0ba5a6c-2ab9-43b9-9270-bc8b8d957545'
  ]::uuid[];
  c_vins constant text[] := ARRAY[
    '5N1AL1FS2TC330859',
    '5N1AL1FW1TC358865',
    'JN8AZ3CC9T9622022',
    '5N1AL1F96VC337944',
    '5N1AC0FX3VC609312',
    '5N1AC0FX5VC609313',
    '5N1AC0FX9VC607757',
    '5N1AC0JX1VC605072',
    '5N1AC0JX3VC606305',
    'JN8AZ3BB0V9451110',
    'JN8AZ3BB1V9451052',
    'JN8AZ3BB3V9450369',
    'JN8AZ3BB4V9450493',
    'JN8AZ3BB7V9451105'
  ];
  c_allow_sftp constant text[] := ARRAY[
    '5N1AL1FS2TC330859',
    '5N1AL1FW1TC358865',
    'JN8AZ3CC9T9622022',
    '5N1AL1F96VC337944',
    '5N1AC0FX3VC609312',
    '5N1AC0FX5VC609313',
    '5N1AC0FX9VC607757',
    '5N1AC0JX1VC605072',
    '5N1AC0JX3VC606305',
    'JN8AZ3BB0V9451110',
    'JN8AZ3BB1V9451052',
    'JN8AZ3BB3V9450369',
    'JN8AZ3BB4V9450493',
    'JN8AZ3BB7V9451105'
  ];
  c_reason constant text := 'Batch B: retire stale legacy scrape listings for cars now in George Harte INFINITI SFTP feed';
  c_approval constant text := '<KEN_FINAL_EXECUTION_APPROVAL_TEXT>';
  c_passport_release_verified constant boolean := false;
  v_msg text;
  v_n integer := 14;
  v_pre jsonb; v_post jsonb; v_dry jsonb; v_run jsonb; v_batch uuid;
  v_rogue_status text;
BEGIN
  IF cardinality(c_ids) <> v_n OR cardinality(c_vins) <> v_n THEN RAISE EXCEPTION 'gate 0: list length changed'; END IF;

  -- Gate 0: the operator filled in the approval and confirmed the Passport release.
  IF c_approval LIKE '<%' OR length(trim(c_approval)) < 20 THEN
    RAISE EXCEPTION 'gate 0: paste Ken''s final execution approval into c_approval';
  END IF;
  IF NOT c_passport_release_verified THEN
    RAISE EXCEPTION 'gate 0: PR #54 must be live on autolabels.io and verified (archived Passport shows "No longer listed", no purchase actions); then set c_passport_release_verified := true';
  END IF;

  -- Gate 1: PR #65 is installed exactly as reviewed.
  IF to_regprocedure('public.legacy_listing_retire(uuid, uuid[], text[], text[], text[], text, text, boolean)') IS NULL
     OR to_regprocedure('public.legacy_listing_restore(uuid, text)') IS NULL
     OR to_regprocedure('public.legacy_listing_rehome(uuid, uuid, text)') IS NULL
     OR to_regprocedure('public.legacy_retirement_baseline(uuid)') IS NULL
     OR to_regclass('public.legacy_retirement_batches') IS NULL THEN
    RAISE EXCEPTION 'gate 1: the PR #65 retirement migration is not installed';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.vehicle_listings'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
        AND tgname IN ('vehicle_listings_legacy_retired_guard', 'vehicle_listings_owner_assignment_guard')) <> 2
     OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.legacy_listing_retirements'::regclass AND tgname = 'legacy_listing_retirements_append_only' AND tgenabled <> 'D') <> 1 THEN
    RAISE EXCEPTION 'gate 1: a retirement or ownership guard trigger is missing or disabled';
  END IF;
  IF has_function_privilege('anon', 'public.legacy_listing_retire(uuid, uuid[], text[], text[], text[], text, text, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.legacy_listing_retire(uuid, uuid[], text[], text[], text[], text, text, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.legacy_listing_restore(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.legacy_listing_rehome(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gate 1: retirement functions are callable by a client role';
  END IF;

  -- Gate 2: every approved feed for the tenant is fully imported. No pending
  -- file, no queued or running job, and an applied snapshot at or after the
  -- latest file notification.
  SELECT string_agg(b.path, ', ') INTO v_msg
    FROM inventory_feed_bindings b
    JOIN inventory_feed_files f ON f.path = b.path
   WHERE b.tenant_id = c_tenant AND b.status = 'approved'
     AND (f.status = 'pending'
          OR EXISTS (SELECT 1 FROM inventory_feed_jobs j WHERE j.path = b.path AND j.status IN ('queued', 'running'))
          OR NOT EXISTS (SELECT 1 FROM inventory_store_snapshots s WHERE s.path = b.path AND s.status = 'applied'
                          AND s.applied_at >= coalesce(f.latest_notified_at, f.latest_event_at, '-infinity'::timestamptz)));
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'gate 2: SFTP feeds not freshly imported: %', v_msg;
  END IF;


  -- Gate 3 (batch B): each of the 14 is present in George Harte INFINITI's
  -- SFTP inventory with the expected stock number, in its latest applied
  -- snapshot, and in no other store.
  SELECT string_agg(e.vin, ', ') INTO v_msg
    FROM (VALUES ('5N1AL1FS2TC330859','IN6846S'), ('5N1AL1FW1TC358865','IN6878'), ('JN8AZ3CC9T9622022','IN6886S'), ('5N1AL1F96VC337944','IN6897'), ('5N1AC0FX3VC609312','IN6936'), ('5N1AC0FX5VC609313','IN6937'), ('5N1AC0FX9VC607757','IN6931'), ('5N1AC0JX1VC605072','IN6914'), ('5N1AC0JX3VC606305','IN6927'), ('JN8AZ3BB0V9451110','IN6912'), ('JN8AZ3BB1V9451052','IN6913'), ('JN8AZ3BB3V9450369','IN6906'), ('JN8AZ3BB4V9450493','IN6907'), ('JN8AZ3BB7V9451105','IN6917')) e(vin, stock)
   WHERE NOT EXISTS (SELECT 1 FROM store_inventory si WHERE si.store_id = 'e400e636-0909-4b36-822e-caa2b5ae7381' AND upper(si.vin) = e.vin AND si.presence = 'present' AND si.stock_number = e.stock)
      OR NOT EXISTS (SELECT 1 FROM inventory_snapshot_vehicles sv JOIN inventory_store_state st ON st.last_applied_snapshot_id = sv.snapshot_id
                      WHERE st.store_id = 'e400e636-0909-4b36-822e-caa2b5ae7381' AND upper(sv.vin) = e.vin AND sv.stock_number = e.stock)
      OR EXISTS (SELECT 1 FROM store_inventory si WHERE upper(si.vin) = e.vin AND si.store_id <> 'e400e636-0909-4b36-822e-caa2b5ae7381');
  IF v_msg IS NOT NULL THEN RAISE EXCEPTION 'gate 3: VIN/stock no longer matches George Harte INFINITI: %', v_msg; END IF;
  -- George Harte INFINITI listing sync must still be off; the rehome path is
  -- a separate, reviewed step.
  IF (SELECT listing_sync_enabled FROM dealer_stores WHERE id = 'e400e636-0909-4b36-822e-caa2b5ae7381') THEN
    RAISE EXCEPTION 'gate 3: George Harte INFINITI listing sync is on; review the rehome plan first';
  END IF;

  -- Gate 4: the retirement function's own checks, as a dry run. Every listing
  -- must still be a published, unowned MarketCheck scrape row with no signing,
  -- open lead or customer deal.
  v_dry := legacy_listing_retire(c_tenant, c_ids, c_vins, ARRAY['harteinfiniti.com', 'hartecars.com'], c_allow_sftp, c_reason, NULL, true);
  IF (v_dry->>'eligible')::int <> v_n OR (v_dry->>'blocked')::int <> 0 THEN
    RAISE EXCEPTION 'gate 4: dry run found % blocked of %', v_dry->>'blocked', v_n USING DETAIL = v_dry::text;
  END IF;

  -- Baseline, then the real run (it also writes the baseline to legacy_retirement_batches).
  SELECT status INTO v_rogue_status FROM vehicle_listings WHERE upper(vin) = '5N1AT3CB7MC736556' AND tenant_id = c_tenant;
  v_pre := legacy_retirement_baseline(c_tenant);
  v_run := legacy_listing_retire(c_tenant, c_ids, c_vins, ARRAY['harteinfiniti.com', 'hartecars.com'], c_allow_sftp, c_reason, c_approval, false);
  v_batch := (v_run->>'batch_id')::uuid;
  IF v_batch IS NULL OR (v_run->>'retired')::int <> v_n THEN RAISE EXCEPTION 'post: retire did not return a batch of %', v_n; END IF;

  -- Post-checks. Any failure raises, and the whole block rolls back.
  IF (SELECT count(*) FROM vehicle_listings WHERE id = ANY (c_ids) AND status = 'archived' AND archive_reason = 'legacy_scrape_retired') <> v_n THEN
    RAISE EXCEPTION 'post: not every listing in the batch is retired';
  END IF;
  IF (SELECT count(*) FROM legacy_listing_retirements WHERE batch_id = v_batch) <> v_n
     OR NOT EXISTS (SELECT 1 FROM legacy_retirement_batches WHERE batch_id = v_batch) THEN
    RAISE EXCEPTION 'post: audit rows or batch record missing';
  END IF;
  v_post := legacy_retirement_baseline(c_tenant);
  IF v_post->>'store_inventory_hash' IS DISTINCT FROM v_pre->>'store_inventory_hash'
     OR v_post->>'store_inventory_rows' IS DISTINCT FROM v_pre->>'store_inventory_rows'
     OR v_post->'store_snapshots' IS DISTINCT FROM v_pre->'store_snapshots' THEN
    RAISE EXCEPTION 'post: SFTP inventory or snapshots changed';
  END IF;
  IF coalesce((v_post->'listing_status'->>'published')::int, 0) <> coalesce((v_pre->'listing_status'->>'published')::int, 0) - v_n
     OR coalesce((v_post->'listing_status'->>'archived')::int, 0) <> coalesce((v_pre->'listing_status'->>'archived')::int, 0) + v_n
     OR (v_post->'listing_status') - 'published' - 'archived' IS DISTINCT FROM (v_pre->'listing_status') - 'published' - 'archived'
     OR (v_post->>'null_owner_published')::int <> (v_pre->>'null_owner_published')::int - v_n THEN
    RAISE EXCEPTION 'post: listing counts moved by something other than exactly % retirements', v_n;
  END IF;
  IF (SELECT status FROM vehicle_listings WHERE upper(vin) = '5N1AT3CB7MC736556' AND tenant_id = c_tenant) IS DISTINCT FROM v_rogue_status THEN
    RAISE EXCEPTION 'post: the 2021 Rogue changed';
  END IF;

  RAISE NOTICE 'COMMITTED batch_id=% retired=% baseline=%', v_batch, v_n, v_pre;
END $exec$;

-- After it returns, record the batch id (it is also in legacy_retirement_batches):
-- SELECT batch_id, created_at, cardinality(listing_ids), baseline FROM public.legacy_retirement_batches ORDER BY created_at DESC LIMIT 1;

-- ── RESTORE (rollback after success; needs Ken's approval) ──────────────────
-- Puts back status, published/archived fields, sticker generation states and
-- description cases for every row of the batch that is still retired.
-- DO $r$ DECLARE v jsonb; BEGIN
--   v := public.legacy_listing_restore('<batch_id>'::uuid, '<KEN_RESTORE_APPROVAL_TEXT>');
--   IF (v->>'restored')::int + jsonb_array_length(v->'skipped') <> 14 THEN RAISE EXCEPTION 'restore count mismatch %', v; END IF;
--   RAISE NOTICE 'restore %', v;
-- END $r$;
