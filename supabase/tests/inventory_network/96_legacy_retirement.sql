-- Behaviour tests for 20261113000000_legacy_scrape_retirement, on synthetic
-- data only. Runs after the earlier inventory-network tests in the same DB.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
    IF expected IS NOT NULL AND position(expected IN SQLERRM) = 0 THEN RAISE EXCEPTION 'FAILED: % (raised %, expected %)', label, SQLERRM, expected; END IF;
    RAISE NOTICE 'ok  % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAILED: % (did not raise)', label;
END $$;

-- Production columns and tables the bare stubs lack (test-only).
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE TABLE IF NOT EXISTS public.vehicle_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, vin text, deal_status text, customer_name text, sold_at timestamptz);

-- Fixtures: tenant L1 with feed store LS1 and a sister store LS2.
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000c71', 'Legacy Auto Group'), ('00000000-0000-0000-0000-000000000c72', 'Other Group');
INSERT INTO dealer_groups (id, tenant_id, name) VALUES ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000c71', 'Legacy Auto Group');
INSERT INTO dealer_stores (id, group_id, tenant_id, display_name, state, status, subscription_status, inventory_feed_enabled, listing_sync_enabled, feed_price_updates_listing)
VALUES ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000c71', 'Legacy INFINITI', 'CT', 'active', 'subscribed', true, true, false),
       ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000c71', 'Sister INFINITI', 'CT', 'active', 'unsubscribed', true, false, false);

