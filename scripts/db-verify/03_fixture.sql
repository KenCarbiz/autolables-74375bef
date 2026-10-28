-- Synthetic dealership data. Two tenants, one member per role on the first,
-- an owner on the second, a pending invitation, a platform administrator.
-- No hosted identifier, VIN, price or name appears here.

INSERT INTO t.users (name, id) VALUES
  ('owner',             'a0000000-0000-4000-8000-000000000001'),
  ('general_manager',   'a0000000-0000-4000-8000-000000000002'),
  ('gsm',               'a0000000-0000-4000-8000-000000000003'),
  ('admin',             'a0000000-0000-4000-8000-000000000004'),
  ('manager',           'a0000000-0000-4000-8000-000000000005'),
  ('sales_manager',     'a0000000-0000-4000-8000-000000000006'),
  ('used_car_manager',  'a0000000-0000-4000-8000-000000000007'),
  ('inventory_manager', 'a0000000-0000-4000-8000-000000000008'),
  ('salesperson',       'a0000000-0000-4000-8000-000000000009'),
  ('service_manager',   'a0000000-0000-4000-8000-000000000010'),
  ('finance',           'a0000000-0000-4000-8000-000000000011'),
  ('office',            'a0000000-0000-4000-8000-000000000012'),
  ('compliance',        'a0000000-0000-4000-8000-000000000013'),
  ('readonly',          'a0000000-0000-4000-8000-000000000014'),
  ('pending_manager',   'a0000000-0000-4000-8000-000000000015'),
  ('other_tenant_owner','a0000000-0000-4000-8000-000000000016'),
  ('platform_admin',    'a0000000-0000-4000-8000-000000000017');

INSERT INTO public.tenants (id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Example Motors', 'example-motors'),
  ('b0000000-0000-4000-8000-000000000002', 'Second Example Motors', 'second-example-motors');

INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
SELECT 'b0000000-0000-4000-8000-000000000001', id, name, now() - interval '30 days'
FROM t.users
WHERE name NOT IN ('pending_manager', 'other_tenant_owner', 'platform_admin');
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000015', 'manager', NULL),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000016', 'owner', now() - interval '30 days');
INSERT INTO public.user_roles (user_id, role) VALUES ('a0000000-0000-4000-8000-000000000017', 'admin');

INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES
  ('b0000000-0000-4000-8000-000000000001', jsonb_build_object(
    'dealer_name', 'Example Motors',
    'doc_fee_enabled', true,
    'doc_fee_amount', 895,
    'doc_fee_state', 'CT',
    'label_defaults', '{}'::jsonb,
    'dealer_programs', jsonb_build_array(jsonb_build_object(
      'id', 'program-1', 'title', 'Example lifetime powertrain', 'enabled', true, 'showOnSticker', true, 'appliesTo', 'used')))),
  ('b0000000-0000-4000-8000-000000000002', jsonb_build_object('dealer_name', 'Second Example Motors'));

-- Five listings on the first tenant: three active with a price basis (one
-- carrying a parse warning), one archived with a basis, one active without.
INSERT INTO public.vehicle_listings
  (id, store_id, vin, slug, condition, status, tenant_id, created_by, price, advertised_price_before_doc, doc_fee, website_sale_price, price_last_verified_at, price_parse_status, archived_at)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'store-1', 'EXAMPLEVIN0000001', 'example-1', 'used', 'published', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 20000, 20000, 895, 20895, '2026-10-01 12:00+00', 'ok', NULL),
  ('c0000000-0000-4000-8000-000000000002', 'store-1', 'EXAMPLEVIN0000002', 'example-2', 'new',  'published', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 40000, 40000, 895, 40895, '2026-10-02 12:00+00', 'ok', NULL),
  ('c0000000-0000-4000-8000-000000000003', 'store-1', 'EXAMPLEVIN0000003', 'example-3', 'used', 'published', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 15000, 15000, 895, 15895, '2026-10-03 12:00+00', 'warning', NULL),
  ('c0000000-0000-4000-8000-000000000004', 'store-1', 'EXAMPLEVIN0000004', 'example-4', 'used', 'archived',  'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 18000, 18000, 895, 18895, '2026-09-01 12:00+00', 'ok', now() - interval '10 days'),
  ('c0000000-0000-4000-8000-000000000005', 'store-1', 'EXAMPLEVIN0000005', 'example-5', 'used', 'draft',     'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', NULL,  NULL,  NULL, NULL,  NULL, NULL, NULL);

INSERT INTO public.products (id, name, price, tenant_id) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'Example protection package', 495, 'b0000000-0000-4000-8000-000000000001');
INSERT INTO public.product_rules (id, tenant_id, product_id, condition) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'used');

INSERT INTO public.marketcheck_sync_config (tenant_id, allowed, enabled, source, frequency) VALUES
  ('b0000000-0000-4000-8000-000000000001', true, true, 'example-dealer.test', 'nightly');
INSERT INTO public.inventory_sync_runs (tenant_id, started_at, status, http_status) VALUES
  ('b0000000-0000-4000-8000-000000000001', '2026-10-20 07:00+00', 'success', 200),
  ('b0000000-0000-4000-8000-000000000001', '2026-10-22 07:00+00', 'partial', 200),
  ('b0000000-0000-4000-8000-000000000001', '2026-10-27 07:00+00', 'failed', 429),
  ('b0000000-0000-4000-8000-000000000001', '2026-10-28 07:00+00', 'skipped', NULL);

-- Scheduled jobs whose commands carry a URL and a bearer key, to prove the job
-- status read never returns either.
INSERT INTO cron.job (schedule, command, jobname, active) VALUES
  ('0 * * * *', 'select net.http_post(url:=''https://example-project.test/functions/v1/marketcheck-sync'', headers:=''{"Authorization":"Bearer example-secret-key"}'')', 'marketcheck-sync', true),
  ('20 7 * * *', 'select net.http_post(url:=''https://example-project.test/functions/v1/crawl-advertised-prices'', headers:=''{"Authorization":"Bearer example-secret-key"}'')', 'autolabels_crawl_advertised_prices', true),
  ('0 3 * * *', 'select net.http_post(url:=''https://example-project.test/functions/v1/enrich-sweep'', headers:=''{"Authorization":"Bearer example-secret-key"}'')', 'enrich-sweep-nightly', false);
INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
SELECT jobid, 'succeeded', 'example', now() - interval '1 hour', now() - interval '59 minutes' FROM cron.job;
