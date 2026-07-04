-- Vehicle work events: the immutable audit trail behind the QR-launched
-- mobile prep flow (Vehicle -> Work Events -> Tasks -> Proof -> Signature).
-- Every submission INSERTS a new row. Locked rows are never updated;
-- corrections are new rows pointing back via correction_of.

CREATE TABLE IF NOT EXISTS public.vehicle_work_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin             TEXT NOT NULL,
  listing_id      UUID REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
                    'initial_detail','reclean','service_install',
                    'protection_install','vendor_visit','manager_review','correction'
                  )),
  visit_number    INTEGER,
  reason          TEXT,
  ro_number       TEXT,
  company_name    TEXT,
  tech_name       TEXT,
  tasks           JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos          JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes           TEXT,
  signer_name     TEXT,
  signature_data  TEXT,
  signature_type  TEXT,
  content_hash    TEXT,
  user_agent      TEXT,
  status          TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','corrected')),
  locked          BOOLEAN NOT NULL DEFAULT true,
  correction_of   UUID REFERENCES public.vehicle_work_events(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_work_events_tenant_vin
  ON public.vehicle_work_events (tenant_id, vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_work_events_correction_of
  ON public.vehicle_work_events (correction_of)
  WHERE correction_of IS NOT NULL;

DROP TRIGGER IF EXISTS update_vehicle_work_events_updated_at ON public.vehicle_work_events;
CREATE TRIGGER update_vehicle_work_events_updated_at
  BEFORE UPDATE ON public.vehicle_work_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Locked rows are append-only evidence: block any UPDATE that touches a
-- locked row so a signed event can never be silently rewritten.
CREATE OR REPLACE FUNCTION public.vehicle_work_events_block_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.locked THEN
    RAISE EXCEPTION 'work_event_locked: signed work events are immutable; submit a correction event instead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicle_work_events_no_update_locked ON public.vehicle_work_events;
CREATE TRIGGER vehicle_work_events_no_update_locked
  BEFORE UPDATE ON public.vehicle_work_events
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_work_events_block_locked();

ALTER TABLE public.vehicle_work_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members manage vehicle work events" ON public.vehicle_work_events;
CREATE POLICY "Tenant members manage vehicle work events"
  ON public.vehicle_work_events FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
