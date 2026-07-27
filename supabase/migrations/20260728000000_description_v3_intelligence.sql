-- ─────────────────────────────────────────────────────────────────────
-- Description V3 — multi-channel intelligence layer.
--
-- Strictly additive. Every existing description case, version, channel
-- variant and validation result is preserved untouched; approved and
-- published copy keeps the exact content, scores and approval state it
-- already carried.
--
-- What this adds:
--   1. description_voice_profiles  — versioned, approval-gated store voice
--   2. description_channel_policies — per-tenant channel policy overrides
--   3. description_feature_selections — the canonical feature set that
--      produced a given version, with origin and priority preserved
--   4. Governance columns on versions/channel variants: tone, targeting,
--      voice + policy versions, real score breakdowns, input checksum
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Dealership voice profile ──────────────────────────────────────
-- Versioned because an approved description must keep the voice it was
-- written under. Editing the store's claims marks descendants stale; it
-- never rewrites what a manager already approved.
CREATE TABLE IF NOT EXISTS public.description_voice_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version       text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','archived')),
  profile_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Denormalized for the operations list; profile_json stays authoritative.
  dealer_name   text,
  city          text,
  state         text,
  approved_claims text[] NOT NULL DEFAULT '{}',
  change_reason text,
  created_by    uuid REFERENCES auth.users(id),
  approved_by   uuid REFERENCES auth.users(id),
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_voice_profiles_tenant
  ON public.description_voice_profiles (tenant_id, status, created_at DESC);
-- At most one approved profile per tenant: two "current" voices is the same
-- ambiguity as two truths.
CREATE UNIQUE INDEX IF NOT EXISTS uq_description_voice_profile_approved
  ON public.description_voice_profiles (tenant_id) WHERE status = 'approved';

-- ── 2. Channel policy overrides ──────────────────────────────────────
-- The shipped policy is the floor. A tenant may narrow it; delivery mode and
-- connector status are deliberately NOT stored here, because a tenant able to
-- declare a connector could make the UI report a publication that never
-- happened. Connector truth stays a platform fact in code.
CREATE TABLE IF NOT EXISTS public.description_channel_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel       text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  policy_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version text,
  last_reviewed timestamptz,
  reviewed_by   uuid REFERENCES auth.users(id),
  change_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_channel_policies_tenant_channel_key UNIQUE (tenant_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_description_channel_policies_tenant
  ON public.description_channel_policies (tenant_id, channel);

-- ── 3. Feature selection per version ─────────────────────────────────
-- The audit answer to "why does this description mention that?". Every
-- normalized feature the packet considered is recorded — selected or not —
-- with its origin, source, confidence and the reason it was kept or dropped.
CREATE TABLE IF NOT EXISTS public.description_feature_selections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  version_id          uuid REFERENCES public.description_versions(id) ON DELETE CASCADE,
  canonical_feature_id text NOT NULL,
  display_name        text NOT NULL,
  category            text NOT NULL,
  origin              text NOT NULL
                        CHECK (origin IN ('factory_standard','factory_option','factory_package','dealer_added')),
  source              text,
  confidence          integer,
  package_id          text,
  package_name        text,
  conflict            boolean NOT NULL DEFAULT false,
  description_eligible boolean NOT NULL DEFAULT true,
  public_eligible     boolean NOT NULL DEFAULT true,
  priority_rank       integer,
  priority_score      numeric,
  selected            boolean NOT NULL DEFAULT false,
  selection_reason    text,
  selection_actor     text NOT NULL DEFAULT 'automation'
                        CHECK (selection_actor IN ('automation','user')),
  selection_user_id   uuid REFERENCES auth.users(id),
  aliases_seen        text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_feature_selections_version
  ON public.description_feature_selections (version_id, selected, priority_rank);
CREATE INDEX IF NOT EXISTS idx_description_feature_selections_case
  ON public.description_feature_selections (description_case_id, created_at DESC);

-- ── 4. Governance columns on the existing version tables ─────────────
-- Added, never replacing. quality_score keeps its meaning for historical
-- rows; score_breakdown_json is where the CALCULATED result lives from here
-- on, and a row without one is honestly "not scored under V3" rather than
-- silently presented as if it were.
ALTER TABLE public.description_versions
  ADD COLUMN IF NOT EXISTS tone                    text,
  ADD COLUMN IF NOT EXISTS seo_targeting_json      jsonb,
  ADD COLUMN IF NOT EXISTS voice_profile_version   text,
  ADD COLUMN IF NOT EXISTS channel_policy_version  text,
  ADD COLUMN IF NOT EXISTS selected_feature_checksum text,
  ADD COLUMN IF NOT EXISTS input_checksum          text,
  ADD COLUMN IF NOT EXISTS score_breakdown_json    jsonb,
  ADD COLUMN IF NOT EXISTS readability_json        jsonb,
  ADD COLUMN IF NOT EXISTS uniqueness_json         jsonb,
  ADD COLUMN IF NOT EXISTS score_version           text,
  ADD COLUMN IF NOT EXISTS read_time_seconds       integer;

-- The reuse lookup is (case, input_checksum) — index it or every generation
-- request scans the case's whole version history before deciding to reuse.
CREATE INDEX IF NOT EXISTS idx_description_versions_input_checksum
  ON public.description_versions (description_case_id, input_checksum)
  WHERE input_checksum IS NOT NULL;

-- 'recorded' is a new, deliberately distinct delivery status: an operator took
-- a copy of a stored version. It is NOT 'delivered' and must never be counted
-- as one, which is exactly why it needs its own value rather than reusing
-- 'skipped' or 'delivered'.
ALTER TABLE public.description_deliveries
  DROP CONSTRAINT IF EXISTS description_deliveries_status_check;
ALTER TABLE public.description_deliveries
  ADD CONSTRAINT description_deliveries_status_check
  CHECK (status IN ('pending','queued','delivered','failed','skipped','unavailable','recorded'));

ALTER TABLE public.description_channel_versions
  ADD COLUMN IF NOT EXISTS channel_policy_version text,
  ADD COLUMN IF NOT EXISTS score_breakdown_json   jsonb,
  ADD COLUMN IF NOT EXISTS quality_score          integer,
  ADD COLUMN IF NOT EXISTS word_count             integer,
  ADD COLUMN IF NOT EXISTS read_time_seconds      integer;

-- ── 5. updated_at triggers ───────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_voice_profiles','description_channel_policies'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at_%1$s ON public.%1$s;
       CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t);
  END LOOP;
