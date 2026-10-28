-- RooftopOS integration spine (Phase 1). Purely additive: new tables only.
-- Everything is dormant until ROOFTOP_INTEGRATIONS_ENABLED is set on the edge
-- functions and a tenant's per-direction flag row is switched on.

-- Global VIN identity. Facts only: no tenant, price or person data.
CREATE TABLE IF NOT EXISTS public.vehicles (
  vin           text PRIMARY KEY CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- One custody episode of a VIN inside one tenant. A sell and reacquire is two rows.
CREATE TABLE IF NOT EXISTS public.vehicle_instances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin                 text NOT NULL REFERENCES public.vehicles(vin),
  store_id            uuid,
  acquired_at         timestamptz,
  acquisition_channel text NOT NULL DEFAULT 'unknown'
    CHECK (acquisition_channel IN ('trade','auction','street_purchase','transfer','new_allocation','unknown')),
  disposed_at         timestamptz,
  disposition         text
    CHECK (disposition IS NULL OR disposition IN ('retail_sale','wholesale','transfer','return','cancelled')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_instances_one_active_per_tenant_vin
  ON public.vehicle_instances (tenant_id, vin) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS vehicle_instances_vin_idx ON public.vehicle_instances (vin);

CREATE TABLE IF NOT EXISTS public.vehicle_external_refs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id    uuid NOT NULL,
  app            text NOT NULL CHECK (app IN ('autolabels','autofilm','autocurb','dms')),
  external_id    text NOT NULL,
  source_version integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, app, external_id),
  FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS vehicle_external_refs_instance_idx ON public.vehicle_external_refs (instance_id);

CREATE TABLE IF NOT EXISTS public.integration_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app             text NOT NULL CHECK (app IN ('autofilm','autocurb')),
  display_name    text NOT NULL,
  endpoint_url    text,
  scopes          text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','paused','revoked','error')),
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error_code text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_connections_tenant_idx ON public.integration_connections (tenant_id, app);

-- Key metadata only. The secret lives in Vault under vault_secret_name.
CREATE TABLE IF NOT EXISTS public.integration_connection_keys (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  key_id            text NOT NULL UNIQUE,
  vault_secret_name text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retiring','revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  not_after         timestamptz,
  revoked_at        timestamptz
);
CREATE INDEX IF NOT EXISTS integration_connection_keys_conn_idx ON public.integration_connection_keys (connection_id);
ALTER TABLE public.integration_connection_keys ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.integration_key_secret(p_key_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT s.decrypted_secret
  FROM public.integration_connection_keys k
  JOIN public.integration_connections c ON c.id = k.connection_id
  JOIN vault.decrypted_secrets s ON s.name = k.vault_secret_name
  WHERE k.key_id = p_key_id
    AND k.status IN ('active','retiring')
    AND (k.not_after IS NULL OR k.not_after > now())
    AND c.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.integration_key_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_key_secret(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.integration_inbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  producer         text NOT NULL,
  event_id         uuid NOT NULL,
  event_type       text NOT NULL,
  schema_version   text NOT NULL,
  idempotency_key  text NOT NULL,
  payload_checksum text NOT NULL,
  source_record_id text NOT NULL,
  source_version   integer NOT NULL,
  vin              text NOT NULL,
  visibility           text NOT NULL DEFAULT 'tenant_private',
  requested_visibility text NOT NULL DEFAULT 'tenant_private',
  envelope         jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','held','applied','stale','conflict','rejected','unmatched','dead')),
  outcome_code     text,
  attempts         integer NOT NULL DEFAULT 0,
  received_at      timestamptz NOT NULL DEFAULT now(),
  applied_at       timestamptz,
  UNIQUE (connection_id, event_id),
  UNIQUE (connection_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS integration_inbox_status_idx ON public.integration_inbox (status, received_at);
CREATE INDEX IF NOT EXISTS integration_inbox_tenant_idx ON public.integration_inbox (tenant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.integration_source_versions (
  connection_id    uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  source_record_id text NOT NULL,
  latest_version   integer NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, source_record_id)
);

CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connection_id   uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL UNIQUE,
  event_type      text NOT NULL,
  envelope        jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','delivered','dead')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_outbox_due_idx ON public.integration_outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS integration_outbox_tenant_idx ON public.integration_outbox (tenant_id);

CREATE TABLE IF NOT EXISTS public.integration_direction_flags (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  direction  text NOT NULL CHECK (direction IN
    ('labels_to_film','film_to_labels','labels_to_curb','curb_to_labels','film_to_curb','curb_to_film')),
  enabled    boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, direction)
);

CREATE TABLE IF NOT EXISTS public.inspection_evidence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id         uuid NOT NULL,
  source_app          text NOT NULL,
  source_record_id    text NOT NULL,
  source_version      integer NOT NULL,
  inspected_at        timestamptz,
  odometer_miles      integer,
  measurements        jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs       text[] NOT NULL DEFAULT '{}',
  technician_verified boolean NOT NULL DEFAULT false,
  visibility          text NOT NULL DEFAULT 'tenant_private'
    CHECK (visibility IN ('tenant_private','custody_shared','customer_public')),
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_app, source_record_id),
  FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS inspection_evidence_instance_idx ON public.inspection_evidence (instance_id);

CREATE TABLE IF NOT EXISTS public.repair_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id            uuid NOT NULL,
  source_app             text NOT NULL,
  source_record_id       text NOT NULL,
  finding_ref            text,
  item                   text,
  severity               text,
  status                 text NOT NULL
    CHECK (status IN ('recommended','approved','declined','deferred','completed','completed_verified')),
  verified_by            text,
  verified_evidence_ref  text,
  visibility             text NOT NULL DEFAULT 'tenant_private'
    CHECK (visibility IN ('tenant_private','custody_shared','customer_public')),
  source_version         integer NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_app, source_record_id),
  CHECK (status <> 'completed_verified' OR verified_evidence_ref IS NOT NULL),
  FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS repair_items_instance_idx ON public.repair_items (instance_id);

-- Acquisition and appraisal cost is private: service role only.
CREATE TABLE IF NOT EXISTS public.acquisition_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id      uuid NOT NULL,
  channel          text,
  appraised_at     timestamptz,
  appraisal_value  numeric,
  acquisition_cost numeric,
  source_record_id text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS acquisition_records_instance_idx ON public.acquisition_records (instance_id);
ALTER TABLE public.acquisition_records ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped read access. No client write policies exist anywhere in the spine.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicle_instances','vehicle_external_refs','integration_connections','integration_inbox',
    'integration_outbox','integration_direction_flags','inspection_evidence','repair_items'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))',
      t || '_tenant_select', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'vehicles','vehicle_instances','vehicle_external_refs','integration_connections',
    'integration_connection_keys','integration_inbox','integration_source_versions',
    'integration_outbox','integration_direction_flags','inspection_evidence','repair_items',
    'acquisition_records'
  ] LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

ALTER TABLE public.integration_source_versions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vehicle_instances_set_updated_at ON public.vehicle_instances;
CREATE TRIGGER vehicle_instances_set_updated_at BEFORE UPDATE ON public.vehicle_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS integration_connections_set_updated_at ON public.integration_connections;
CREATE TRIGGER integration_connections_set_updated_at BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS repair_items_set_updated_at ON public.repair_items;
CREATE TRIGGER repair_items_set_updated_at BEFORE UPDATE ON public.repair_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Monotonic per-record version watermark: concurrent workers can never lower it.
CREATE OR REPLACE FUNCTION public.integration_record_source_version(
  p_connection_id uuid, p_source_record_id text, p_version integer
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.integration_source_versions (connection_id, source_record_id, latest_version, updated_at)
  VALUES (p_connection_id, p_source_record_id, p_version, now())
  ON CONFLICT (connection_id, source_record_id) DO UPDATE
    SET latest_version = GREATEST(public.integration_source_versions.latest_version, EXCLUDED.latest_version),
        updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.integration_record_source_version(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_record_source_version(uuid, text, integer) TO service_role;
