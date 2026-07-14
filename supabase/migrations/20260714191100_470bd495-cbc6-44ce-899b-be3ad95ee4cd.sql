
-- ── vehicle_change_history ────────────────────────────────────────────────
CREATE TABLE public.vehicle_change_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vehicle_listing_id UUID NULL,
  vin TEXT NOT NULL,
  field_key TEXT NOT NULL,
  previous_value TEXT NULL,
  new_value TEXT NULL,
  source TEXT NOT NULL DEFAULT 'marketcheck',
  change_origin TEXT NOT NULL DEFAULT 'automatic' CHECK (change_origin IN ('automatic','manual')),
  changed_by UUID NULL,
  requires_new_document BOOLEAN NOT NULL DEFAULT false,
  created_exception_id UUID NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_change_history_tenant_vin_at_idx
  ON public.vehicle_change_history (tenant_id, vin, changed_at DESC);
CREATE INDEX vehicle_change_history_tenant_field_at_idx
  ON public.vehicle_change_history (tenant_id, field_key, changed_at DESC);

GRANT SELECT, INSERT ON public.vehicle_change_history TO authenticated;
GRANT ALL ON public.vehicle_change_history TO service_role;
ALTER TABLE public.vehicle_change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_change_history_select"
  ON public.vehicle_change_history FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "vehicle_change_history_insert"
  ON public.vehicle_change_history FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

-- ── vehicle_exceptions ────────────────────────────────────────────────────
CREATE TABLE public.vehicle_exceptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vehicle_listing_id UUID NULL,
  vin TEXT NOT NULL,
  stock_number TEXT NULL,
  exception_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  title TEXT NOT NULL,
  explanation TEXT NULL,
  source_values JSONB NULL,
  recommended_action TEXT NULL,
  assigned_to UUID NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  due_at TIMESTAMPTZ NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL,
  requires_new_document BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_exceptions_tenant_open_idx
  ON public.vehicle_exceptions (tenant_id, status, severity, created_at DESC);
CREATE INDEX vehicle_exceptions_tenant_vin_idx
  ON public.vehicle_exceptions (tenant_id, vin);
CREATE UNIQUE INDEX vehicle_exceptions_open_dedup_idx
  ON public.vehicle_exceptions (tenant_id, vin, exception_type)
  WHERE status IN ('open','in_progress');

GRANT SELECT, INSERT, UPDATE ON public.vehicle_exceptions TO authenticated;
GRANT ALL ON public.vehicle_exceptions TO service_role;
ALTER TABLE public.vehicle_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_exceptions_select"
  ON public.vehicle_exceptions FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "vehicle_exceptions_insert"
  ON public.vehicle_exceptions FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "vehicle_exceptions_update"
  ON public.vehicle_exceptions FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.update_vehicle_exceptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER vehicle_exceptions_set_updated_at
  BEFORE UPDATE ON public.vehicle_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_vehicle_exceptions_updated_at();

-- ── exception_comments ────────────────────────────────────────────────────
CREATE TABLE public.exception_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exception_id UUID NOT NULL REFERENCES public.vehicle_exceptions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  author UUID NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exception_comments_exception_idx
  ON public.exception_comments (exception_id, created_at ASC);

GRANT SELECT, INSERT ON public.exception_comments TO authenticated;
GRANT ALL ON public.exception_comments TO service_role;
ALTER TABLE public.exception_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exception_comments_select"
  ON public.exception_comments FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
CREATE POLICY "exception_comments_insert"
  ON public.exception_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