END $$;

-- ── 6. RLS — tenant isolation, canonical shape ───────────────────────
-- (SELECT auth.uid()) is wrapped so the planner caches it as an initPlan
-- instead of re-evaluating per row, and TO authenticated lets it skip the
-- policy entirely for anon connections.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_voice_profiles','description_channel_policies',
                           'description_feature_selections'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_members_read') THEN
      EXECUTE format($f$
        CREATE POLICY "tenant_members_read" ON public.%I FOR SELECT TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));$f$, t);
    END IF;
  END LOOP;
END $$;

-- Feature selections are written by the generator (service role) only. A
-- browser that could insert a selection row could assert that an unsupported
-- feature was chosen from the truth snapshot, which is exactly the bypass
-- Phase 3 exists to close. Read-only for members; no client write policy.

-- Voice profiles and channel policies ARE configuration a manager edits, but
-- only through the guarded RPCs below — a direct table write would skip the
-- approval, versioning and audit trail.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_voice_profiles','description_channel_policies',
                           'description_feature_selections'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated;', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC — save a voice profile revision.
--
-- Never mutates an approved row. A change always produces a NEW row and
-- archives the previous approved one, so every historical description can
-- still resolve the exact voice it was written under.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_description_voice_profile(
  p_tenant_id uuid,
  p_profile   jsonb,
  p_version   text,
  p_approve   boolean DEFAULT false,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT lower(trim(role)) INTO v_role
  FROM public.tenant_members
  WHERE tenant_id = p_tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_member');
  END IF;
  -- Approving a voice profile approves what the store is allowed to CLAIM
  -- about itself. That is a management decision, not a content edit.
  IF v_role NOT IN ('owner','general_manager','gsm','admin','manager','compliance') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permission');
  END IF;

  IF p_approve THEN
    UPDATE public.description_voice_profiles
       SET status = 'archived', updated_at = now()
     WHERE tenant_id = p_tenant_id AND status = 'approved';
  END IF;

  INSERT INTO public.description_voice_profiles (
    tenant_id, version, status, profile_json, dealer_name, city, state,
    approved_claims, change_reason, created_by,
    approved_by, approved_at
  ) VALUES (
    p_tenant_id, p_version, CASE WHEN p_approve THEN 'approved' ELSE 'draft' END,
    COALESCE(p_profile, '{}'::jsonb),
    NULLIF(p_profile->>'dealerName',''), NULLIF(p_profile->>'city',''), NULLIF(p_profile->>'state',''),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_profile->'approvedClaims')), '{}'),
    p_reason, v_uid,
    CASE WHEN p_approve THEN v_uid END,
    CASE WHEN p_approve THEN now() END
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('voice_profile_changed', 'description_voice_profile', v_id, p_tenant_id,
          jsonb_build_object('version', p_version, 'approved', p_approve, 'reason', p_reason,
                             'actor_role', v_role));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'version', p_version,
                            'status', CASE WHEN p_approve THEN 'approved' ELSE 'draft' END);
