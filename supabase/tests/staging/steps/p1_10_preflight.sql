-- RooftopOS staging step p1_10 (phase 1, before the kill-switch requests). Read-only.
-- Returns one row with one JSON column, result: the seeded key secrets the runner
-- signs with, the seed inventory and the current inbox count. Save that row as
-- <out>/steps/p1_10_preflight.json. Contains synthetic staging secrets only.
SELECT jsonb_build_object(
  'step', 'p1_10_preflight',
  'generated_at', now(),
  'database', current_database(),
  'tenants', (SELECT coalesce(jsonb_agg(slug ORDER BY slug), '[]') FROM public.tenants),
  'connections', (SELECT count(*) FROM public.integration_connections
                   WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b')),
  'secrets', (SELECT coalesce(jsonb_object_agg(k.key_id, s.decrypted_secret), '{}')
                FROM public.integration_connection_keys k
                JOIN vault.decrypted_secrets s ON s.name = k.vault_secret_name
               WHERE k.key_id IN ('rooftopos-staging-a-native', 'rooftopos-staging-a-autofilm', 'rooftopos-staging-a-paused',
                                  'rooftopos-staging-b-native', 'rooftopos-staging-b-autofilm')),
  'inbox_count', (SELECT count(*) FROM public.integration_inbox
                   WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b'))
) AS result;
