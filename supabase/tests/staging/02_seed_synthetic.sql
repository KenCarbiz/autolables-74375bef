-- RooftopOS staging: synthetic seed. Apply AFTER 01_dependencies.sql and the spine
-- migration, as its own migration (or paste into the SQL editor, which runs as
-- postgres). Idempotent: re-running changes nothing and creates no duplicates.
-- Paste-safe: plain SQL, no psql meta-commands; pgcrypto is called schema-qualified
-- (extensions.*), which is where Supabase installs it.
--
-- Everything here is synthetic: two dealerships that share one VIN, a second VIN,
-- three users at example.test (one per dealer plus one platform admin), native and
-- autofilm.v1 connections per dealer, a paused connection, and signing keys whose
-- secrets are generated in the database and stored only in Vault.
--
-- Users: inserted straight into auth.users with a bcrypt hash of a RANDOM password
-- nobody knows. run_staging.ts sets fresh passwords through STAGING_DB_URL before
-- it signs in, unless STAGING_PASSWORD_DEALER_A / _DEALER_B / _ADMIN are given. If
-- a user with the same email already exists (for example one created in the
-- dashboard under Authentication > Add user), that user is reused untouched.

DO $$
DECLARE
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  v_email text;
  v_uid uuid;
BEGIN
  FOREACH v_email IN ARRAY ARRAY[
    'rooftopos-staging-dealer-a@example.test',
    'rooftopos-staging-dealer-b@example.test',
    'rooftopos-staging-admin@example.test'
  ] LOOP
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    IF v_uid IS NULL THEN
      v_uid := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        v_instance, v_uid, 'authenticated', 'authenticated', v_email,
        extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'), extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('synthetic', true, 'kit', 'rooftopos-staging'),
        now(), now(), '', '', '', ''
      );
      INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(), v_uid, v_uid::text, 'email',
        jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
        now(), now(), now()
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO public.tenants (id, name, slug, source)
VALUES
  ('5ea90000-0000-4000-8000-00000000000a', 'Staging Synthetic Motors A', 'rooftopos-staging-a', 'manual'),
  ('5ea90000-0000-4000-8000-00000000000b', 'Staging Synthetic Motors B', 'rooftopos-staging-b', 'manual')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
SELECT t.tenant_id, u.id, 'owner', now()
FROM (VALUES
  ('5ea90000-0000-4000-8000-00000000000a'::uuid, 'rooftopos-staging-dealer-a@example.test'),
  ('5ea90000-0000-4000-8000-00000000000b'::uuid, 'rooftopos-staging-dealer-b@example.test')
) AS t(tenant_id, email)
JOIN auth.users u ON u.email = t.email
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE email = 'rooftopos-staging-admin@example.test'
ON CONFLICT (user_id, role) DO NOTHING;

-- 1HGCM82633A004352 and 1FTFW1E51PFA00017 both carry a valid ISO 3779 check digit.
INSERT INTO public.vehicles (vin) VALUES ('1HGCM82633A004352'), ('1FTFW1E51PFA00017')
ON CONFLICT (vin) DO NOTHING;

-- The shared VIN is in custody at both dealers at once; the second VIN only at A.
INSERT INTO public.vehicle_instances (id, tenant_id, vin, acquisition_channel)
VALUES
  ('5ea90000-0000-4000-8000-0000000001a1', '5ea90000-0000-4000-8000-00000000000a', '1HGCM82633A004352', 'trade'),
  ('5ea90000-0000-4000-8000-0000000001a2', '5ea90000-0000-4000-8000-00000000000a', '1FTFW1E51PFA00017', 'auction'),
  ('5ea90000-0000-4000-8000-0000000001b1', '5ea90000-0000-4000-8000-00000000000b', '1HGCM82633A004352', 'street_purchase')
ON CONFLICT (id) DO NOTHING;

