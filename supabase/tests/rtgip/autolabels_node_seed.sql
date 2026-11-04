-- Synthetic seed for a disposable AutoLabels node (autolabels_node.sh). Throwaway clusters only.
-- psql variables: tenant, other_tenant, store, rooftop, mapper, open_episode, open_listing,
-- open_file, delivered_episode, deliver (1 closes the second episode through sold and delivered
-- milestones at seed time; 0 leaves it open for a test to deliver). One open, published vehicle and one sold-and-delivered vehicle
-- whose custody history is written through vehicle_history_record_milestone, never directly.
BEGIN;
CREATE TEMP TABLE _s AS SELECT
  :'tenant'::uuid AS tenant, :'other_tenant'::uuid AS other_tenant, :'store'::uuid AS store, :'rooftop'::text AS rooftop,
  :'mapper'::uuid AS mapper, :'open_episode'::uuid AS open_ep, :'open_listing'::uuid AS listing, :'open_file'::uuid AS file,
  :'delivered_episode'::uuid AS delivered_ep, :'deliver'::int AS deliver;
GRANT SELECT ON _s TO PUBLIC;

INSERT INTO public.tenants (id, name, slug) SELECT tenant, 'Staging Synthetic Dealer', 'stg-' || tenant FROM _s
  UNION ALL SELECT other_tenant, 'Staging Synthetic Other', 'stg-o-' || other_tenant FROM _s;
INSERT INTO auth.users (id, email) SELECT mapper, 'stg-mapper-' || mapper || '@example.test' FROM _s;
INSERT INTO public.dealer_stores (id, tenant_id) SELECT store, tenant FROM _s;
INSERT INTO rtgip_src.rooftop_stores (tenant_id, rooftop_id, store_id, mapped_by, reason)
  SELECT tenant, rooftop, store, mapper, 'staging synthetic mapping' FROM _s;
INSERT INTO public.vehicles (vin) VALUES ('1M8GDM9AXKP042801'), ('1M8GDM9AXKP042802') ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_files (id, tenant_id, vin, stock_number, year, make, model, trim)
  SELECT file, tenant, '1M8GDM9AXKP042801', 'STG1001', '2019', 'Synthetic', 'Roadster', 'Base' FROM _s;
INSERT INTO public.vehicle_listings (id, store_id, owning_store_id, tenant_id, vin, slug, vehicle_file_id, status, condition,
    price, advertised_price_before_doc, doc_fee, published_at)
  SELECT listing, tenant, store, tenant, '1M8GDM9AXKP042801', 'stg-' || listing, file, 'published', 'used', 25995, 25995, 899, now() FROM _s;

-- In the staging run (deliver = 0) the delivered vehicle keeps an archived listing so its identity can still be read and published.
INSERT INTO public.vehicle_files (id, tenant_id, vin, stock_number, year, make, model, trim)
  SELECT gen_random_uuid(), tenant, '1M8GDM9AXKP042802', 'STG1002', '2019', 'Synthetic', 'Roadster', 'Base' FROM _s WHERE deliver = 0;
INSERT INTO public.vehicle_listings (id, store_id, owning_store_id, tenant_id, vin, slug, vehicle_file_id, status, condition,
    price, advertised_price_before_doc, doc_fee, published_at)
  SELECT gen_random_uuid(), tenant, store, tenant, '1M8GDM9AXKP042802', 'stg-d-' || delivered_ep, f.id, 'archived', 'used', 21995, 21995, 899, now() - interval '10 days'
    FROM _s JOIN public.vehicle_files f ON f.tenant_id = _s.tenant AND f.vin = '1M8GDM9AXKP042802' WHERE _s.deliver = 0;

SELECT set_config('vehicle_history.custody_writer', 'on', true);
INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, listing_id)
  SELECT open_ep, tenant, '1M8GDM9AXKP042801', store, 'active', 'in_stock', 'initial', listing FROM _s;
INSERT INTO public.vehicle_instances (id, tenant_id, vin, store_id, status, custody_state, opened_reason, listing_id)
  SELECT delivered_ep, tenant, '1M8GDM9AXKP042802', store, 'active', 'in_stock', 'initial', l.id FROM _s
    LEFT JOIN public.vehicle_listings l ON l.tenant_id = _s.tenant AND l.vin = '1M8GDM9AXKP042802';
SELECT set_config('vehicle_history.custody_writer', '', true);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE e uuid := (SELECT delivered_ep FROM _s);
BEGIN
  IF (SELECT deliver FROM _s) = 1 THEN
    PERFORM public.vehicle_history_record_milestone(e, 'sold', now() - interval '3 days', NULL, 'dms', 'stg-deal-1', NULL,
      NULL, NULL, 'dms:stg-deal-1:r1', 1);
    PERFORM public.vehicle_history_record_milestone(e, 'delivered', now() - interval '2 days', NULL, 'dms', 'stg-deal-1', NULL,
      NULL, NULL, 'dms:stg-deal-1:r2', 2);
    IF (SELECT status || '/' || custody_state FROM public.vehicle_instances WHERE id = e) <> 'disposed/delivered' THEN
      RAISE EXCEPTION 'seed: delivered episode did not close';
    END IF;
  END IF;
END $$;
RESET ROLE;

SELECT public.vehicle_history_audit_write(tenant, 'custody.episode_opened', 'vehicle_instance', open_ep::text, 'staging seed: episode opened at the mapped rooftop', NULL,
  jsonb_build_object('vin', '1M8GDM9AXKP042801', 'store_id', store)) FROM _s;
SELECT public.vehicle_history_audit_write(tenant, 'custody.episode_opened', 'vehicle_instance', delivered_ep::text, 'staging seed: episode opened at the mapped rooftop', NULL,
  jsonb_build_object('vin', '1M8GDM9AXKP042802', 'store_id', store)) FROM _s;

COMMIT;
