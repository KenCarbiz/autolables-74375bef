-- ──────────────────────────────────────────────────────────────────────
-- title_report_pulls — append-only meter for NMVTIS title-report spend.
--
-- title_reports holds ONE row per (tenant_id, vin) and is overwritten on
-- regenerate, so it can't answer "how many charged pulls did this dealer make
-- this month". This ledger appends one row per pull: a paid generate
-- (charged = true, ~$0.49) or a free re-access within the 90-day window
-- (charged = false). The admin Title Verification panel reads a running total
-- from it so the metered cost is always visible.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.title_report_pulls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin           text NOT NULL,
  action        text NOT NULL,              -- 'generate' | 'refresh'
  charged       boolean NOT NULL DEFAULT false,
  unit_cost     numeric(6,2) NOT NULL DEFAULT 0,   -- USD billed for this pull
  pulled_by     uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_title_report_pulls_tenant_time
  ON public.title_report_pulls (tenant_id, created_at DESC);

ALTER TABLE public.title_report_pulls ENABLE ROW LEVEL SECURITY;

-- Dealer staff read their own tenant's meter. The edge function (service role)
-- is the only writer, so no authenticated INSERT policy is granted.
CREATE POLICY "title_report_pulls tenant read"
  ON public.title_report_pulls FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
