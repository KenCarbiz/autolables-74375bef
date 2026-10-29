-- For scripts/sync-verify/run.sh with 20261103 and 20261106 in SYNC_EXTRA_SQL:
-- both MarketCheck lanes enabled with synthetic call limits, set as the
-- database owner (standing in for the audited setter).
UPDATE public.provider_lane_budgets SET enabled = true, monthly_call_cap = 1000
 WHERE provider = 'marketcheck' AND lane IN ('essential_sync', 'enrichment');
