-- PROPOSED (Admin 96). Not applied. Requires owner approval before apply.
--
-- Adds the shared dealership fields the Admin 96 editors need and that no
-- table holds today:
--   1. dealer_department_contacts: one row per department phone, tenant- or
--      rooftop-scoped. Lives next to onboarding_profiles so AutoLabels and
--      AutoFilm read the same numbers instead of keeping two copies.
--   2. dealer_business_hours: structured weekly hours, IANA timezone,
--      holidays and an optional routing override, with a version column for
--      optimistic concurrency.
--   3. onboarding_profiles.legal_name / logo_dark_url / brand_palette: the
--      shared cross-app profile gains the legal-vs-display split, the dark
--      logo and a named HEX palette.
-- Writes go through SECURITY DEFINER RPCs gated by tenant_role_in() with the
-- settings roles, and every write is audited. Reads use RLS in the canonical
-- (SELECT auth.uid()) / TO authenticated shape.

BEGIN;

-- 1. Department contacts ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dealer_department_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      uuid REFERENCES public.dealer_stores(id) ON DELETE CASCADE,
  department    text NOT NULL CHECK (department IN
                  ('main','sales','service','parts','finance','body_shop','used','fleet','other')),
  label         text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  phone_e164    text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  extension     text CHECK (extension IS NULL OR extension ~ '^[0-9]{1,8}$'),
  is_primary    boolean NOT NULL DEFAULT false,
  public_visible boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS dealer_department_contacts_one_primary
  ON public.dealer_department_contacts (tenant_id, store_id)
  NULLS NOT DISTINCT
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS dealer_department_contacts_scope
  ON public.dealer_department_contacts (tenant_id, store_id, sort_order);

ALTER TABLE public.dealer_department_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read department contacts"
  ON public.dealer_department_contacts FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT ON public.dealer_department_contacts TO authenticated;

-- 2. Business hours --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dealer_business_hours (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id         uuid REFERENCES public.dealer_stores(id) ON DELETE CASCADE,
  department       text NOT NULL DEFAULT 'sales' CHECK (department IN
                     ('sales','service','parts','finance','body_shop')),
  timezone         text NOT NULL CHECK (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2}$'),
  weekly           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(weekly) = 'object'),
  holidays         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(holidays) = 'array'),
  routing_override jsonb CHECK (routing_override IS NULL OR jsonb_typeof(routing_override) = 'object'),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS dealer_business_hours_scope
  ON public.dealer_business_hours (tenant_id, store_id, department)
  NULLS NOT DISTINCT;

ALTER TABLE public.dealer_business_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read business hours"
  ON public.dealer_business_hours FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT ON public.dealer_business_hours TO authenticated;

-- 3. Shared profile columns ------------------------------------------------

ALTER TABLE public.onboarding_profiles
  ADD COLUMN IF NOT EXISTS legal_name    text CHECK (legal_name IS NULL OR length(trim(legal_name)) BETWEEN 2 AND 160),
  ADD COLUMN IF NOT EXISTS logo_dark_url text,
  ADD COLUMN IF NOT EXISTS brand_palette jsonb CHECK (brand_palette IS NULL OR jsonb_typeof(brand_palette) = 'array');

