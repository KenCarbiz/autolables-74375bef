-- Behaviour tests for 0006_multistore_inventory_network. Run by
-- scripts/test-inventory-network-sql.sh against a scratch database. Any failed
-- expectation raises and stops the run.
\set ON_ERROR_STOP 1

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;

CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ok  % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAILED: % (did not raise)', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', COALESCE(p::text, ''), false) $$;

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
    VALUES (v_id, p_vins[i], i + 1, CASE WHEN i % 2 = 0 THEN 'used' ELSE 'new' END, 2025, 'Nissan', 'Rogue',
      CASE WHEN p_prices IS NULL THEN 30000 + i ELSE p_prices[i] END,
      CASE WHEN p_prices IS NOT NULL AND p_prices[i] IS NULL THEN 'unknown' ELSE 'known' END,
      '["https://img.example/1.jpg"]'::jsonb);
  END LOOP;
  RETURN v_id;
END $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Harte Auto Group'), ('00000000-0000-0000-0000-0000000000b1', 'Other Group');
INSERT INTO dealer_groups (id, tenant_id, name) VALUES ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'Harte Auto Group'),
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b1', 'Other Group');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-00000000ad01', 'admin');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa99', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000bb99', 'owner');
INSERT INTO vehicle_listings (id, store_id, tenant_id, vin, slug, status, ymm, assigned_agent_id, feed_source, price)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '1N4BL4BV0RN000001', 'origin-slug', 'published', '2024 Nissan Altima', 'agent-ana', 'marketcheck', 25000),
       ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '1N4BL4BV0RN000099', 'legacy-slug', 'published', '2024 Nissan Altima', NULL, 'marketcheck', 24000);

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.raises($$SELECT inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Sneaky"}')$$, 'store admin cannot create stores');

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
INSERT INTO ids VALUES ('A', inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Harte Nissan","street":"150 Weston St","city":"Hartford","state":"CT","zip":"06120","subscription_status":"subscribed"}'));
INSERT INTO ids VALUES ('B', inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Harte Hyundai of Old Saybrook","city":"Old Saybrook","state":"CT","zip":"06475"}'));
INSERT INTO ids VALUES ('C', inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000bb01","display_name":"Unrelated Motors","state":"NY"}'));
SELECT pg_temp.expect((SELECT tenant_id FROM dealer_stores WHERE id = (SELECT v FROM ids WHERE k = 'B')) = '00000000-0000-0000-0000-0000000000a1', 'store tenant derived from its group');
SELECT pg_temp.raises($$SELECT inv_admin_save_store(jsonb_build_object('id', (SELECT v FROM ids WHERE k='B'), 'customer_browser_enabled', true))$$, 'unsubscribed store cannot enable the paid browser');
SELECT inv_admin_save_store(jsonb_build_object('id', (SELECT v FROM ids WHERE k='A'), 'is_primary_inventory_store', true, 'inventory_feed_enabled', true, 'customer_browser_enabled', true, 'inventory_sharing_enabled', true, 'missing_snapshot_threshold', 2));
SELECT inv_admin_save_store(jsonb_build_object('id', (SELECT v FROM ids WHERE k='B'), 'inventory_feed_enabled', true));
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE entity = 'dealer_stores') >= 5, 'store changes are audited');

-- ── Mapping ────────────────────────────────────────────────────────────────
INSERT INTO ids VALUES ('MA', inv_admin_propose_mapping('MP15397', (SELECT v FROM ids WHERE k='A'), '{"dealerName":"Harte Nissan"}', '{"verdict":"match"}'));
INSERT INTO ids VALUES ('MB', inv_admin_propose_mapping('MP25214', (SELECT v FROM ids WHERE k='B'), '{"dealerName":"Harte Hyundai"}', '{"verdict":"incomplete"}'));
SELECT pg_temp.raises($$SELECT inv_admin_propose_mapping('MP25214', (SELECT v FROM ids WHERE k='A'), '{}', '{}')$$, 'one live mapping per source dealer id');
SELECT pg_temp.raises($$SELECT inv_admin_decide_mapping((SELECT v FROM ids WHERE k='MB'), 'approve', false)$$, 'unconfirmed identity needs acknowledgement');
SELECT inv_admin_decide_mapping((SELECT v FROM ids WHERE k='MA'), 'approve');
SELECT inv_admin_decide_mapping((SELECT v FROM ids WHERE k='MB'), 'approve', true);
SELECT pg_temp.raises($$UPDATE inventory_source_mappings SET store_id = (SELECT v FROM ids WHERE k='B') WHERE id = (SELECT v FROM ids WHERE k='MA')$$, 'mapping cannot be silently re-pointed');

-- ── Webhook -> queue ───────────────────────────────────────────────────────
INSERT INTO inventory_feed_bindings (path, tenant_id, status, proposed_at) VALUES ('prod/inventory/vauto/inbound/T_inventory.csv', '00000000-0000-0000-0000-0000000000a1', 'approved', now());
SELECT pg_temp.expect((filescom_record_event(repeat('a', 64), 'update', 'prod/inventory/vauto/inbound/T_inventory.csv', NULL, now(), 10)->'job'->>'enqueued')::boolean, 'approved feed event enqueues an import');
SELECT pg_temp.expect((filescom_record_event(repeat('a', 64), 'update', 'prod/inventory/vauto/inbound/T_inventory.csv', NULL, now(), 10)->>'duplicate')::boolean, 'duplicate delivery is recognised');
SELECT pg_temp.expect(filescom_record_event(repeat('b', 64), 'update', 'prod/inventory/vauto/inbound/T_inventory.csv', NULL, now(), 11)->'job'->>'reason' = 'coalesced', 'second event coalesces onto the open job');
SELECT pg_temp.expect(filescom_record_event(repeat('c', 64), 'create', 'prod/inventory/vauto/inbound/Q_inventory.csv', NULL, now(), 11)->'job' = 'null'::jsonb, 'unmapped file is quarantined and not queued');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_feed_jobs) = 1, 'exactly one job exists');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_feed_claim_jobs(5, 600)) = 0, 'paused ingestion claims nothing');
SELECT inv_admin_set_controls(false, false, false, 'enable for test');
CREATE TEMP TABLE claimed AS SELECT * FROM inventory_feed_claim_jobs(5, 600);
SELECT pg_temp.expect((SELECT count(*) FROM claimed) = 1, 'unpaused ingestion claims the job');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_feed_claim_jobs(5, 600)) = 0, 'a running job is not claimed twice');
SELECT pg_temp.expect((inventory_feed_claim_version('prod/inventory/vauto/inbound/T_inventory.csv', '10|t|x', 10, now(), 'x', (SELECT id FROM claimed))->>'claimed')::boolean, 'first version claim succeeds');
SELECT pg_temp.expect(NOT (inventory_feed_claim_version('prod/inventory/vauto/inbound/T_inventory.csv', '10|t|x', 10, now(), 'x', gen_random_uuid())->>'claimed')::boolean, 'same version cannot be processed concurrently');
SELECT pg_temp.expect(inventory_feed_finish_job((SELECT id FROM claimed), (SELECT lock_token FROM claimed), 'failed', 'download_failed', true) = 'queued', 'retryable failure re-queues with backoff');
SELECT pg_temp.expect((SELECT next_attempt_at > now() FROM inventory_feed_jobs WHERE id = (SELECT id FROM claimed)), 'backoff pushes the next attempt out');
UPDATE inventory_feed_jobs SET attempts = max_attempts, status = 'running', lock_token = '00000000-0000-0000-0000-000000000123' WHERE id = (SELECT id FROM claimed);
SELECT pg_temp.expect(inventory_feed_finish_job((SELECT id FROM claimed), '00000000-0000-0000-0000-000000000123', 'failed', 'download_failed', true) = 'dead', 'retries are bounded');
SELECT pg_temp.expect((inv_admin_retry_job((SELECT id FROM claimed))->>'enqueued')::boolean, 'dead job can be retried by an admin');

