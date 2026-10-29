-- Synthetic dealership and inventory for the isolated crawler run. Fee
-- settings mirror a dealership that declares its advertised prices include a
-- $900 document fee. No hosted identifier, VIN, price, name or address.

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
  ('c0000000-0000-4000-8000-000000000001', 'Crawl Example Motors', 'crawl-example-motors');
INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES
  ('c0000000-0000-4000-8000-000000000001',
   '{"doc_fee_enabled": true, "doc_fee_amount": 900, "advertised_includes_doc_fee": true}');

-- Listings as the inventory feed left them: price and an inclusive split, the
-- feed last seen 27 days ago (stale, as in production on 2026-10-29).
INSERT INTO public.vehicle_listings
  (tenant_id, store_id, vin, slug, status, condition, ymm, source_url, price,
   advertised_price_before_doc, doc_fee, website_sale_price, mc_raw)
SELECT 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', v.vin,
       'crawl-' || lower(right(v.vin, 6)), 'published', 'used', '2024 Example SUV', v.url, v.feed,
       v.feed - 900, 900, v.feed,
       jsonb_build_object('last_seen_at', extract(epoch from now() - interval '27 days')::bigint)
FROM (VALUES
  ('1EXMP0008S9000011', 'https://dealer.example.test/viewdetails/used/1exmp0008s9000011/2024-example-suv', 31000),
  ('1EXMP000XS9000012', 'https://dealer.example.test/viewdetails/used/1exmp000xs9000012/2024-example-suv', 27000),
  ('1EXMP0001S9000013', 'https://dealer.example.test/viewdetails/used/1exmp0001s9000013/2024-example-suv', 25892),
  ('1EXMP0003S9000014', 'https://dealer.example.test/viewdetails/used/1exmp0003s9000014/2024-example-suv', 22500),
  ('1EXMP0005S9000015', 'https://dealer.example.test/viewdetails/used/1exmp0005s9000015/2024-example-suv', 34000),
  ('1EXMP0007S9000016', 'https://dealer.example.test/viewdetails/used/1exmp0007s9000016/2024-example-suv', 29000),
  ('1EXMP0009S9000017', 'https://dealer.example.test/viewdetails/used/1exmp0009s9000017/2024-example-suv', 21000),
  ('1EXMP0000S9000018', 'https://dealer.example.test/viewdetails/used/1exmp0000s9000018/2024-example-suv', 27000)
) AS v(vin, url, feed);

-- Failure injection for the partial-failure case: a listing pricing write for
-- a VIN in this table is refused by the database.
CREATE SCHEMA IF NOT EXISTS crawl_verify;
CREATE TABLE crawl_verify.fail_listing_update (vin text PRIMARY KEY);
CREATE OR REPLACE FUNCTION crawl_verify.refuse_listing_update() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF EXISTS (SELECT 1 FROM crawl_verify.fail_listing_update f WHERE f.vin = NEW.vin)
     AND (NEW.website_sale_price IS DISTINCT FROM OLD.website_sale_price
          OR NEW.advertised_price_before_doc IS DISTINCT FROM OLD.advertised_price_before_doc) THEN
    RAISE EXCEPTION 'injected failure: listing pricing write refused for %', NEW.vin;
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER crawl_verify_refuse_listing_update BEFORE UPDATE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION crawl_verify.refuse_listing_update();
GRANT USAGE ON SCHEMA crawl_verify TO service_role, authenticated, anon;
GRANT SELECT ON crawl_verify.fail_listing_update TO service_role, authenticated, anon;
