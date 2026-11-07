-- Legacy scrape retirement, BATCH A: 37 MarketCheck-scraped Harte listings in none of the six SFTP feeds.
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
    '9fe5cca1-1e0d-4688-8320-d530400f059f',
    '01e01c5d-e723-4b34-aba4-0ebe25a9c92c',
    '553c7abb-9d6c-4a20-b148-d093e3dde552',
    '4a5d9976-f8f9-475f-890f-e0c3ca2493bb',
    'a895365e-7625-497e-bf6c-525dbdc10da0',
    '445a2599-5adc-4eb7-82ea-801147d93ba7',
    '2d2f1a76-a93d-4378-a76f-6ce6250d4502',
    '56a12bbf-1173-4f81-af8e-9c8f0d48343a',
    'efcadddc-c4b1-459c-92bb-26ce552011c9',
    '6cec3722-b6ba-4bcb-9673-75069156de72',
    '002ed385-8cee-4e37-a888-5f284c5bd8be',
    'f371162d-f726-4d86-b605-e676d84fa5bd',
    '51e1789b-eab5-48db-9609-0de2bab02193',
    '2dd29934-cc47-438b-9977-783a3b61f0e4',
    '0b161ca5-1076-4265-a4e0-3436d7b4e92c',
    'd0e50f18-724a-4855-ad5d-cd529f854810',
    '3616c2a1-6a26-4716-91ff-e90db77ec4e8',
    'a981068e-3850-4b60-a960-8b825bde93c1',
    '934a0488-8dfb-4187-8939-602f9cfcc947',
    'a56ba38f-a283-4caa-ba53-876a1625fc74',
    '87146b8e-8e1c-4a95-a736-82089f1bd296',
    '0db95e59-19b6-481f-a261-fd5accc6033b',
    '3aaa763e-5996-4465-95bd-3a4a105971da',
    '49e2f447-aa9d-49d1-8486-f3f7bcbcfb74',
    '249507c0-d583-4500-b92f-8a705613d541',
    '27e87a6d-bb5b-4128-9f88-546d6bf5bcdb',
    'dce74a56-fb01-4f79-b6ae-808b25d043bd',
    'b751d992-b77b-4928-bbce-2656cb4e55f7',
    'bcc0de6d-2a85-45f7-b74e-c2eb272b4e1e',
    '4d0a8f10-da29-4bfb-9be5-12bef4b0fd9b',
    'ddc46e6a-cc04-4754-a197-caba0eb97f72',
    '69872304-1210-415f-8131-f3904e3fbeb4',
    '45e7fd3a-bd58-48ef-bd1c-fc0273470315',
    '5b676369-ad13-4fa3-ba1a-332c38c332d7',
    '8ec51425-742f-4c46-8a18-cd32fe5905ee',
    '2fbb8b91-35d8-4afd-8658-3c297bb282b3',
    'ff94cf1c-2aa3-4ad4-8b17-5c58e8fc9831'
  ]::uuid[];
  c_vins constant text[] := ARRAY[
    'JN1BV7AR6FM406806',
    'YV4A22PK3J1375505',
    '1HGCV1F50KA083807',
    '1FMCU0G68MUA61022',
    '3N1AB8BV3MY259117',
    'NMTKHMBXXMR129285',
    '3PCAJ5FB1PF122711',
    '3PCAJ5KR0PF114912',
    '5N1DL1FS5PC369237',
    '5N1DL1FS8PC368244',
    'JN8AZ3DB7S9403242',
    '5NMP54G13TH144040',
    'KMHL64JAXTA547670',
    '5N1AL1FS9TC358190',
    '5N1AL1FWXTC358105',
    'JN8AZ3AE1T9720885',
    '5N1AL1F82VC330223',
    '5N1AL1F83VC338928',
    '5N1AL1F89VC339940',
    '5N1AL1F93VC340011',
    '5N1AL1F96VC338415',
    '5N1AL1HZ1VC346273',
    '5N1AC0EX0VC609186',
    '5N1AC0EX5VC609278',
    '5N1AC0EX7VC609251',
    '5N1AC0FX1VC609809',
    '5N1AC0FX4VC605169',
    '5N1AC0FX5VC605679',
    '5N1AC0FX5VC605746',
    '5N1AC0FX5VC605844',
    '5N1AC0FX5VC606038',
    '5N1AC0FX6VC605481',
    '5N1AC0FX8VC608687',
    '5N1AC0FX9VC607600',
    '5N1AC0JX1VC606660',
    '5N1AC0JXXVC605801',
    'JN8AZ3DB9V9450387'
  ];
  c_allow_sftp constant text[] := '{}'::text[];
  c_reason constant text := 'Retire legacy MarketCheck website-scrape listings replaced by the Files.com/vAuto SFTP feeds';
  c_approval constant text := '<KEN_FINAL_EXECUTION_APPROVAL_TEXT>';
  c_passport_release_verified constant boolean := false;
  v_msg text;
  v_n integer := 37;
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


  -- Gate 3 (batch A): none of the 37 VINs is in any store's SFTP inventory,
  -- under any presence. A car that reappeared in a feed stops the run.
  SELECT string_agg(DISTINCT upper(si.vin), ', ') INTO v_msg FROM store_inventory si WHERE upper(si.vin) = ANY (c_vins);
  IF v_msg IS NOT NULL THEN RAISE EXCEPTION 'gate 3: in an SFTP feed now: %', v_msg; END IF;

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
--   IF (v->>'restored')::int + jsonb_array_length(v->'skipped') <> 37 THEN RAISE EXCEPTION 'restore count mismatch %', v; END IF;
--   RAISE NOTICE 'restore %', v;
-- END $r$;
