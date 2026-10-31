-- Rollback for 20261107000000: restores every value the migration cleared,
-- exactly as it was, from in_service_proxy_audit. Restoring re-enables the
-- inferred warranty start dates the migration removed.
BEGIN;
UPDATE public.vehicle_listings v SET in_service_date = a.prior_value::date
  FROM public.in_service_proxy_audit a WHERE a.listing_id = v.id AND a.column_name = 'in_service_date';
UPDATE public.vehicle_listings v SET warranty_info = COALESCE(v.warranty_info, '{}'::jsonb) || jsonb_build_object('in_service_date', a.prior_value)
  FROM public.in_service_proxy_audit a WHERE a.listing_id = v.id AND a.column_name = 'warranty_info.in_service_date';
UPDATE public.vehicle_listings v SET history_payload = v.history_payload || jsonb_build_object('inServiceDate', a.prior_value)
  FROM public.in_service_proxy_audit a WHERE a.listing_id = v.id AND a.column_name = 'history_payload.inServiceDate';
DELETE FROM public.in_service_proxy_audit;
COMMIT;
