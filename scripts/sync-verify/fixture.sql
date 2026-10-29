-- Synthetic dealerships, sync settings and inventory for the isolated sync run.
-- No hosted identifier, VIN, price, name or address appears here.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'Feed Example Motors', 'feed-example-motors'),
  ('f0000000-0000-4000-8000-000000000002', 'Bystander Motors', 'bystander-motors');

INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES
  ('f0000000-0000-4000-8000-000000000001', '{"doc_fee_enabled": true, "doc_fee_amount": 500}'),
  ('f0000000-0000-4000-8000-000000000002', '{}');

INSERT INTO public.marketcheck_sync_config
  (tenant_id, allowed, enabled, source, max_vehicles, mc_scope_param, mc_scope_value,
   rooftop_street, rooftop_zip, rooftop_name, strict_rooftop, last_good_count, run_hour)
VALUES
  ('f0000000-0000-4000-8000-000000000001', true, true, 'feed.example.test', 100, 'mc_rooftop_id', 'rt-example-1',
   '1 Example Way', '00001', 'Feed Example Motors', true, 3, 3),
  ('f0000000-0000-4000-8000-000000000002', true, false, 'bystander.example.test', 100, '', '', '', '', '', true, 0, 3);

-- Inventory before the run. 1 changes price in the feed, 2 is unchanged, 3 is
-- absent from the feed, 4 is new in the feed. 6 belongs to the other dealership.
INSERT INTO public.vehicle_listings (tenant_id, store_id, vin, slug, status, condition, price, mileage, ymm, feed_source)
VALUES
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', '1EXMP0005S9000001', 'syn-000001', 'published', 'used', 20000, 31000, '2024 Example Alpha', 'marketcheck'),
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', '1EXMP0007S9000002', 'syn-000002', 'published', 'new',  40000, 12,    '2024 Example Beta',  'marketcheck'),
  ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', '1EXMP0009S9000003', 'syn-000003', 'published', 'used', 15000, 52000, '2024 Example Gamma', 'marketcheck'),
  ('f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', '1EXMP0004S9000006', 'syn-000006', 'published', 'used', 33000, 9000,  '2024 Example Zeta',  'marketcheck');
