-- Applied from supabase/migrations/20260909103000_apply_title_verification_backlog.sql
-- This migration is applied unchanged per request.

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS title_verification jsonb;

COMMENT ON COLUMN public.vehicle_listings.title_verification IS
  'Dealer NMVTIS title attestation shown on the passport: { status: clean|branded, verified_at, verified_by, source, report_generated_at, report_expires_at, brand_note }. Written only on explicit dealer action; never contains raw NMVTIS rows.';

CREATE TABLE IF NOT EXISTS public.title_report_pulls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin           text NOT NULL,
  action        text NOT NULL,
  charged       boolean NOT NULL DEFAULT false,
  unit_cost     numeric(6,2) NOT NULL DEFAULT 0,
  pulled_by     uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_title_report_pulls_tenant_time
  ON public.title_report_pulls (tenant_id, created_at DESC);

ALTER TABLE public.title_report_pulls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.title_report_pulls'::regclass
       AND polname  = 'title_report_pulls tenant read'
  ) THEN
    CREATE POLICY "title_report_pulls tenant read"
      ON public.title_report_pulls FOR SELECT
      TO authenticated
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_members
          WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

DO $$
DECLARE
  v_policy_cmd  "char";
  v_policy_role boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vehicle_listings'
       AND column_name = 'title_verification' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'vehicle_listings.title_verification is missing or is not jsonb';
  END IF;

  IF to_regclass('public.title_report_pulls') IS NULL THEN
    RAISE EXCEPTION 'title_report_pulls was not created';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'title_report_pulls'
       AND column_name IN ('id','tenant_id','vin','action','charged','unit_cost','pulled_by','created_at')
  ) <> 8 THEN
    RAISE EXCEPTION 'title_report_pulls is missing one of the columns the meter reads';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.title_report_pulls'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on title_report_pulls';
  END IF;

  SELECT p.polcmd,
         EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = ANY(p.polroles) AND r.rolname = 'authenticated')
    INTO v_policy_cmd, v_policy_role
    FROM pg_policy p
   WHERE p.polrelid = 'public.title_report_pulls'::regclass
     AND p.polname  = 'title_report_pulls tenant read';

  IF v_policy_cmd IS NULL THEN
    RAISE EXCEPTION 'the title_report_pulls tenant read policy is missing';
  END IF;
  IF v_policy_cmd <> 'r' OR NOT v_policy_role THEN
    RAISE EXCEPTION 'the title_report_pulls read policy is not a SELECT policy TO authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.title_report_pulls'::regclass
       AND polcmd <> 'r'
  ) THEN
    RAISE EXCEPTION 'title_report_pulls has a write policy; only the service role may append to the meter';
  END IF;

  IF to_regclass('public.title_reports') IS NOT NULL THEN
    RAISE EXCEPTION 'title_reports exists; the VINData terms forbid persisting the provider response';
  END IF;

  IF (SELECT count(*) FROM public.title_report_pulls) <> 0 THEN
    RAISE EXCEPTION 'title_report_pulls is not empty at apply time';
  END IF;
  IF (SELECT count(*) FROM public.vehicle_listings WHERE title_verification IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION 'title_verification is already populated at apply time';
  END IF;
END $$;