SELECT pg_temp.expect((SELECT count(*) FROM inventory_feed_claim_job((SELECT id FROM inventory_feed_jobs WHERE status = 'queued' LIMIT 1))) = 1, 'Import now claims its specific job');
UPDATE inventory_feed_jobs SET status = 'queued', lock_token = NULL WHERE status = 'running';
SELECT inv_admin_set_controls(false, true, false, 'test emergency stop');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_feed_jobs WHERE status = 'queued') = 0, 'emergency stop cancels queued work');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_feed_claim_jobs(5, 600)) = 0, 'emergency stop claims nothing');
SELECT pg_temp.raises($$SELECT inv_admin_set_controls(false, false, false, '')$$, 'control changes need a reason');
SELECT inv_admin_set_controls(false, false, false, 'resume after test');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE entity = 'inventory_feed_controls') >= 3, 'control changes are audited');

-- ── Snapshots ──────────────────────────────────────────────────────────────
INSERT INTO ids VALUES ('S1', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-30 21:00:00+00', 'sha1', true,
  ARRAY['1N4AZ1CP0LC000001','1N4AZ1CP0LC000002','1N4AZ1CP0LC000003'], ARRAY[31000, NULL, 0]::numeric[]));
UPDATE inventory_snapshot_vehicles SET feed_price = NULL, feed_price_status = 'zero' WHERE snapshot_id = (SELECT v FROM ids WHERE k='S1') AND vin = '1N4AZ1CP0LC000003';
SELECT pg_temp.expect((inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='S1'))->>'added')::int = 3, 'first snapshot adds three vehicles');
SELECT pg_temp.expect((SELECT feed_price IS NULL AND feed_price_status = 'unknown' FROM store_inventory WHERE vin = '1N4AZ1CP0LC000002'), 'blank price stays unknown, never $0');
SELECT pg_temp.expect((SELECT feed_price IS NULL AND feed_price_status = 'zero' FROM store_inventory WHERE vin = '1N4AZ1CP0LC000003'), 'literal zero price is recorded but not priced');
SELECT pg_temp.expect((inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='S1'))->>'reason') = 'snapshot_not_staged', 'a snapshot applies once');

