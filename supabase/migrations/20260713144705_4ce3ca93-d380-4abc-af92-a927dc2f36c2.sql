
CREATE TABLE IF NOT EXISTS public.inventory_sync_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'marketcheck',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('success','partial','failed','empty_valid','skipped')),
  num_found INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  new_vehicles INTEGER NOT NULL DEFAULT 0,
  updated_vehicles INTEGER NOT NULL DEFAULT 0,
  prices_recorded INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  matched_dealer TEXT,
  error_summary TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_sync_runs_tenant_started
  ON public.inventory_sync_runs (tenant_id, started_at DESC);

GRANT SELECT ON public.inventory_sync_runs TO authenticated;
GRANT ALL ON public.inventory_sync_runs TO service_role;

ALTER TABLE public.inventory_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read own sync runs"
  ON public.inventory_sync_runs FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin')
  );

CREATE TABLE IF NOT EXISTS public.inventory_sync_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_run_id UUID NOT NULL REFERENCES public.inventory_sync_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  vin TEXT,
  code TEXT,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_sync_errors_run
  ON public.inventory_sync_errors (sync_run_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sync_errors_tenant
  ON public.inventory_sync_errors (tenant_id, created_at DESC);

GRANT SELECT ON public.inventory_sync_errors TO authenticated;
GRANT ALL ON public.inventory_sync_errors TO service_role;

ALTER TABLE public.inventory_sync_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read own sync errors"
  ON public.inventory_sync_errors FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin')
  );
