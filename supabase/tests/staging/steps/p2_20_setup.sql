-- RooftopOS staging step p2_20 (phase 2, first). WRITES, synthetic data only.
-- Refuses to run unless every tenant in the database is a rooftopos-staging-*
-- synthetic tenant. Then it:
--   * deletes the runtime rows of the two synthetic dealers (inbox, watermarks,
--     outbox, inspection evidence, repair items) so every run starts clean;
--   * re-activates the five seeded keys and creates three rotation keys
--     (rooftopos-staging-rot-1 retiring, -rot-2 active, -rot-af active);
--   * points the dispatch endpoints at this staging project's own ingest;
--   * sets a fresh random password on each synthetic user.
-- Returns one row, result: secrets, passwords and endpoints for the runner. Save
-- it as <out>/steps/p2_20_setup.json. Synthetic staging values only.
-- The endpoint base is the staging project (ref oaefdolxpmrexjqkzonw), never production.

DO $$
DECLARE
  v_other text;
  k record;
BEGIN
  SELECT string_agg(slug, ', ') INTO v_other FROM public.tenants WHERE slug NOT LIKE 'rooftopos-staging-%';
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'p2_20: refusing to run, non-synthetic tenants present: %', v_other;
  END IF;

  DELETE FROM public.repair_items WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b');
  DELETE FROM public.inspection_evidence WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b');
  DELETE FROM public.integration_outbox WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b');
  DELETE FROM public.integration_inbox WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b');
  DELETE FROM public.integration_source_versions
   WHERE connection_id IN (SELECT id FROM public.integration_connections
                            WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b'));
  DELETE FROM public.integration_connection_keys WHERE key_id LIKE 'rooftopos-staging-rot-%';
  ALTER TABLE public.inspection_evidence DROP CONSTRAINT IF EXISTS rooftopos_staging_injected_failure;

  UPDATE public.integration_connection_keys SET status = 'active', revoked_at = NULL, not_after = NULL
   WHERE key_id IN ('rooftopos-staging-a-native', 'rooftopos-staging-a-autofilm', 'rooftopos-staging-a-paused',
                    'rooftopos-staging-b-native', 'rooftopos-staging-b-autofilm');

  FOR k IN
    SELECT * FROM (VALUES
      ('rooftopos-staging-rot-1',  '5ea90000-0000-4000-8000-0000000000a1'::uuid, 'retiring'),
      ('rooftopos-staging-rot-2',  '5ea90000-0000-4000-8000-0000000000a1'::uuid, 'active'),
      ('rooftopos-staging-rot-af', '5ea90000-0000-4000-8000-0000000000a2'::uuid, 'active')
    ) AS v(key_id, connection_id, status)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = k.key_id) THEN
      PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), k.key_id,
                                  'RooftopOS staging rotation test key');
    END IF;
    INSERT INTO public.integration_connection_keys (connection_id, key_id, vault_secret_name, status)
    VALUES (k.connection_id, k.key_id, k.key_id, k.status);
  END LOOP;

  UPDATE public.integration_connections
     SET endpoint_url = 'https://oaefdolxpmrexjqkzonw.supabase.co/functions/v1/integration-ingest',
         last_error_code = NULL, last_error_at = NULL
   WHERE id = '5ea90000-0000-4000-8000-0000000000a1';
  UPDATE public.integration_connections
     SET endpoint_url = 'https://oaefdolxpmrexjqkzonw.supabase.co/functions/v1/integration-ingest?connection=5ea90000-0000-4000-8000-0000000000a2',
         last_error_code = NULL, last_error_at = NULL
   WHERE id = '5ea90000-0000-4000-8000-0000000000a2';
END $$;

WITH pw AS (
  SELECT u.id, u.email, encode(extensions.gen_random_bytes(24), 'hex') AS password
    FROM auth.users u
   WHERE u.email IN ('rooftopos-staging-dealer-a@example.test', 'rooftopos-staging-dealer-b@example.test',
                     'rooftopos-staging-admin@example.test')
),
upd AS (
  UPDATE auth.users u SET encrypted_password = extensions.crypt(pw.password, extensions.gen_salt('bf')), updated_at = now()
    FROM pw WHERE u.id = pw.id
  RETURNING u.id
)
SELECT jsonb_build_object(
  'step', 'p2_20_setup',
  'generated_at', now(),
  'database', current_database(),
  'users_updated', (SELECT count(*) FROM upd),
  'passwords', (SELECT coalesce(jsonb_object_agg(email, password), '{}') FROM pw),
  'secrets', (SELECT coalesce(jsonb_object_agg(k.key_id, s.decrypted_secret), '{}')
                FROM public.integration_connection_keys k
                JOIN vault.decrypted_secrets s ON s.name = k.vault_secret_name
               WHERE k.key_id LIKE 'rooftopos-staging-%'),
  'endpoints', (SELECT jsonb_object_agg(id, endpoint_url) FROM public.integration_connections
                 WHERE id IN ('5ea90000-0000-4000-8000-0000000000a1', '5ea90000-0000-4000-8000-0000000000a2')),
  'inbox_count', (SELECT count(*) FROM public.integration_inbox
                   WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b'))
) AS result;