INSERT INTO ids VALUES ('S0', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-29 21:00:00+00', 'sha0', true, ARRAY['1N4AZ1CP0LC000001']));
SELECT pg_temp.expect(inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='S0'))->>'reason' = 'older_than_applied_snapshot', 'older snapshot cannot overwrite newer inventory');
SELECT pg_temp.expect((SELECT presence FROM store_inventory WHERE vin = '1N4AZ1CP0LC000002') = 'present', 'older snapshot changed nothing');

INSERT INTO ids VALUES ('SE', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-31 01:00:00+00', 'shaE', true, ARRAY[]::text[]));
SELECT pg_temp.expect(inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='SE'))->>'reason' = 'empty_snapshot', 'empty snapshot is rejected');
INSERT INTO ids VALUES ('SI', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-31 01:30:00+00', 'shaI', true, ARRAY['1N4AZ1CP0LC000001']));
UPDATE inventory_store_snapshots SET valid_count = 2 WHERE id = (SELECT v FROM ids WHERE k='SI');
SELECT pg_temp.expect(inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='SI'))->>'reason' = 'staging_incomplete', 'incomplete staging is rejected');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE presence = 'present') = 3, 'rejected snapshots retire nothing');

INSERT INTO ids VALUES ('SD', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-31 02:00:00+00', 'shaD', false, ARRAY['1N4AZ1CP0LC000001','1N4AZ1CP0LC000003']));
SELECT inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='SD'));
SELECT pg_temp.expect((SELECT presence = 'present' AND missing_snapshots = 0 FROM store_inventory WHERE vin = '1N4AZ1CP0LC000002'), 'a snapshot that dropped rows does not count absences');