CREATE TEMP TABLE lk (name text PRIMARY KEY, id uuid);
CREATE OR REPLACE FUNCTION pg_temp.lid(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lk WHERE name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.mk(p_name text, p_vin text, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO vehicle_listings (tenant_id, store_id, vin, slug, ymm, condition, price, status, feed_source, source_url, created_by, published_at)
  VALUES (COALESCE((p_extra->>'tenant')::uuid, '00000000-0000-0000-0000-000000000c71'), 'legacy', p_vin, lower(p_name) || '-slug', '2027 INFINITI QX65', 'new',
          COALESCE((p_extra->>'price')::numeric, 50000), COALESCE(p_extra->>'status', 'published'),
          CASE WHEN p_extra ? 'feed_source' THEN p_extra->>'feed_source' ELSE 'marketcheck' END,
          COALESCE(p_extra->>'source_url', 'https://www.harteinfiniti.com/viewdetails/new/' || lower(p_vin)),
          (p_extra->>'created_by')::uuid, now() - interval '30 days')
  RETURNING id INTO v;
  INSERT INTO lk VALUES (p_name, v);
  RETURN v;
END $$;

SELECT pg_temp.mk('gone1', 'LGV00000000000001');
SELECT pg_temp.mk('gone2', 'LGV00000000000002', '{"source_url":"https://www.hartecars.com/viewdetails/new/lgv00000000000002"}');
SELECT pg_temp.mk('sister', 'LGV00000000000003');
SELECT pg_temp.mk('manual', 'LGV00000000000004', '{"feed_source":null,"source_url":null,"created_by":"00000000-0000-0000-0000-00000000aaaa"}');
SELECT pg_temp.mk('signed', 'LGV00000000000005');
SELECT pg_temp.mk('deal', 'LGV00000000000006');
SELECT pg_temp.mk('lead', 'LGV00000000000007');
SELECT pg_temp.mk('othersite', 'LGV00000000000008', '{"source_url":"https://www.someotherdealer.com/v/lgv00000000000008"}');
SELECT pg_temp.mk('othertenant', 'LGV00000000000009', '{"tenant":"00000000-0000-0000-0000-000000000c72"}');

INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, condition, feed_price_status, stock_number, feed_price, presence)
VALUES ('00000000-0000-0000-0000-0000000007c2', '00000000-0000-0000-0000-00000000cc01', 'LGV00000000000003', 'MP2', 'new', 'known', 'IN6936', 59035, 'present');
INSERT INTO addendum_signings (tenant_id, vin, vehicle_listing_id) VALUES ('00000000-0000-0000-0000-000000000c71', 'LGV00000000000005', pg_temp.lid('signed'));
INSERT INTO vehicle_files (tenant_id, vin, deal_status, customer_name) VALUES ('00000000-0000-0000-0000-000000000c71', 'LGV00000000000006', 'sold', 'A Buyer'),
  ('00000000-0000-0000-0000-000000000c71', 'LGV00000000000001', 'stickered', '');
INSERT INTO leads (tenant_id, vehicle_vin, source, status) VALUES ('00000000-0000-0000-0000-000000000c71', 'LGV00000000000007', 'website', 'new');
INSERT INTO factory_sticker_records (tenant_id, vehicle_id, generation_status) VALUES ('00000000-0000-0000-0000-000000000c71', pg_temp.lid('gone1'), 'PUBLISHED');
INSERT INTO description_cases (vehicle_id) VALUES (pg_temp.lid('gone1'));
-- Stand-in for the production archive trigger, so restore is exercised.
CREATE OR REPLACE FUNCTION public.test_sticker_on_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    UPDATE factory_sticker_records SET generation_status = 'ARCHIVED' WHERE vehicle_id = NEW.id;
    UPDATE description_cases SET archived_at = now() WHERE vehicle_id = NEW.id AND archived_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_sticker_on_archive AFTER UPDATE OF status ON vehicle_listings FOR EACH ROW EXECUTE FUNCTION public.test_sticker_on_archive();

CREATE TEMP TABLE si_before AS SELECT * FROM store_inventory;

\ir ../../proposed/20261113000000_legacy_scrape_retirement.sql

-- ── Owner assignment guard (null-owner rows) ────────────────────────────────
SELECT pg_temp.raises($$UPDATE vehicle_listings SET owning_store_id = '00000000-0000-0000-0000-0000000007c1' WHERE id = pg_temp.lid('gone1')$$,
  'owning_store_assignment_requires_feed', 'a client cannot assign a rooftop to a null-owner listing');
SELECT pg_temp.raises($$INSERT INTO vehicle_listings (tenant_id, store_id, vin, slug, status, owning_store_id) VALUES ('00000000-0000-0000-0000-000000000c71', 'x', 'LGV00000000000099', 'ins-slug', 'draft', '00000000-0000-0000-0000-0000000007c1')$$,
  'owning_store_assignment_requires_feed', 'a client cannot insert a listing with a rooftop owner');
DO $$ BEGIN
  PERFORM set_config('app.inventory_writer', 'filescom_apply', true);
  UPDATE vehicle_listings SET owning_store_id = '00000000-0000-0000-0000-0000000007c1' WHERE id = pg_temp.lid('othertenant');
  UPDATE vehicle_listings SET owning_store_id = NULL WHERE id = pg_temp.lid('othertenant');
  PERFORM set_config('app.inventory_writer', '', true);
END $$;
SELECT pg_temp.expect(true, 'the dealer feed apply can still assign and clear ownership');
UPDATE vehicle_listings SET price = 50001 WHERE id = pg_temp.lid('gone2');
UPDATE vehicle_listings SET price = 50000 WHERE id = pg_temp.lid('gone2');
SELECT pg_temp.expect(true, 'ordinary edits to a null-owner listing still work');

-- ── Eligibility and dry run ─────────────────────────────────────────────────
CREATE TEMP TABLE dry AS SELECT legacy_listing_retire('00000000-0000-0000-0000-000000000c71',
  ARRAY(SELECT id FROM lk WHERE name <> 'othertenant' ORDER BY name),
  ARRAY(SELECT upper(vin) FROM vehicle_listings WHERE id IN (SELECT id FROM lk WHERE name <> 'othertenant')),
  ARRAY['harteinfiniti.com', 'hartecars.com'], '{}', 'Retire legacy MarketCheck website scrape', NULL, true) AS r;
CREATE OR REPLACE FUNCTION pg_temp.blocks(n text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT x->'blocks' FROM dry, jsonb_array_elements(r->'rows') x WHERE (x->>'listing_id')::uuid = pg_temp.lid(n) $$;
SELECT pg_temp.expect((SELECT (r->>'dry_run')::boolean AND (r->>'eligible')::int = 2 AND (r->>'blocked')::int = 6 FROM dry), 'dry run: 2 eligible, 6 blocked');
SELECT pg_temp.expect(pg_temp.blocks('gone1') = '[]' AND pg_temp.blocks('gone2') = '[]', 'scraped listings with no feed match and no customer activity are eligible');
SELECT pg_temp.expect(pg_temp.blocks('sister') ? 'in_current_sftp_feed', 'a VIN in a current SFTP feed is held unless explicitly allowed');
SELECT pg_temp.expect(pg_temp.blocks('manual') ? 'not_marketcheck_scrape' AND pg_temp.blocks('manual') ? 'created_by_user', 'a user-created listing is never classed as scraped');
SELECT pg_temp.expect(pg_temp.blocks('signed') ? 'customer_signing', 'a customer signing blocks retirement');
SELECT pg_temp.expect(pg_temp.blocks('deal') ? 'active_deal', 'a sold or customer deal blocks retirement');
SELECT pg_temp.expect(pg_temp.blocks('lead') ? 'open_lead', 'an open lead blocks retirement');
SELECT pg_temp.expect(pg_temp.blocks('othersite') ? 'source_not_scraped_site', 'a listing from another site is not classed as the retired scrape');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_listings WHERE id IN (SELECT id FROM lk) AND status = 'published') = 9
  AND (SELECT count(*) FROM legacy_listing_retirements) = 0, 'dry run changes nothing');

