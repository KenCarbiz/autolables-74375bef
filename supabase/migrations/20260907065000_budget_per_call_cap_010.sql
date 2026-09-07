-- Owner decision: per-generation cap $0.10, daily limit 500.
--
-- While the configured model has no price on file, spend cannot be measured
-- and the budget falls back to budget / max_cost_per_generation as the most
-- calls it could possibly afford. The previous $0.50 was a placeholder chosen
-- when that fallback was written, not a measured figure, and it put the
-- ceiling at 270 -- below the 453 calls already made this month, so enforcing
-- the budget would have halted the lot on a number nobody had chosen.
--
-- $0.10 against the $135 production pool is 1,350 calls a month. Measured
-- usage is roughly 25,300 input tokens (about 92% served from the cached
-- prefix) and 1,000 output tokens per call, so this remains a conservative
-- worst case rather than a price. It still cannot overspend: the ceiling is
-- the budget divided by the cap.
--
-- Supplying real rates for the model removes the ceiling entirely, because
-- cost_amount stops being NULL and the dollar budget binds directly.

ALTER TABLE public.description_generation_budgets
  ALTER COLUMN max_cost_per_generation SET DEFAULT 0.10,
  ALTER COLUMN daily_generation_limit  SET DEFAULT 500;

UPDATE public.description_generation_budgets
   SET max_cost_per_generation = 0.10,
       daily_generation_limit  = 500,
       updated_at = now()
 WHERE max_cost_per_generation = 0.50
    OR daily_generation_limit = 250;