INSERT INTO ids VALUES ('S2', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-31 03:00:00+00', 'sha2', true, ARRAY['1N4AZ1CP0LC000001','1N4AZ1CP0LC000003']));
SELECT inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='S2'));
SELECT pg_temp.expect((SELECT presence = 'missing' AND missing_snapshots = 1 FROM store_inventory WHERE vin = '1N4AZ1CP0LC000002'), 'clean snapshot marks an absent vehicle missing');
INSERT INTO ids VALUES ('S3', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-31 04:00:00+00', 'sha3', true, ARRAY['1N4AZ1CP0LC000001','1N4AZ1CP0LC000003']));
SELECT inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='S3'));
SELECT pg_temp.expect((SELECT presence = 'retirement_review' FROM store_inventory WHERE vin = '1N4AZ1CP0LC000002'), 'threshold reached goes to review while automation is off');
SELECT inv_admin_review_retirement((SELECT id FROM store_inventory WHERE vin = '1N4AZ1CP0LC000002'), 'keep');
SELECT pg_temp.expect((SELECT presence = 'missing' AND missing_snapshots = 0 FROM store_inventory WHERE vin = '1N4AZ1CP0LC000002'), 'reviewer can keep a vehicle');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE presence = 'retired') = 0, 'nothing retired without automation or review');

-- Store B: separate partition, its own VIN plus one VIN that A already owns.
INSERT INTO ids VALUES ('SB', pg_temp.stage((SELECT v FROM ids WHERE k='B'), 'MP25214', '2026-10-31 03:00:00+00', 'shaB', true, ARRAY['KM8J3CA46RU000001','1N4AZ1CP0LC000001']));
SELECT pg_temp.expect((inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='SB'))->>'conflicts')::int = 1, 'same VIN at a sibling store is held as a conflict');
SELECT pg_temp.expect((SELECT store_id FROM store_inventory WHERE vin = '1N4AZ1CP0LC000001' AND presence = 'present') = (SELECT v FROM ids WHERE k='A'), 'VIN alone does not move a vehicle between stores');
SELECT pg_temp.expect((SELECT presence FROM store_inventory WHERE vin = '1N4AZ1CP0LC000003') = 'present', 'another store''s snapshot never marks A''s cars missing');

SELECT inv_admin_decide_mapping((SELECT v FROM ids WHERE k='MB'), 'revoke');
INSERT INTO ids VALUES ('SR', pg_temp.stage((SELECT v FROM ids WHERE k='B'), 'MP25214', '2026-10-31 05:00:00+00', 'shaR', true, ARRAY['KM8J3CA46RU000001']));
SELECT pg_temp.expect(inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='SR'))->>'reason' = 'mapping_not_approved', 'revoked mapping quarantines the partition');
SELECT pg_temp.expect((SELECT store_id FROM store_inventory WHERE vin = 'KM8J3CA46RU000001') = (SELECT v FROM ids WHERE k='B'), 'revoking a mapping does not move vehicles');

