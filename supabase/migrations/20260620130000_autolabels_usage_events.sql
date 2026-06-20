-- AutoLabels usage events. A lightweight, tenant-scoped meter for quota display
-- and soft enforcement. NOT billing-authoritative — Autocurb's Stripe webhook
-- remains the subscription authority. Limits are interpreted in code by plan
-- tier; this table only records what happened. Idempotent.

CREATE TABLE IF NOT EXISTS public.autolabels_usage_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  feature_key text NOT NULL,
  metric_key  text NOT NULL,
  quantity    integer NOT NULL DEFAULT 1,
  entity_type text,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_metric
  ON public.autolabels_usage_events (tenant_id, metric_key, created_at DESC);

ALTER TABLE public.autolabels_usage_events ENABLE ROW LEVEL SECURITY;

-- Tenant members read + insert their own usage; no update/delete (append-only).
CREATE POLICY "tenant read usage" ON public.autolabels_usage_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "tenant insert usage" ON public.autolabels_usage_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
