-- Additional-work approval loop for the unified Service Desk.
--
-- When service discovers more work than the get-ready plan covers, they file a
-- structured request; the sales/used-car manager approves, declines, approves
-- with a spending limit, or asks for clarification. A chat message alone can
-- never authorize work — the decision is a structured status on this row.

CREATE TABLE IF NOT EXISTS public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vehicle_listing_id uuid,
  vin text NOT NULL,
  ymm text,
  requested_by uuid,
  requested_by_name text,
  work_requested text NOT NULL,
  reason text,
  is_safety boolean NOT NULL DEFAULT false,
  est_parts numeric,
  est_labor numeric,
  est_total numeric,
  delivery_impact text,
  ro_number text,
  message text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','approved_limit','declined','clarify')),
  spend_limit numeric,
  manager_note text,
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_requests_tenant_status_idx
  ON public.service_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_vin_idx
  ON public.service_requests (tenant_id, vin);

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_requests tenant access" ON public.service_requests;
CREATE POLICY "service_requests tenant access"
  ON public.service_requests FOR ALL TO authenticated
  USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
  )
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
  );

DROP TRIGGER IF EXISTS trg_service_requests_updated ON public.service_requests;
CREATE TRIGGER trg_service_requests_updated
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
