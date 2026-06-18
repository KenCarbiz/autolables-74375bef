INSERT INTO public.dealer_profiles (tenant_id, settings)
VALUES (
  '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142',
  jsonb_build_object(
    'vdp_price_labels', 'Harte Deal, Internet Price, Selling Price',
    'vdp_strip_finance_params', true
  )
)
ON CONFLICT (tenant_id) DO UPDATE SET
  settings = COALESCE(public.dealer_profiles.settings, '{}'::jsonb)
    || jsonb_build_object(
      'vdp_price_labels', 'Harte Deal, Internet Price, Selling Price',
      'vdp_strip_finance_params', true
    ),
  updated_at = now();

INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
VALUES (
  'dealer_settings_seeded',
  'dealer_profile',
  '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142',
  '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142',
  jsonb_build_object(
    'reason', 'seed_harte_vdp_price_labels',
    'vdp_price_labels', 'Harte Deal, Internet Price, Selling Price',
    'vdp_strip_finance_params', true
  )
);