-- ── Sharing and the customer service ───────────────────────────────────────
SELECT pg_temp.raises($$SELECT inv_admin_save_sharing_rule(jsonb_build_object('source_store_id', (SELECT v FROM ids WHERE k='C'), 'destination_store_id', (SELECT v FROM ids WHERE k='A'), 'connect_card', true))$$, 'no sharing across unrelated groups');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.expect((SELECT count(*) FROM jsonb_array_elements(customer_group_inventory('origin-slug', 'connect_card')->'vehicles') x WHERE x->>'inventory_group' = 'additional') = 0, 'sharing is off by default');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
INSERT INTO ids VALUES ('R', inv_admin_save_sharing_rule(jsonb_build_object('source_store_id', (SELECT v FROM ids WHERE k='B'), 'destination_store_id', (SELECT v FROM ids WHERE k='A'), 'connect_card', true, 'priority', 10)));
SELECT pg_temp.as_user(NULL);
CREATE TEMP TABLE browse AS SELECT customer_group_inventory('origin-slug', 'connect_card') AS r;
SELECT pg_temp.expect((SELECT (r->>'enabled')::boolean FROM browse), 'browser enabled for the subscribed home store');
SELECT pg_temp.expect((SELECT r->'vehicles'->0->>'inventory_group' FROM browse) = 'home', 'home-store inventory ranks first');
SELECT pg_temp.expect((SELECT r->'vehicles'->-1->>'inventory_group' FROM browse) = 'additional', 'sibling inventory follows as additional');
SELECT pg_temp.expect((SELECT r->'vehicles'->-1->'owning_store'->>'city' FROM browse) = 'Old Saybrook', 'additional vehicle is labelled with its real location');
SELECT pg_temp.expect((SELECT r->'vehicles'->-1->>'price' FROM browse) IS NULL AND (SELECT r->'vehicles'->-1->>'price_status' FROM browse) = 'hidden', 'sibling price hidden unless the rule allows it');
SELECT pg_temp.expect((SELECT count(*) FROM jsonb_array_elements((customer_group_inventory('origin-slug', 'connect_card', '{"scope":"home"}'))->'vehicles') x WHERE x->>'inventory_group' = 'additional') = 0, 'home filter excludes additional inventory');
SELECT pg_temp.expect((SELECT count(*) FROM jsonb_array_elements(customer_group_inventory('origin-slug', 'customer_room')->'vehicles') x WHERE x->>'inventory_group' = 'additional') = 0, 'channel flags are separate (room not enabled)');
SELECT pg_temp.expect(customer_group_inventory_vehicle('origin-slug', 'customer_room', (SELECT id FROM store_inventory WHERE vin = 'KM8J3CA46RU000001')) IS NULL, 'unauthorised sibling vehicle is inaccessible by id');
SELECT pg_temp.expect(customer_group_inventory_vehicle('origin-slug', 'connect_card', (SELECT id FROM store_inventory WHERE vin = 'KM8J3CA46RU000001'))->'owning_store'->>'name' = 'Harte Hyundai of Old Saybrook', 'authorised sibling vehicle detail is available');
SELECT pg_temp.expect(customer_group_inventory('no-such-slug', 'connect_card')->>'enabled' = 'false', 'an unknown share context gets nothing');

SELECT pg_temp.expect((customer_group_inventory_interest('origin-slug', 'connect_card', (SELECT id FROM store_inventory WHERE vin = 'KM8J3CA46RU000001'), 'Pat Buyer', NULL, 'pat@example.com')->>'ok')::boolean, 'interest in a sibling vehicle is accepted');
SELECT pg_temp.expect((SELECT tenant_id = '00000000-0000-0000-0000-0000000000a1' AND vehicle_vin = '1N4BL4BV0RN000001' AND store_id = '00000000-0000-0000-0000-0000000000a1'
  AND routing->'group_inventory'->>'owning_store_id' = (SELECT v FROM ids WHERE k='B')::text AND routing->'group_inventory'->>'origin_assigned_agent_id' = 'agent-ana'
  FROM leads ORDER BY created_at DESC LIMIT 1), 'lead stays with the originating listing and salesperson, sibling context attached');

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT inv_admin_revoke_sharing_rule((SELECT v FROM ids WHERE k='R'));
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.expect((SELECT count(*) FROM jsonb_array_elements(customer_group_inventory('origin-slug', 'connect_card')->'vehicles') x WHERE x->>'inventory_group' = 'additional') = 0, 'revocation removes sibling inventory immediately');
SELECT pg_temp.expect(customer_group_inventory_vehicle('origin-slug', 'connect_card', (SELECT id FROM store_inventory WHERE vin = 'KM8J3CA46RU000001')) IS NULL, 'revocation also closes the detail route');
SELECT pg_temp.expect((customer_group_inventory_interest('origin-slug', 'connect_card', (SELECT id FROM store_inventory WHERE vin = 'KM8J3CA46RU000001'), 'Pat Buyer', NULL, 'pat@example.com')->>'ok')::boolean = false, 'no interest capture for revoked inventory');

