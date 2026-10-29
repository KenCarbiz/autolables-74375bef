-- Fee basis fixtures. Synthetic: no hosted identifier, VIN, price or name.
--
-- advertised_prices carries the hosted column set (read from the hosted
-- project's information_schema on 2026-10-29): website price observations
-- per VIN, the evidence the fee basis is checked against.
CREATE TABLE IF NOT EXISTS public.advertised_prices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id          text NOT NULL DEFAULT '',
  vin               text NOT NULL,
  advertised_price  numeric NOT NULL,
  source_channel    text NOT NULL DEFAULT 'website',
  source_url        text,
  screenshot_url    text,
  captured_at       timestamptz NOT NULL DEFAULT now(),
  captured_by       uuid,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  screenshot_bucket text,
  screenshot_sha256 text,
  captured_method   text
);
ALTER TABLE public.advertised_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.advertised_prices FROM anon, authenticated;

INSERT INTO t.users (name, id) VALUES
  ('fee_owner',      'a0000000-0000-4000-8000-000000000018'),
  ('conflict_owner', 'a0000000-0000-4000-8000-000000000019'),
  ('fee_manager',    'a0000000-0000-4000-8000-000000000020');
INSERT INTO public.tenants (id, name, slug) VALUES
  ('b0000000-0000-4000-8000-000000000003', 'Third Example Motors', 'third-example-motors'),
  ('b0000000-0000-4000-8000-000000000004', 'Fourth Example Motors', 'fourth-example-motors');
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) VALUES
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 'owner', now() - interval '30 days'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000020', 'manager', now() - interval '30 days'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000019', 'owner', now() - interval '30 days');
INSERT INTO public.dealer_profiles (tenant_id, settings)
SELECT id, jsonb_build_object(
    'dealer_name', name,
    'doc_fee_enabled', true,
    'doc_fee_amount', 895,
    'doc_fee_state', 'CT',
    'price_display_mode', 'website_sale_price',
    'advertised_includes_doc_fee', true)
FROM public.tenants WHERE id IN ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000004');

-- Third: fee-inclusive and free of conflicts.
--   301 the traced vehicle: $40,420 advertised total including $895, $39,525 before the fee.
--   307 a second coherent vehicle.
--   305 no advertised price.
--   306 archived, coherent.
-- Fourth: fee-inclusive with one of each conflict.
--   402 website_sale_price $30,500 against a $30,000 total.
--   403 a before-fee price equal to the total (fee subtracted nowhere).
--   404 a total so small that a $925 fee leaves no vehicle price.
--   408 coherent fields, but the latest website observation shows the total
--       minus the fee, as the 10 class A vehicles in the hosted review do.
INSERT INTO public.vehicle_listings
  (id, store_id, vin, slug, condition, status, tenant_id, created_by, price, advertised_price_before_doc, doc_fee, website_sale_price, price_last_verified_at, price_parse_status, price_parse_notes, archived_at)
VALUES
  ('c0000000-0000-4000-8000-000000000301', 'store-3', 'EXAMPLEVIN0040420', 'third-1', 'used', 'published', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 40420, 39525, 895, 40420, '2026-10-05 12:00+00', 'ok', 'Advertised price 40420 includes the 895 doc fee; before-doc 39525.', NULL),
  ('c0000000-0000-4000-8000-000000000307', 'store-3', 'EXAMPLEVIN0025000', 'third-7', 'new',  'published', 'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 25000, 24105, 895, 25000, '2026-10-07 12:00+00', 'warning', 'Price parse mismatch: example. Review source page.', NULL),
  ('c0000000-0000-4000-8000-000000000305', 'store-3', 'EXAMPLEVIN0000000', 'third-5', 'used', 'draft',     'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('c0000000-0000-4000-8000-000000000306', 'store-3', 'EXAMPLEVIN0018000', 'third-6', 'used', 'archived',  'b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000018', 18000, 17105, 895, 18000, '2026-09-05 12:00+00', 'ok', NULL, now() - interval '10 days'),
  ('c0000000-0000-4000-8000-000000000402', 'store-4', 'EXAMPLEVIN0030000', 'fourth-2', 'used', 'published', 'b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000019', 30000, 29105, 895, 30500, '2026-10-06 12:00+00', 'ok', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000403', 'store-4', 'EXAMPLEVIN0020000', 'fourth-3', 'new',  'published', 'b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000019', 20000, 20000, 895, 20000, '2026-10-07 12:00+00', 'ok', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000404', 'store-4', 'EXAMPLEVIN0000900', 'fourth-4', 'used', 'published', 'b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000019', 900, 5, 895, 900, '2026-10-08 12:00+00', 'ok', NULL, NULL),
  ('c0000000-0000-4000-8000-000000000408', 'store-4', 'EXAMPLEVIN0050000', 'fourth-8', 'used', 'published', 'b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000019', 50000, 49105, 895, 50000, '2026-10-09 12:00+00', 'ok', NULL, NULL);

INSERT INTO public.advertised_prices (tenant_id, store_id, vin, advertised_price, source_channel, captured_at, captured_method, screenshot_sha256) VALUES
  ('b0000000-0000-4000-8000-000000000003', 'store-3', 'EXAMPLEVIN0040420', 40420, 'website', '2026-10-05 12:00+00', 'dealer_vdp_observation', 'example-sha-1'),
  ('b0000000-0000-4000-8000-000000000004', 'store-4', 'EXAMPLEVIN0050000', 49105, 'website', '2026-10-09 12:00+00', 'dealer_vdp_observation', 'example-sha-2');