-- AutoFilm repair orders carry no VIN; these refs let the adapter resolve one.
INSERT INTO public.vehicle_external_refs (tenant_id, instance_id, app, external_id)
VALUES
  ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-0000000001a1', 'autofilm', 'staging-ro-a-1'),
  ('5ea90000-0000-4000-8000-00000000000b', '5ea90000-0000-4000-8000-0000000001b1', 'autofilm', 'staging-ro-b-1')
ON CONFLICT (tenant_id, app, external_id) DO NOTHING;

INSERT INTO public.integration_connections
  (id, tenant_id, app, display_name, adapter, external_rooftop_ref, scopes, status)
VALUES
  ('5ea90000-0000-4000-8000-0000000000a1', '5ea90000-0000-4000-8000-00000000000a', 'autofilm',
   'Staging A native', 'rooftop.v1', NULL, ARRAY['inspection:write','repair:write'], 'active'),
  ('5ea90000-0000-4000-8000-0000000000a2', '5ea90000-0000-4000-8000-00000000000a', 'autofilm',
   'Staging A AutoFilm v1', 'autofilm.v1', 'rooftopos-staging-rooftop-a', ARRAY['inspection:write','repair:write'], 'active'),
  ('5ea90000-0000-4000-8000-0000000000a3', '5ea90000-0000-4000-8000-00000000000a', 'autofilm',
   'Staging A paused', 'rooftop.v1', NULL, ARRAY['inspection:write','repair:write'], 'paused'),
  ('5ea90000-0000-4000-8000-0000000000b1', '5ea90000-0000-4000-8000-00000000000b', 'autofilm',
   'Staging B native', 'rooftop.v1', NULL, ARRAY['inspection:write','repair:write'], 'active'),
  ('5ea90000-0000-4000-8000-0000000000b2', '5ea90000-0000-4000-8000-00000000000b', 'autofilm',
   'Staging B AutoFilm v1', 'autofilm.v1', 'rooftopos-staging-rooftop-b', ARRAY['inspection:write','repair:write'], 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.integration_direction_flags (tenant_id, direction, enabled)
VALUES
  ('5ea90000-0000-4000-8000-00000000000a', 'film_to_labels', true),
  ('5ea90000-0000-4000-8000-00000000000a', 'labels_to_film', true),
  ('5ea90000-0000-4000-8000-00000000000b', 'film_to_labels', true),
  ('5ea90000-0000-4000-8000-00000000000b', 'labels_to_film', true)
ON CONFLICT (tenant_id, direction) DO NOTHING;

-- Signing keys: 32 random bytes per key, generated here and stored only in Vault.
DO $$
DECLARE
  k record;
BEGIN
  FOR k IN
    SELECT * FROM (VALUES
      ('rooftopos-staging-a-native',   '5ea90000-0000-4000-8000-0000000000a1'::uuid),
      ('rooftopos-staging-a-autofilm', '5ea90000-0000-4000-8000-0000000000a2'::uuid),
      ('rooftopos-staging-a-paused',   '5ea90000-0000-4000-8000-0000000000a3'::uuid),
      ('rooftopos-staging-b-native',   '5ea90000-0000-4000-8000-0000000000b1'::uuid),
      ('rooftopos-staging-b-autofilm', '5ea90000-0000-4000-8000-0000000000b2'::uuid)
    ) AS v(key_id, connection_id)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = k.key_id) THEN
      PERFORM vault.create_secret(
        encode(extensions.gen_random_bytes(32), 'hex'),
        k.key_id,
        'RooftopOS staging synthetic signing key'
      );
    END IF;
    INSERT INTO public.integration_connection_keys (connection_id, key_id, vault_secret_name)
    VALUES (k.connection_id, k.key_id, k.key_id)
    ON CONFLICT (key_id) DO NOTHING;
  END LOOP;
END $$;

SELECT k.key_id, k.status AS key_status, c.id AS connection_id, c.adapter, c.status AS connection_status,
       c.external_rooftop_ref, t.slug AS tenant
FROM public.integration_connection_keys k
JOIN public.integration_connections c ON c.id = k.connection_id
JOIN public.tenants t ON t.id = c.tenant_id
WHERE k.key_id LIKE 'rooftopos-staging-%'
ORDER BY k.key_id;