-- ── MarketCheck store gate ─────────────────────────────────────────────────
SELECT pg_temp.expect(NOT (store_enrichment_admit('00000000-0000-0000-0000-0000000000a1', 'KM8J3CA46RU000001', 'neovin', 'test')->>'admitted')::boolean, 'feed-only store generates no MarketCheck call');
SELECT pg_temp.expect(NOT (store_enrichment_admit('00000000-0000-0000-0000-0000000000a1', '1N4AZ1CP0LC000001', 'neovin', 'test')->>'admitted')::boolean, 'primary store without a policy is feed only too');
SELECT pg_temp.expect((store_enrichment_admit('00000000-0000-0000-0000-0000000000a1', '1N4BL4BV0RN000001', 'neovin', 'test')->>'scope') = 'legacy_tenant_inventory', 'legacy tenant inventory keeps today''s behaviour');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT pg_temp.raises($$SELECT inv_admin_save_enrichment_policy(jsonb_build_object('store_id', (SELECT v FROM ids WHERE k='A'), 'mode', 'enrichment', 'allowed_products', '["neovin"]'::jsonb, 'daily_request_limit', 1, 'monthly_request_cap', 10))$$, 'enrichment needs a credential and verified rooftop');
SELECT pg_temp.raises($$SELECT inv_admin_save_enrichment_policy(jsonb_build_object('store_id', (SELECT v FROM ids WHERE k='A'), 'mode', 'enrichment', 'credential_ref', 'MARKETCHECK_API_KEY', 'mc_rooftop_id', 'mc-1', 'mc_rooftop_verified', true, 'allowed_products', '["dealer_inventory_syndication"]'::jsonb, 'daily_request_limit', 1, 'monthly_request_cap', 10))$$, 'only listed products can be approved');
SELECT inv_admin_save_enrichment_policy(jsonb_build_object('store_id', (SELECT v FROM ids WHERE k='A'), 'mode', 'enrichment', 'credential_ref', 'MARKETCHECK_API_KEY', 'mc_rooftop_id', 'mc-1', 'mc_rooftop_verified', true, 'allowed_products', '["neovin"]'::jsonb, 'daily_request_limit', 1, 'monthly_request_cap', 10));
SELECT pg_temp.expect((store_enrichment_admit('00000000-0000-0000-0000-0000000000a1', '1N4AZ1CP0LC000001', 'neovin', 'test', 'manual_refresh', 0.08)->>'admitted')::boolean, 'approved store product is admitted');
SELECT pg_temp.expect(store_enrichment_admit('00000000-0000-0000-0000-0000000000a1', '1N4AZ1CP0LC000003', 'neovin', 'test', 'manual_refresh', 0.08)->>'reason' = 'daily_limit', 'daily limit stops further paid calls');
SELECT pg_temp.expect(store_enrichment_admit('00000000-0000-0000-0000-0000000000a1', '1N4AZ1CP0LC000003', 'price_prediction', 'test')->>'reason' = 'product_not_approved', 'unapproved product is refused');
SELECT pg_temp.expect(NOT (store_enrichment_admit('00000000-0000-0000-0000-0000000000a1', 'KM8J3CA46RU000001', 'neovin', 'test')->>'admitted')::boolean, 'a group credential does not entitle the sibling store');
SELECT pg_temp.expect((SELECT count(*) FROM store_provider_usage WHERE store_id = (SELECT v FROM ids WHERE k='B') AND outcome = 'denied') >= 2, 'denials are metered against the owning store');
SELECT pg_temp.expect((SELECT count(*) FROM jsonb_array_elements(customer_group_inventory('origin-slug', 'connect_card')->'vehicles')) >= 2, 'budget exhaustion leaves feed inventory visible');