-- 4. Write RPCs ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin96_assert_store(p_tenant_id uuid, p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_store_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dealer_stores s WHERE s.id = p_store_id AND s.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'store_not_in_tenant' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_department_contacts(
  p_tenant_id uuid,
  p_store_id  uuid,
  p_contacts  jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_prev  jsonb;
  v_count integer;
BEGIN
  IF NOT public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm','manager']) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.admin96_assert_store(p_tenant_id, p_store_id);
  IF jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'contacts_must_be_array' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.sort_order), '[]'::jsonb) INTO v_prev
  FROM public.dealer_department_contacts c
  WHERE c.tenant_id = p_tenant_id AND c.store_id IS NOT DISTINCT FROM p_store_id;

  DELETE FROM public.dealer_department_contacts
  WHERE tenant_id = p_tenant_id AND store_id IS NOT DISTINCT FROM p_store_id;

  INSERT INTO public.dealer_department_contacts
    (tenant_id, store_id, department, label, phone_e164, extension, is_primary, public_visible, sort_order, updated_by)
  SELECT p_tenant_id, p_store_id,
         e->>'department', e->>'label', e->>'phone_e164', nullif(e->>'extension', ''),
         coalesce((e->>'is_primary')::boolean, false),
         coalesce((e->>'public_visible')::boolean, true),
         (ord - 1)::integer, v_uid
  FROM jsonb_array_elements(p_contacts) WITH ORDINALITY AS t(e, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('department_contacts_saved', 'tenant', p_tenant_id::text,
          coalesce(p_store_id, p_tenant_id)::text, v_uid,
          jsonb_build_object('store_id', p_store_id, 'prev', v_prev, 'next', p_contacts));
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_business_hours(
  p_tenant_id        uuid,
  p_store_id         uuid,
  p_department       text,
  p_timezone         text,
  p_weekly           jsonb,
  p_holidays         jsonb,
  p_routing_override jsonb,
  p_expected_version integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_row  public.dealer_business_hours%ROWTYPE;
  v_next integer;
BEGIN
  IF NOT public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm','manager']) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.admin96_assert_store(p_tenant_id, p_store_id);
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.dealer_business_hours
  WHERE tenant_id = p_tenant_id AND store_id IS NOT DISTINCT FROM p_store_id AND department = p_department
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_version IS DISTINCT FROM v_row.version THEN
      RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
    END IF;
    v_next := v_row.version + 1;
    UPDATE public.dealer_business_hours
       SET timezone = p_timezone, weekly = p_weekly, holidays = coalesce(p_holidays, '[]'::jsonb),
           routing_override = p_routing_override, version = v_next,
           updated_at = now(), updated_by = v_uid
     WHERE id = v_row.id;
  ELSE
    IF p_expected_version IS NOT NULL AND p_expected_version <> 0 THEN
      RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001';
    END IF;
    v_next := 1;
    INSERT INTO public.dealer_business_hours
      (tenant_id, store_id, department, timezone, weekly, holidays, routing_override, version, updated_by)
    VALUES (p_tenant_id, p_store_id, p_department, p_timezone, p_weekly,
            coalesce(p_holidays, '[]'::jsonb), p_routing_override, 1, v_uid);
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('business_hours_saved', 'tenant', p_tenant_id::text,
          coalesce(p_store_id, p_tenant_id)::text, v_uid,
          jsonb_build_object('store_id', p_store_id, 'department', p_department,
                             'prev', CASE WHEN v_row.id IS NULL THEN NULL ELSE to_jsonb(v_row) END,
                             'version', v_next));
  RETURN v_next;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_shared_brand_profile(
  p_tenant_id     uuid,
  p_legal_name    text,
  p_logo_dark_url text,
  p_brand_palette jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_prev jsonb;
BEGIN
  IF NOT public.tenant_role_in(p_tenant_id, ARRAY['owner','admin','general_manager','gsm','manager']) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_brand_palette IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_brand_palette) e
    WHERE NOT (e->>'hex') ~ '^#[0-9A-Fa-f]{6}$' OR length(trim(coalesce(e->>'name', ''))) = 0
  ) THEN
    RAISE EXCEPTION 'invalid_palette' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object('legal_name', legal_name, 'logo_dark_url', logo_dark_url, 'brand_palette', brand_palette)
    INTO v_prev FROM public.onboarding_profiles WHERE tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.onboarding_profiles
     SET legal_name = nullif(trim(p_legal_name), ''),
         logo_dark_url = nullif(trim(p_logo_dark_url), ''),
         brand_palette = p_brand_palette,
         updated_at = now()
   WHERE tenant_id = p_tenant_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('shared_brand_profile_saved', 'tenant', p_tenant_id::text, p_tenant_id::text, v_uid,
          jsonb_build_object('prev', v_prev,
                             'next', jsonb_build_object('legal_name', p_legal_name, 'logo_dark_url', p_logo_dark_url,
                                                        'brand_palette', p_brand_palette)));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin96_assert_store(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_department_contacts(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_business_hours(uuid, uuid, text, text, jsonb, jsonb, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_shared_brand_profile(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_department_contacts(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_business_hours(uuid, uuid, text, text, jsonb, jsonb, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_shared_brand_profile(uuid, text, text, jsonb) TO authenticated;

COMMIT;