-- ── Fail-closed execution ───────────────────────────────────────────────────
SELECT pg_temp.raises($$SELECT legacy_listing_retire('00000000-0000-0000-0000-000000000c71', ARRAY[pg_temp.lid('gone1'), pg_temp.lid('lead')],
  ARRAY['LGV00000000000001','LGV00000000000007'], ARRAY['harteinfiniti.com'], '{}', 'Retire legacy MarketCheck website scrape', 'Ken approved list v1', false)$$,
  'legacy_retire_blocked', 'one blocked listing aborts the whole batch');
SELECT pg_temp.raises($$SELECT legacy_listing_retire('00000000-0000-0000-0000-000000000c71', ARRAY[pg_temp.lid('gone1')],
  ARRAY['LGV00000000000002'], ARRAY['harteinfiniti.com'], '{}', 'Retire legacy MarketCheck website scrape', 'Ken approved list v1', false)$$,
  'legacy_retire_vin_list_mismatch', 'ids must resolve to exactly the approved VINs');
SELECT pg_temp.raises($$SELECT legacy_listing_retire('00000000-0000-0000-0000-000000000c71', ARRAY[pg_temp.lid('gone1')],
  ARRAY['LGV00000000000001'], ARRAY['harteinfiniti.com'], '{}', 'Retire legacy MarketCheck website scrape', NULL, false)$$,
  'legacy_retire_approval_required', 'a real run needs the approval text');
SELECT pg_temp.raises($$SELECT legacy_listing_retire('00000000-0000-0000-0000-000000000c71', ARRAY[pg_temp.lid('othertenant')],
  ARRAY['LGV00000000000009'], ARRAY['harteinfiniti.com'], '{}', 'Retire legacy MarketCheck website scrape', 'Ken approved list v1', false)$$,
  'legacy_retire_blocked', 'a listing in another tenant cannot be retired under this tenant');
SELECT pg_temp.expect((SELECT count(*) FROM legacy_listing_retirements) = 0 AND (SELECT count(*) FROM vehicle_listings WHERE id IN (SELECT id FROM lk) AND status = 'published') = 9,
  'failed runs changed nothing');

-- ── Approved run: two clean listings plus one explicitly allowed SFTP match ─
CREATE TEMP TABLE run AS SELECT legacy_listing_retire('00000000-0000-0000-0000-000000000c71',
  ARRAY[pg_temp.lid('gone1'), pg_temp.lid('gone2'), pg_temp.lid('sister')],
  ARRAY['LGV00000000000001', 'LGV00000000000002', 'LGV00000000000003'], ARRAY['harteinfiniti.com', 'hartecars.com'],
  ARRAY['LGV00000000000003'], 'Retire legacy MarketCheck website scrape', 'Ken approved list v1 (test)', false) AS r;
SELECT pg_temp.expect((SELECT (r->>'retired')::int = 3 FROM run), 'three listings retired');
SELECT pg_temp.expect((SELECT bool_and(status = 'archived' AND archive_reason = 'legacy_scrape_retired' AND archived_at IS NOT NULL AND owning_store_id IS NULL)
  FROM vehicle_listings WHERE id IN (pg_temp.lid('gone1'), pg_temp.lid('gone2'), pg_temp.lid('sister'))), 'retired rows are archived with the legacy reason and no owner');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_listings WHERE id IN (SELECT id FROM lk) AND status = 'published') = 6, 'the six held listings stay published');
