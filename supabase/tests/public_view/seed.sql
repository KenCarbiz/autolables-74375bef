-- Synthetic dealer and listings, one per customer-facing disposition.
INSERT INTO public.tenants (id, name, slug) VALUES
  ('5e1d0000-0000-4000-8000-000000000001', 'Synthetic Demo Motors', 'synthetic-demo-motors')
ON CONFLICT DO NOTHING;

INSERT INTO public.vehicle_listings
  (id, tenant_id, store_id, vin, slug, ymm, trim, mileage, condition, price, status, published_at, archived_at, archive_reason, dealer_snapshot)
VALUES
  ('5e1d0000-0000-4000-8000-0000000000a1', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000001', 'demo-available', '2022 Honda Accord', 'EX-L', 21450, 'used', 27995, 'published', now() - interval '20 days', NULL, NULL,
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}'),
  ('5e1d0000-0000-4000-8000-0000000000a2', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000002', 'demo-left-feed', '2021 Toyota RAV4', 'XLE', 33210, 'used', 26450, 'archived', now() - interval '60 days', now() - interval '3 days', 'left_feed',
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}'),
  ('5e1d0000-0000-4000-8000-0000000000a3', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000003', 'demo-sold', '2023 Subaru Outback', 'Premium', 12080, 'used', 31990, 'archived', now() - interval '45 days', now() - interval '2 days', 'left_feed',
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}'),
  ('5e1d0000-0000-4000-8000-0000000000a4', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000004', 'demo-deal-signed', '2020 Ford F-150', 'XLT', 48700, 'used', 34500, 'archived', now() - interval '30 days', now() - interval '1 day', 'left_feed',
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}'),
  ('5e1d0000-0000-4000-8000-0000000000a5', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000005', 'demo-relisted', '2019 Mazda CX-5', 'Touring', 51200, 'used', 19800, 'published', now() - interval '5 days', NULL, NULL,
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}'),
  ('5e1d0000-0000-4000-8000-0000000000a6', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000006', 'demo-duplicate', '2022 Kia Telluride', 'SX', 18030, 'used', 41200, 'archived', now() - interval '40 days', now() - interval '6 days', 'duplicate_reconciled',
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}'),
  ('5e1d0000-0000-4000-8000-0000000000a7', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000007', 'demo-archived-no-reason', '2018 Jeep Wrangler', 'Sport', 64010, 'used', 24300, 'archived', now() - interval '90 days', now() - interval '10 days', NULL,
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}'),
  ('5e1d0000-0000-4000-8000-0000000000a8', '5e1d0000-0000-4000-8000-000000000001', '5e1d0000-0000-4000-8000-000000000001',
   '5YJ3E1EA0SF000008', 'demo-transferred', '2021 Chevrolet Tahoe', 'LT', 29870, 'used', 52900, 'archived', now() - interval '50 days', now() - interval '4 days', 'left_feed',
   '{"name":"Synthetic Demo Motors","phone":"(555) 010-0100"}');

-- Deal records: a signed deal on a car that has left the feed (sale pending), and
-- a delivery from an earlier stay of a car that is listed again (must not read sold).
INSERT INTO public.vehicle_files (tenant_id, vin, deal_status, updated_at) VALUES
  ('5e1d0000-0000-4000-8000-000000000001', '5YJ3E1EA0SF000004', 'signed', now() - interval '1 day'),
  ('5e1d0000-0000-4000-8000-000000000001', '5YJ3E1EA0SF000005', 'delivered', now() - interval '200 days');

\if :with_foundation
INSERT INTO public.vehicles (vin) VALUES ('5YJ3E1EA0SF000003'), ('5YJ3E1EA0SF000008') ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_instances (tenant_id, vin, custody_state, status, disposition, opened_reason)
VALUES ('5e1d0000-0000-4000-8000-000000000001', '5YJ3E1EA0SF000003', 'delivered', 'disposed', 'retail_sale', 'backfill'),
       ('5e1d0000-0000-4000-8000-000000000001', '5YJ3E1EA0SF000008', 'transferred_out', 'disposed', 'transfer', 'backfill');
\endif
