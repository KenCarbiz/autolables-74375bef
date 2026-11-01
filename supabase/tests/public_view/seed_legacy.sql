-- Two synthetic dealers for the legacy feed tests. Dealer A has a signed
-- connection bound to all three feeds; dealer B has none.
INSERT INTO public.tenants (id, name, slug, autocurb_tenant_id) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'Synthetic Dealer A', 'synthetic-dealer-a', 'ac-dealer-a'),
  ('b0000000-0000-4000-8000-00000000000b', 'Synthetic Dealer B', 'synthetic-dealer-b', 'ac-dealer-b')
ON CONFLICT DO NOTHING;

INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status, adapter, scopes) VALUES
  ('c0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', 'autocurb', 'A autocurb', 'active', 'rooftop.v1', '{}'),
  ('c0000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 'autofilm', 'A autofilm', 'active', 'rooftop.v1', '{}'),
  ('c0000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-00000000000a', 'dms', 'A vauto', 'active', 'rooftop.v1', '{}');
INSERT INTO vault.secrets (name, secret) VALUES
  ('vault_key_a_curb', 'synthetic-secret-a-curb'),
  ('vault_key_a_film', 'synthetic-secret-a-film'),
  ('vault_key_a_dms', 'synthetic-secret-a-dms');
INSERT INTO public.integration_connection_keys (connection_id, key_id, vault_secret_name) VALUES
  ('c0000000-0000-4000-8000-0000000000a1', 'key_a_curb', 'vault_key_a_curb'),
  ('c0000000-0000-4000-8000-0000000000a2', 'key_a_film', 'vault_key_a_film'),
  ('c0000000-0000-4000-8000-0000000000a3', 'key_a_dms', 'vault_key_a_dms');
INSERT INTO public.legacy_feed_bindings (tenant_id, feed, provider, connection_id) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'autocurb_sync', NULL, 'c0000000-0000-4000-8000-0000000000a1'),
  ('a0000000-0000-4000-8000-00000000000a', 'autofilm_feed', NULL, 'c0000000-0000-4000-8000-0000000000a2'),
  ('a0000000-0000-4000-8000-00000000000a', 'dms_webhook', 'vauto', 'c0000000-0000-4000-8000-0000000000a3');

INSERT INTO public.vehicle_listings (id, tenant_id, store_id, vin, slug, ymm, price, status, published_at, archived_at, archive_reason)
VALUES
  ('d0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
   '1FTFW1E50MFA00001', 'a-live', '2021 Ford F-150', 30000, 'published', now() - interval '10 days', NULL, NULL),
  ('d0000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
   '1FTFW1E50MFA00002', 'a-archived', '2021 Ford F-150', 28000, 'archived', now() - interval '90 days', now() - interval '20 days', 'left_feed'),
  ('d0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-00000000000b',
   '1FTFW1E50MFB00001', 'b-live', '2022 Ford Bronco', 45000, 'published', now() - interval '10 days', NULL, NULL);
