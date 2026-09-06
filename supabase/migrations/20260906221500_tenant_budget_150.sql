-- Per-tenant AI budget: $150/month.
--
-- Owner decision, 2026-09-06. Split 135/15 between the production and preview
-- pools, keeping the 90/10 ratio the previous $100 budget used so the two
-- pools stay in proportion. They are deliberately separate: preview traffic is
-- exploratory and high-volume, and letting it drain the pool that publishes
-- real copy would stop the work that earns money.
--
-- This raises the unpriced call ceiling with it. While the configured model has
-- no entry in the pricing table, spend cannot be measured, and the budget falls
-- back to budget / max_cost_per_generation as the most calls it could possibly
-- afford: 135 / 0.50 = 270 a month, against 130 generatable vehicles on this
-- lot. A full pass fits twice over.

ALTER TABLE public.description_generation_budgets
  ALTER COLUMN monthly_generation_budget SET DEFAULT 135.00,
  ALTER COLUMN monthly_preview_budget    SET DEFAULT 15.00,
  -- The unpriced ceiling divides the budget by this. A NULL here means "no
  -- per-call cap configured", which makes the ceiling inapplicable -- so a
  -- tenant with an unpriced model AND no cap had no bound of any kind, which
  -- is the exact state the ceiling exists to prevent. Seeding every tenant
  -- with a row exposed it: the second tenant came out with a budget and no cap.
  ALTER COLUMN max_cost_per_generation  SET DEFAULT 0.50;

UPDATE public.description_generation_budgets
   SET max_cost_per_generation = 0.50, updated_at = now()
 WHERE max_cost_per_generation IS NULL;

-- Existing tenants move to the new budget. Only rows still on the previous
-- 90/10 figures are touched, so a tenant given a deliberate custom budget
-- keeps it.
UPDATE public.description_generation_budgets
   SET monthly_generation_budget = 135.00,
       monthly_preview_budget    = 15.00,
       updated_at = now()
 WHERE monthly_generation_budget = 90.00
   AND monthly_preview_budget    = 10.00;

-- Any tenant with no budget row at all is unlimited, which is the one state a
-- budget must never silently mean. Give every existing tenant the default.
INSERT INTO public.description_generation_budgets (tenant_id)
SELECT t.id FROM public.tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM public.description_generation_budgets b WHERE b.tenant_id = t.id
 );

COMMENT ON COLUMN public.description_generation_budgets.monthly_generation_budget IS
  'Monthly production spend cap in currency units. Default 135; with the 15 preview pool this is the $150 per-tenant budget. NULL means unlimited, never zero.';