END;
$$;

REVOKE ALL ON FUNCTION public.save_description_voice_profile(uuid, jsonb, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_description_voice_profile(uuid, jsonb, text, boolean, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- RPC — upsert a tenant channel policy override.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_description_channel_policy(
  p_tenant_id uuid,
  p_channel   text,
  p_policy    jsonb,
  p_active    boolean DEFAULT true,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT lower(trim(role)) INTO v_role
  FROM public.tenant_members
  WHERE tenant_id = p_tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_member');
  END IF;
  IF v_role NOT IN ('owner','general_manager','gsm','admin','manager','compliance') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permission');
  END IF;

  -- Delivery truth is not tenant-editable. Strip it here as well as in code,
  -- so a direct RPC call cannot claim a connector the platform does not have.
  p_policy := COALESCE(p_policy, '{}'::jsonb) - 'deliveryMode' - 'connectorStatus'
              - 'htmlAllowed' - 'seoFields' - 'limitVerified';

  INSERT INTO public.description_channel_policies (
    tenant_id, channel, active, policy_json, policy_version,
    last_reviewed, reviewed_by, change_reason
  ) VALUES (
    p_tenant_id, p_channel, COALESCE(p_active, true), p_policy,
    NULLIF(p_policy->>'policyVersion',''), now(), v_uid, p_reason
  )
  ON CONFLICT (tenant_id, channel) DO UPDATE SET
    active         = EXCLUDED.active,
    policy_json    = EXCLUDED.policy_json,
    policy_version = EXCLUDED.policy_version,
    last_reviewed  = now(),
    reviewed_by    = EXCLUDED.reviewed_by,
    change_reason  = EXCLUDED.change_reason,
    updated_at     = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('channel_policy_changed', 'description_channel_policy', v_id, p_tenant_id,
          jsonb_build_object('channel', p_channel, 'active', p_active, 'reason', p_reason,
                             'actor_role', v_role));

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'channel', p_channel);
END;
$$;

REVOKE ALL ON FUNCTION public.save_description_channel_policy(uuid, text, jsonb, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_description_channel_policy(uuid, text, jsonb, boolean, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- RPC — record a Save-to-Vehicle / export event against an EXACT version.
--
-- "Save to Vehicle" and "Download" are the two actions most likely to be
-- mistaken for publication. Neither may mutate content, neither regenerates,
-- and neither may target an approved version's content — they only record
-- which stored version the user took.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_description_output_use(
  p_version_id  uuid,
  p_channel     text,
  p_action      text,
  p_destination text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_ver   public.description_versions%ROWTYPE;
  v_ok    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_action NOT IN ('saved_to_vehicle','exported','copied') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_action');
  END IF;

  SELECT * INTO v_ver FROM public.description_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_ver.tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL
  ) INTO v_ok;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- Deliberately a delivery row with status 'recorded', never 'delivered':
  -- taking a copy of the text is not a publication and must never read as one.
  INSERT INTO public.description_deliveries (
    tenant_id, vehicle_id, description_case_id, version_id, destination,
    delivery_mode, connector_status, status, idempotency_key, response_metadata
  ) VALUES (
    v_ver.tenant_id, v_ver.vehicle_id, v_ver.description_case_id, p_version_id,
    COALESCE(p_destination, p_channel, 'manual_export'),
    'export_only', 'export_only', 'recorded',
    p_version_id::text || ':' || p_action || ':' || COALESCE(p_channel,'master') || ':' || v_uid::text,
    jsonb_build_object('action', p_action, 'channel', p_channel,
                       'note', 'Operator took a copy of a stored version. No delivery was performed.')
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('description_' || p_action, 'description_version', p_version_id, v_ver.tenant_id,
          jsonb_build_object('channel', p_channel, 'version_number', v_ver.version_number,
                             'destination', p_destination));

  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id,
                            'version_number', v_ver.version_number, 'action', p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.record_description_output_use(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_description_output_use(uuid, text, text, text) TO authenticated;

-- ── 7. Canonical features on the truth snapshot ──────────────────────
-- The flat `facts_json.equipment` string cannot express origin, so it cannot
-- answer "is this factory or dealer-installed?" — the one question that makes
-- an equipment statement true or false. The canonical set lives alongside it.
ALTER TABLE public.description_fact_snapshots
  ADD COLUMN IF NOT EXISTS features_json jsonb NOT NULL DEFAULT '{}'::jsonb;
