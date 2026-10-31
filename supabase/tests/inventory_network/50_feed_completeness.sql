-- Stage 2 checks (2026-10-31) on the state left by 10-40: replay, a file that
-- is a subset of the store's stock, price promotion and store ownership. Every
-- vAuto file is treated as a complete snapshot; there is no delta mode, so a
-- partial file must never archive vehicles on its own.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', COALESCE(p::text, ''), false) $$;
CREATE OR REPLACE FUNCTION pg_temp.store(p_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM dealer_stores WHERE display_name = p_name $$;
CREATE OR REPLACE FUNCTION pg_temp.stage(p_store uuid, p_dealer text, p_mtime timestamptz, p_sha text, p_clean boolean, p_vins text[], p_prices numeric[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_map uuid; v_group uuid; i int;
BEGIN
  SELECT id, group_id INTO v_map, v_group FROM inventory_source_mappings WHERE source_dealer_id = p_dealer AND status IN ('approved','revoked') ORDER BY created_at DESC LIMIT 1;
  INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, mapping_id, source_mtime, content_sha256, clean, valid_count, row_count)
  VALUES ('prod/inventory/vauto/inbound/T_inventory.csv', p_dealer, p_store, v_group, v_map, p_mtime, p_sha, p_clean, COALESCE(array_length(p_vins, 1), 0), COALESCE(array_length(p_vins, 1), 0))
  RETURNING id INTO v_id;
  FOR i IN 1 .. COALESCE(array_length(p_vins, 1), 0) LOOP
    INSERT INTO inventory_snapshot_vehicles (snapshot_id, vin, row_number, condition, year, make, model, feed_price, feed_price_status, photos)
    VALUES (v_id, p_vins[i], i + 1, 'used', 2025, 'Nissan', 'Rogue',
      CASE WHEN p_prices IS NULL THEN 30000 + i ELSE p_prices[i] END, 'known', '["https://img.example/1.jpg"]'::jsonb);
  END LOOP;
  RETURN v_id;
END $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT inv_admin_set_controls(false, false, false, 'stage 2 checks');
CREATE TEMP TABLE before_apply AS SELECT vin, presence FROM store_inventory WHERE store_id = pg_temp.store('Harte Nissan');
CREATE TEMP TABLE snap (k text PRIMARY KEY, v uuid);

-- Replay: the same file version staged twice applies once.
INSERT INTO snap VALUES ('R1', pg_temp.stage(pg_temp.store('Harte Nissan'), 'MP15397', '2026-12-01 00:00:00+00', 'shaR1', true,
  ARRAY['1N4AZ1CP0LC000001','1N4AZ1CP0LC000003','1N4BL4BV0RN000099'], ARRAY[99999, 30003, 24000]::numeric[]));
SELECT pg_temp.expect((inventory_apply_store_snapshot((SELECT v FROM snap WHERE k='R1'))->>'applied')::boolean, 'first copy of a file version applies');
INSERT INTO snap VALUES ('R2', pg_temp.stage(pg_temp.store('Harte Nissan'), 'MP15397', '2026-12-01 00:00:00+00', 'shaR1', true,
  ARRAY['1N4AZ1CP0LC000001','1N4AZ1CP0LC000003','1N4BL4BV0RN000099'], ARRAY[99999, 30003, 24000]::numeric[]));
SELECT pg_temp.expect(inventory_apply_store_snapshot((SELECT v FROM snap WHERE k='R2'))->>'reason' = 'same_version_already_applied', 'a replayed file version changes nothing');

-- Price promotion stays off: the feed price is recorded on the store record,
-- the working listing keeps the dealer's price.
SELECT pg_temp.expect((SELECT feed_price = 99999 FROM store_inventory WHERE vin = '1N4AZ1CP0LC000001' AND store_id = pg_temp.store('Harte Nissan')), 'feed price is recorded as feed evidence');
SELECT pg_temp.expect((SELECT price <> 99999 FROM vehicle_listings WHERE vin = '1N4AZ1CP0LC000001'), 'feed price is not promoted to the listing while price updates are off');
SELECT pg_temp.expect((SELECT NOT feed_price_updates_listing AND NOT retirement_automation_enabled FROM dealer_stores WHERE id = pg_temp.store('Harte Nissan')), 'price promotion and retirement automation default off');

-- A clean file holding a fraction of the stock (what a delta or a truncated
-- export looks like) counts absences but never archives with automation off.
INSERT INTO snap VALUES ('P1', pg_temp.stage(pg_temp.store('Harte Nissan'), 'MP15397', '2026-12-02 00:00:00+00', 'shaP1', true, ARRAY['1N4AZ1CP0LC000001']));
SELECT inventory_apply_store_snapshot((SELECT v FROM snap WHERE k='P1'));
INSERT INTO snap VALUES ('P2', pg_temp.stage(pg_temp.store('Harte Nissan'), 'MP15397', '2026-12-03 00:00:00+00', 'shaP2', true, ARRAY['1N4AZ1CP0LC000001']));
SELECT inventory_apply_store_snapshot((SELECT v FROM snap WHERE k='P2'));
INSERT INTO snap VALUES ('P3', pg_temp.stage(pg_temp.store('Harte Nissan'), 'MP15397', '2026-12-04 00:00:00+00', 'shaP3', true, ARRAY['1N4AZ1CP0LC000001']));
SELECT inventory_apply_store_snapshot((SELECT v FROM snap WHERE k='P3'));
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id = pg_temp.store('Harte Nissan') AND presence = 'retired') = 0, 'repeated partial files retire nothing while automation is off');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id = pg_temp.store('Harte Nissan') AND presence = 'retirement_review') >= 1, 'absent vehicles wait for a person in retirement review');
SELECT pg_temp.expect((SELECT status FROM vehicle_listings WHERE vin = '1N4AZ1CP0LC000003') <> 'archived', 'no listing is archived by an absence');

-- A dirty (rows dropped) file never counts absences at all.
CREATE TEMP TABLE review_before AS SELECT vin, missing_snapshots FROM store_inventory WHERE store_id = pg_temp.store('Harte Nissan');
INSERT INTO snap VALUES ('D1', pg_temp.stage(pg_temp.store('Harte Nissan'), 'MP15397', '2026-12-05 00:00:00+00', 'shaD1', false, ARRAY['1N4AZ1CP0LC000001']));
SELECT inventory_apply_store_snapshot((SELECT v FROM snap WHERE k='D1'));
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM store_inventory si JOIN review_before b USING (vin) WHERE si.store_id = pg_temp.store('Harte Nissan') AND si.missing_snapshots <> b.missing_snapshots), 'an unclean file leaves absence counts unchanged');

-- Ownership: a partition staged against a store its mapping does not name is refused.
INSERT INTO snap VALUES ('O1', pg_temp.stage(pg_temp.store('Unrelated Motors'), 'MP15397', '2026-12-06 00:00:00+00', 'shaO1', true, ARRAY['1N4AZ1CP0LC000777']));
SELECT pg_temp.expect(NOT (inventory_apply_store_snapshot((SELECT v FROM snap WHERE k='O1'))->>'applied')::boolean, 'a mapping for one store cannot load another store');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM store_inventory WHERE vin = '1N4AZ1CP0LC000777'), 'the refused partition wrote no inventory');

SELECT inv_admin_set_controls(true, false, false, 'stage 2 checks done');