-- ── Listing sync and the MarketCheck overwrite guard ───────────────────────
SELECT inv_admin_save_store(jsonb_build_object('id', (SELECT v FROM ids WHERE k='A'), 'listing_sync_enabled', true));
INSERT INTO ids VALUES ('S4', pg_temp.stage((SELECT v FROM ids WHERE k='A'), 'MP15397', '2026-10-31 06:00:00+00', 'sha4', true, ARRAY['1N4AZ1CP0LC000001','1N4AZ1CP0LC000003','1N4BL4BV0RN000099']));
SELECT pg_temp.expect((inventory_apply_store_snapshot((SELECT v FROM ids WHERE k='S4'))->>'listings_created')::int = 2, 'listing sync creates draft listings for new vehicles');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_vin_conflicts WHERE kind = 'legacy_listing' AND vin = '1N4BL4BV0RN000099' AND status = 'open') = 1, 'legacy listing is not assigned automatically');
SELECT pg_temp.expect((SELECT owning_store_id IS NULL AND price = 24000 FROM vehicle_listings WHERE vin = '1N4BL4BV0RN000099'), 'legacy listing untouched until reviewed');
SELECT pg_temp.expect((SELECT status FROM vehicle_listings WHERE vin = '1N4AZ1CP0LC000001') = 'draft', 'new feed listings are drafts, never auto-published');
UPDATE vehicle_listings SET feed_source = 'marketcheck', price = 1, owning_store_id = NULL WHERE vin = '1N4AZ1CP0LC000001';
SELECT pg_temp.expect((SELECT feed_source = 'filescom' AND price = 30001 AND owning_store_id = (SELECT v FROM ids WHERE k='A') FROM vehicle_listings WHERE vin = '1N4AZ1CP0LC000001'), 'MarketCheck write cannot replace the dealer feed price or owner');

-- ── Admin read models ──────────────────────────────────────────────────────
INSERT INTO dealer_profiles VALUES ('00000000-0000-0000-0000-0000000000a1', '{"passport_agents":[{"id":"agent-ana","name":"Ana","status":"available"}]}');
SELECT pg_temp.expect((SELECT jsonb_array_length(inv_admin_overview('00000000-0000-0000-0000-00000000aa01')->'stores')) = 2, 'overview lists the group''s stores');
SELECT pg_temp.expect((inv_admin_usage((SELECT v FROM ids WHERE k='A'))->'month'->>'admitted')::int = 1, 'usage counts admitted calls');
SELECT pg_temp.expect(inv_admin_preview_context((SELECT v FROM ids WHERE k='A'))->'agents'->0->>'id' = 'agent-ana', 'preview lists the store''s salespeople');
SELECT pg_temp.expect((SELECT count(*) FROM jsonb_array_elements(inv_admin_preview_customer_inventory((SELECT v FROM ids WHERE k='A'), 'connect_card')->'vehicles')) >= 2, 'admin preview uses the same core');

-- ── RLS and privileges ─────────────────────────────────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
SET ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000bb99');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory) = 0, 'other group members cannot read Harte inventory');
SELECT pg_temp.expect((SELECT count(*) FROM dealer_stores) = 1, 'other group members see only their own store');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory) > 0, 'Harte members read their group inventory');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_source_mappings) = 0, 'mappings are platform-admin only');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.raises($$SELECT group_inventory_core(gen_random_uuid(), 'connect_card')$$, 'anon cannot pick an arbitrary home store');
SELECT pg_temp.raises($$SELECT store_enrichment_admit(NULL, NULL, 'neovin', 'x')$$, 'anon cannot reach the provider gate');
RESET ROLE;

SELECT 'ALL INVENTORY NETWORK SQL TESTS PASSED' AS result;