SELECT pg_temp.expect((SELECT count(*) = 3 AND bool_and(prior_row->>'status' = 'published') FROM legacy_listing_retirements), 'audit holds the prior row for each');
SELECT pg_temp.expect((SELECT sftp_matches->0->>'store_id' = '00000000-0000-0000-0000-0000000007c2' FROM legacy_listing_retirements WHERE vin = 'LGV00000000000003'), 'audit records the SFTP match');
SELECT pg_temp.expect((SELECT generation_status = 'ARCHIVED' FROM factory_sticker_records WHERE vehicle_id = pg_temp.lid('gone1')), 'archive side effects ran (sticker archived)');
SELECT pg_temp.expect((SELECT count(*) = (SELECT count(*) FROM si_before) FROM store_inventory s JOIN si_before b USING (id)
  WHERE to_jsonb(s) = to_jsonb(b)), 'store_inventory rows are byte-identical');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_files WHERE vin = 'LGV00000000000001') = 1, 'vehicle_files (VIN history) untouched');

-- ── Retired rows stay retired ───────────────────────────────────────────────
SELECT pg_temp.raises($$UPDATE vehicle_listings SET status = 'published' WHERE id = pg_temp.lid('gone1')$$, 'legacy_listing_retired', 'cannot be republished directly');
SELECT pg_temp.raises($$UPDATE vehicle_listings SET price = 1 WHERE id = pg_temp.lid('gone1')$$, 'legacy_listing_retired', 'cannot be repriced (scraper patch)');
SELECT pg_temp.raises($$DELETE FROM vehicle_listings WHERE id = pg_temp.lid('gone1')$$, 'legacy_listing_retired', 'cannot be hard-deleted');
UPDATE vehicle_listings SET hero_image_url = 'https://img.example/x.jpg' WHERE id = pg_temp.lid('gone1');
SELECT pg_temp.expect(true, 'harmless enrichment writes still succeed');
SELECT pg_temp.raises($$UPDATE legacy_listing_retirements SET reason = 'tampered with reason' WHERE vin = 'LGV00000000000001'$$, 'legacy_listing_retirements_append_only', 'audit is append-only');
-- The MarketCheck revive path only matches left_feed.
UPDATE vehicle_listings SET status = 'published', archived_at = NULL, archive_reason = NULL
 WHERE upper(vin) = 'LGV00000000000002' AND status = 'archived' AND archive_reason = 'left_feed';
SELECT pg_temp.expect((SELECT status = 'archived' FROM vehicle_listings WHERE id = pg_temp.lid('gone2')), 'revive (left_feed only) does not resurrect a retired listing');

-- ── Restore (rollback) ──────────────────────────────────────────────────────
SELECT pg_temp.raises($$SELECT legacy_listing_restore((SELECT (r->>'batch_id')::uuid FROM run), '')$$, 'legacy_restore_approval_required', 'restore needs approval text');
CREATE TEMP TABLE rs AS SELECT legacy_listing_restore((SELECT (r->>'batch_id')::uuid FROM run), 'Ken approved rollback (test)') AS r;
SELECT pg_temp.expect((SELECT (r->>'restored')::int = 3 FROM rs), 'restore brings back all three');
SELECT pg_temp.expect((SELECT bool_and(status = 'published' AND archived_at IS NULL AND archive_reason IS NULL)
  FROM vehicle_listings WHERE id IN (pg_temp.lid('gone1'), pg_temp.lid('gone2'), pg_temp.lid('sister'))), 'restored rows are published again');
SELECT pg_temp.expect((SELECT generation_status = 'PUBLISHED' FROM factory_sticker_records WHERE vehicle_id = pg_temp.lid('gone1'))
  AND (SELECT archived_at IS NULL FROM description_cases WHERE vehicle_id = pg_temp.lid('gone1')), 'sticker state and description case restored');
SELECT pg_temp.expect((SELECT count(*) = 3 AND bool_and(restored_at IS NOT NULL) FROM legacy_listing_retirements), 'audit stamped restored');
SELECT pg_temp.expect((SELECT (r->>'restored')::int = 0 FROM (SELECT legacy_listing_restore((SELECT (r->>'batch_id')::uuid FROM run), 'Ken approved rollback (again)') AS r) x), 'restore is idempotent');
SELECT pg_temp.expect((SELECT count(*) = (SELECT count(*) FROM si_before) FROM store_inventory s JOIN si_before b USING (id) WHERE to_jsonb(s) = to_jsonb(b)), 'store_inventory still identical after restore');

-- ── Not reachable from the client roles ─────────────────────────────────────
SELECT pg_temp.expect(NOT has_function_privilege('authenticated', 'public.legacy_listing_retire(uuid, uuid[], text[], text[], text[], text, text, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.legacy_listing_restore(uuid, text)', 'EXECUTE'), 'retire/restore are not callable by anon or authenticated');
