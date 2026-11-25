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
  source_version bigint,
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
  adapter         text NOT NULL DEFAULT 'rooftop.v1' CHECK (adapter IN ('rooftop.v1','autofilm.v1')),
  external_rooftop_ref text,
  scopes          text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','paused','revoked','error')),
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error_code text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (adapter <> 'autofilm.v1' OR (app = 'autofilm' AND external_rooftop_ref IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS integration_connections_tenant_idx ON public.integration_connections (tenant_id, app);
-- One live connection per external rooftop, so two dealers can never be mapped to the same AutoFilm rooftop.
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_external_ref_uniq
  ON public.integration_connections (app, external_rooftop_ref)
  WHERE external_rooftop_ref IS NOT NULL AND status <> 'revoked';

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
  source_version   bigint NOT NULL,
  vin              text,
  adapter          text NOT NULL DEFAULT 'rooftop.v1' CHECK (adapter IN ('rooftop.v1','autofilm.v1')),
  visibility           text NOT NULL DEFAULT 'tenant_private'
    CHECK (visibility IN ('tenant_private','custody_shared')),
  requested_visibility text NOT NULL DEFAULT 'tenant_private'
    CHECK (requested_visibility IN ('tenant_private','custody_shared','customer_public')),
  envelope         jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','held','applied','superseded','stale','conflict','rejected','unmatched','dead')),
  outcome_code     text,
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  claimed_until    timestamptz,
  received_at      timestamptz NOT NULL DEFAULT now(),
  applied_at       timestamptz,
  UNIQUE (connection_id, event_id),
  UNIQUE (connection_id, idempotency_key),
  CHECK (vin IS NOT NULL OR status = 'unmatched')
);
CREATE INDEX IF NOT EXISTS integration_inbox_status_idx ON public.integration_inbox (status, next_attempt_at, received_at);
CREATE INDEX IF NOT EXISTS integration_inbox_tenant_idx ON public.integration_inbox (tenant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.integration_source_versions (
  connection_id    uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  source_record_id text NOT NULL,
  latest_version   bigint NOT NULL,
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
  source_version      bigint NOT NULL,
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
  source_version         bigint NOT NULL,
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

-- Supabase auto-grants new public tables to anon and authenticated; strip that first so
-- client access is exactly the SELECT grants below, whatever the default privileges are.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicles','vehicle_instances','vehicle_external_refs','integration_connections',
    'integration_connection_keys','integration_inbox','integration_source_versions',
    'integration_outbox','integration_direction_flags','inspection_evidence','repair_items',
    'acquisition_records'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

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
  p_connection_id uuid, p_source_record_id text, p_version bigint
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
REVOKE ALL ON FUNCTION public.integration_record_source_version(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_record_source_version(uuid, text, bigint) TO service_role;

-- Secrets for every usable key of one active connection (dual-key overlap during rotation).
CREATE OR REPLACE FUNCTION public.integration_connection_secrets(p_connection_id uuid)
RETURNS TABLE (key_id text, secret text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT k.key_id, s.decrypted_secret
  FROM public.integration_connection_keys k
  JOIN public.integration_connections c ON c.id = k.connection_id
  JOIN vault.decrypted_secrets s ON s.name = k.vault_secret_name
  WHERE k.connection_id = p_connection_id
    AND k.status IN ('active','retiring')
    AND (k.not_after IS NULL OR k.not_after > now())
    AND c.status = 'active';
$$;
REVOKE ALL ON FUNCTION public.integration_connection_secrets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_connection_secrets(uuid) TO service_role;

-- Leases due inbox rows to one worker. SKIP LOCKED keeps concurrent workers from
-- claiming the same row; the lease (claimed_until) outlives this transaction.
-- Rows whose direction flag is off are demoted to held and never leased.
CREATE OR REPLACE FUNCTION public.integration_claim_inbox(p_limit integer, p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.integration_inbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.integration_inbox i
     SET status = 'held', outcome_code = 'direction_disabled'
   WHERE i.status = 'received'
     AND NOT EXISTS (
       SELECT 1 FROM public.integration_direction_flags f
       WHERE f.tenant_id = i.tenant_id AND f.enabled
         AND f.direction = CASE i.producer WHEN 'autofilm' THEN 'film_to_labels' WHEN 'autocurb' THEN 'curb_to_labels' END
     );

  RETURN QUERY
  WITH picked AS (
    SELECT i.id
    FROM public.integration_inbox i
    WHERE i.status IN ('received','held')
      AND i.next_attempt_at <= now()
      AND (i.claimed_until IS NULL OR i.claimed_until <= now())
      AND EXISTS (
        SELECT 1 FROM public.integration_direction_flags f
        WHERE f.tenant_id = i.tenant_id AND f.enabled
          AND f.direction = CASE i.producer WHEN 'autofilm' THEN 'film_to_labels' WHEN 'autocurb' THEN 'curb_to_labels' END
      )
    ORDER BY i.received_at, i.id
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.integration_inbox i
     SET claimed_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 1)),
         status = 'received'
    FROM picked
   WHERE i.id = picked.id
  RETURNING i.*;
END;
$$;
REVOKE ALL ON FUNCTION public.integration_claim_inbox(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_claim_inbox(integer, integer) TO service_role;

-- Applies one leased inbox row in a single transaction. The per-record watermark row
-- is locked first, so concurrent workers on the same (connection, record) serialize:
-- the version check, the effect write and the watermark bump can never interleave.
-- p_plan: {verdict: apply|noop|reject|unmatched, outcome, effect?}. The effect never
-- carries tenant, instance, source or version: those come from the locked inbox row.
CREATE OR REPLACE FUNCTION public.integration_apply_event(p_inbox_id uuid, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.integration_inbox%ROWTYPE;
  v_verdict text := p_plan->>'verdict';
  v_outcome text := COALESCE(p_plan->>'outcome', 'applied');
  v_effect jsonb := p_plan->'effect';
  v_latest bigint;
  v_instance uuid;
  v_status text;
BEGIN
  SELECT * INTO r FROM public.integration_inbox WHERE id = p_inbox_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  IF r.status NOT IN ('received','held') THEN
    RETURN jsonb_build_object('status', 'noop', 'current', r.status);
  END IF;

  IF v_verdict IN ('reject','unmatched') THEN
    UPDATE public.integration_inbox
       SET status = CASE v_verdict WHEN 'reject' THEN 'rejected' ELSE 'unmatched' END,
           outcome_code = v_outcome, attempts = attempts + 1, claimed_until = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object('status', CASE v_verdict WHEN 'reject' THEN 'rejected' ELSE 'unmatched' END, 'outcome', v_outcome);
  END IF;

  INSERT INTO public.integration_source_versions (connection_id, source_record_id, latest_version)
  VALUES (r.connection_id, r.source_record_id, 0)
  ON CONFLICT (connection_id, source_record_id) DO NOTHING;
  SELECT latest_version INTO v_latest FROM public.integration_source_versions
   WHERE connection_id = r.connection_id AND source_record_id = r.source_record_id FOR UPDATE;

  SELECT id INTO v_instance FROM public.vehicle_instances
   WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'active';
  IF v_instance IS NULL THEN
    UPDATE public.integration_inbox
       SET status = 'unmatched', outcome_code = 'no_active_instance', attempts = attempts + 1, claimed_until = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object('status', 'unmatched', 'outcome', 'no_active_instance');
  END IF;

  IF r.source_version <= v_latest THEN
    UPDATE public.integration_inbox
       SET status = 'superseded', outcome_code = 'stale_version', attempts = attempts + 1, claimed_until = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object('status', 'superseded', 'outcome', 'stale_version');
  END IF;

  IF v_verdict = 'apply' AND v_effect IS NOT NULL THEN
    IF v_effect->>'kind' = 'inspection_evidence_upsert' THEN
      INSERT INTO public.inspection_evidence AS e (
        tenant_id, instance_id, source_app, source_record_id, source_version, visibility,
        inspected_at, odometer_miles, measurements, evidence_refs, technician_verified, revoked_at)
      VALUES (
        r.tenant_id, v_instance, r.producer, r.source_record_id, r.source_version, r.visibility,
        (v_effect->>'inspected_at')::timestamptz,
        (v_effect->>'odometer_miles')::integer,
        COALESCE(v_effect->'measurements', '{}'::jsonb),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_effect->'evidence_refs')), '{}'::text[]),
        COALESCE((v_effect->>'technician_verified')::boolean, false),
        (v_effect->>'revoked_at')::timestamptz)
      ON CONFLICT (tenant_id, source_app, source_record_id) DO UPDATE SET
        source_version = EXCLUDED.source_version,
        visibility = EXCLUDED.visibility,
        inspected_at = CASE WHEN v_effect ? 'revoked_at' THEN e.inspected_at ELSE EXCLUDED.inspected_at END,
        odometer_miles = CASE WHEN v_effect ? 'revoked_at' THEN e.odometer_miles ELSE EXCLUDED.odometer_miles END,
        measurements = CASE WHEN v_effect ? 'revoked_at' THEN e.measurements ELSE EXCLUDED.measurements END,
        evidence_refs = CASE WHEN v_effect ? 'revoked_at' THEN e.evidence_refs ELSE EXCLUDED.evidence_refs END,
        technician_verified = CASE WHEN v_effect ? 'revoked_at' THEN e.technician_verified ELSE EXCLUDED.technician_verified END,
        revoked_at = COALESCE(EXCLUDED.revoked_at, e.revoked_at)
      WHERE e.source_version < EXCLUDED.source_version;
    ELSIF v_effect->>'kind' = 'repair_item_upsert' THEN
      INSERT INTO public.repair_items AS ri (
        tenant_id, instance_id, source_app, source_record_id, source_version, visibility,
        status, finding_ref, item, severity, verified_by, verified_evidence_ref)
      VALUES (
        r.tenant_id, v_instance, r.producer, r.source_record_id, r.source_version, r.visibility,
        v_effect->>'status', v_effect->>'finding_ref', v_effect->>'item', v_effect->>'severity',
        v_effect->>'verified_by', v_effect->>'verified_evidence_ref')
      ON CONFLICT (tenant_id, source_app, source_record_id) DO UPDATE SET
        source_version = EXCLUDED.source_version,
        visibility = EXCLUDED.visibility,
        status = EXCLUDED.status,
        finding_ref = COALESCE(EXCLUDED.finding_ref, ri.finding_ref),
        item = COALESCE(EXCLUDED.item, ri.item),
        severity = COALESCE(EXCLUDED.severity, ri.severity),
        verified_by = EXCLUDED.verified_by,
        verified_evidence_ref = EXCLUDED.verified_evidence_ref
      WHERE ri.source_version < EXCLUDED.source_version;
    ELSE
      RAISE EXCEPTION 'unknown_effect_kind';
    END IF;
  END IF;

  UPDATE public.integration_source_versions
     SET latest_version = r.source_version, updated_at = now()
   WHERE connection_id = r.connection_id AND source_record_id = r.source_record_id;

  v_status := 'applied';
  UPDATE public.integration_inbox
     SET status = v_status, outcome_code = v_outcome, attempts = attempts + 1,
         applied_at = now(), claimed_until = NULL
   WHERE id = r.id;
  RETURN jsonb_build_object('status', v_status, 'outcome', v_outcome);
END;
$$;
REVOKE ALL ON FUNCTION public.integration_apply_event(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_apply_event(uuid, jsonb) TO service_role;

-- Records a failed attempt: releases the lease, schedules the retry, or dead-letters.
CREATE OR REPLACE FUNCTION public.integration_fail_inbox(
  p_inbox_id uuid, p_error_code text, p_delay_seconds integer, p_dead boolean
) RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.integration_inbox
     SET attempts = attempts + 1,
         outcome_code = left(p_error_code, 64),
         claimed_until = NULL,
         next_attempt_at = now() + make_interval(secs => GREATEST(p_delay_seconds, 0)),
         status = CASE WHEN p_dead THEN 'dead' ELSE status END
   WHERE id = p_inbox_id AND status IN ('received','held')
  RETURNING attempts;
$$;
REVOKE ALL ON FUNCTION public.integration_fail_inbox(uuid, text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_fail_inbox(uuid, text, integer, boolean) TO service_role;
