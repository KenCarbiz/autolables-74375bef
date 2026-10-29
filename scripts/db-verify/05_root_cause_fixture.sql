-- Fifth Example Motors: one synthetic vehicle per root-cause pattern seen in
-- the restricted October 2026 review, with its feed record and its website
-- and feed observations. Synthetic: no hosted VIN, price or name. Prices
-- only echo the shapes (fee $895; gaps of total - fee and $10,000).
INSERT INTO t.users (name, id) VALUES ('fifth_owner', 'a0000000-0000-4000-8000-000000000021');
INSERT INTO public.tenants (id, name, slug) VALUES ('b0000000-0000-4000-8000-000000000005', 'Fifth Example Motors', 'fifth-example-motors');
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) VALUES
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000021', 'owner', now() - interval '30 days');
INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES ('b0000000-0000-4000-8000-000000000005',
  '{"dealer_name": "Fifth Example Motors", "doc_fee_enabled": true, "doc_fee_amount": 895, "advertised_includes_doc_fee": true}');

-- 501 A: the dealer page shows total - fee (the feed says its price includes
--        the fee); the crawl took the page figure as fee-inclusive and
--        subtracted the fee again.
-- 502 B2: new vehicle; the page's before-fee figure is $10,000 above the feed's.
-- 503 B1: used; the page matched the feed in September, then moved below it
--        after the feed stopped.
-- 504 archived with a split mismatch; 505 no price; 506 consistent.
INSERT INTO public.vehicle_listings
  (id, store_id, vin, slug, condition, status, tenant_id, created_by, price, advertised_price_before_doc, doc_fee, website_sale_price, price_parse_status, price_parse_notes, mc_raw, archived_at)
VALUES
  ('c0000000-0000-4000-8000-000000000501', 'store-5', 'EXAMPLEVIN0050501', 'fifth-1', 'new', 'published', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000021',
   60895, 59105, 895, 60000, 'ok', 'Doc fee updated in admin; sale price = advertised + doc fee.',
   '{"price": 60895, "msrp": 60000, "price_includes_fees": true, "fees": 895, "last_seen_at": 1790821571}', NULL),
  ('c0000000-0000-4000-8000-000000000502', 'store-5', 'EXAMPLEVIN0050502', 'fifth-2', 'new', 'published', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000021',
   80895, 89105, 895, 90000, 'ok', 'Advertised price 90000 includes the 895 doc fee; before-doc 89105.',
   '{"price": 80895, "msrp": 92000, "price_includes_fees": true, "fees": 895, "last_seen_at": 1790821571}', NULL),
  ('c0000000-0000-4000-8000-000000000503', 'store-5', 'EXAMPLEVIN0050503', 'fifth-3', 'used', 'published', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000021',
   30500, 28605, 895, 29500, 'ok', 'Advertised price 29500 includes the 895 doc fee; before-doc 28605.',
   '{"price": 30500, "price_includes_fees": true, "fees": 895, "last_seen_at": 1790821571}', NULL),
  ('c0000000-0000-4000-8000-000000000504', 'store-5', 'EXAMPLEVIN0050504', 'fifth-4', 'used', 'archived', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000021',
   12000, 12000, 895, 12895, 'ok', NULL, '{}', now() - interval '20 days'),
  ('c0000000-0000-4000-8000-000000000505', 'store-5', 'EXAMPLEVIN0050505', 'fifth-5', 'used', 'published', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000021',
   NULL, NULL, NULL, NULL, NULL, NULL, '{}', NULL),
  ('c0000000-0000-4000-8000-000000000506', 'store-5', 'EXAMPLEVIN0050506', 'fifth-6', 'used', 'published', 'b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000021',
   25895, 25000, 895, 25895, 'ok', NULL, '{"price": 25895, "price_includes_fees": true, "fees": 895, "last_seen_at": 1790821571}', NULL);

INSERT INTO public.advertised_prices (tenant_id, store_id, vin, advertised_price, source_channel, captured_at, captured_method, screenshot_sha256) VALUES
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050501', 60895, 'website', '2026-10-03 03:07+00', 'marketcheck_syndication', NULL),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050501', 60000, 'website', '2026-10-03 07:21+00', 'dealer_vdp_observation', 'example-sha-501'),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050502', 80895, 'website', '2026-10-01 03:07+00', 'marketcheck_syndication', NULL),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050502', 90000, 'website', '2026-10-27 22:49+00', 'dealer_vdp_observation', 'example-sha-502'),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050503', 31000, 'website', '2026-09-08 16:45+00', 'marketcheck_syndication', NULL),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050503', 31000, 'website', '2026-09-09 06:03+00', 'dealer_vdp_observation', 'example-sha-503a'),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050503', 30500, 'website', '2026-10-03 03:07+00', 'marketcheck_syndication', NULL),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050503', 29500, 'website', '2026-10-28 07:23+00', 'dealer_vdp_observation', 'example-sha-503b'),
  ('b0000000-0000-4000-8000-000000000005', 'store-5', 'EXAMPLEVIN0050506', 25895, 'website', '2026-10-28 07:23+00', 'dealer_vdp_observation', 'example-sha-506');
