-- A third synthetic tenant whose advertised prices include the document fee,
-- for the fee basis cases. Its own owner, so no earlier case sees it.
-- No hosted identifier, VIN, price or name appears here.

INSERT INTO t.users (name, id) VALUES ('fee_owner', 'a0000000-0000-4000-8000-000000000018');
INSERT INTO public.tenants (id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000003', 'Third Example Motors', 'third-example-motors');
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) VALUES
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 'owner', now() - interval '30 days');
INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES
  ('b0000000-0000-4000-8000-000000000003', jsonb_build_object(
    'dealer_name', 'Third Example Motors',
    'doc_fee_enabled', true,
    'doc_fee_amount', 895,
    'doc_fee_state', 'CT',
    'price_display_mode', 'website_sale_price',
    'advertised_includes_doc_fee', true));

-- 301 the traced vehicle: $40,420 advertised total including $895, $39,525 before the fee.
-- 302 a website observation ($30,500) that disagrees with the advertised total ($30,000).
-- 303 a split that already disagrees with its total (before-fee = total, as a feed writes it
--     when it reads the price as fee-exclusive).
-- 304 a total so small that a $925 fee would leave no vehicle price.
-- 305 no advertised price.
-- 306 archived.
INSERT INTO public.vehicle_listings
  (id, store_id, vin, slug, condition, status, tenant_id, created_by, price, advertised_price_before_doc, doc_fee, website_sale_price, price_last_verified_at, price_parse_status, archived_at)
VALUES
  ('c0000000-0000-4000-8000-000000000301', 'store-3', 'EXAMPLEVIN0040420', 'third-1', 'used', 'published', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 40420, 39525, 895, 40420, '2026-10-05 12:00+00', 'ok', NULL),
  ('c0000000-0000-4000-8000-000000000302', 'store-3', 'EXAMPLEVIN0030000', 'third-2', 'used', 'published', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 30000, 29105, 895, 30500, '2026-10-06 12:00+00', 'ok', NULL),
  ('c0000000-0000-4000-8000-000000000303', 'store-3', 'EXAMPLEVIN0020000', 'third-3', 'new',  'published', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 20000, 20000, 895, 20000, '2026-10-07 12:00+00', 'ok', NULL),
  ('c0000000-0000-4000-8000-000000000304', 'store-3', 'EXAMPLEVIN0000900', 'third-4', 'used', 'published', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 900, 5, 895, 900, '2026-10-08 12:00+00', 'ok', NULL),
  ('c0000000-0000-4000-8000-000000000305', 'store-3', 'EXAMPLEVIN0000000', 'third-5', 'used', 'draft',     'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('c0000000-0000-4000-8000-000000000306', 'store-3', 'EXAMPLEVIN0018000', 'third-6', 'used', 'archived',  'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 18000, 17105, 895, 18000, '2026-09-05 12:00+00', 'ok', now() - interval '10 days');
