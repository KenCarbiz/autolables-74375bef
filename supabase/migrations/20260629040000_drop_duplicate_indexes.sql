-- ──────────────────────────────────────────────────────────────────────
-- Drop redundant duplicate indexes.
--
-- Each of these plain indexes duplicated a UNIQUE constraint / key index on
-- the exact same column(s) with no partial WHERE clause — so it added write
-- overhead on every insert/update for no read benefit (the unique index serves
-- equality lookups equally well). Behavior-neutral: uniqueness and lookups are
-- preserved by the surviving *_key / pkey index in every case.
--
-- Deliberately NOT dropped (verified as genuine, non-redundant pairs because
-- the unique sibling is PARTIAL, so it does not cover the plain index):
--   • recall_service_tasks.idx_recall_tasks_listing  (full) vs
--     uniq_open_recall_task_per_vehicle  (UNIQUE ... WHERE status='open_review')
--   • tenants.idx_tenants_autocurb  (full) vs
--     idx_tenants_autocurb_tenant_id  (UNIQUE ... WHERE autocurb_tenant_id IS NOT NULL)
-- ──────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_deal_signing_tokens_token;           -- dup of deal_signing_tokens_token_key
DROP INDEX IF EXISTS public.idx_dealer_branding_tenant_id;           -- dup of dealer_branding_tenant_id_key
DROP INDEX IF EXISTS public.idx_dealer_passport_settings_tenant_id;  -- dup of dealer_passport_settings_tenant_id_key
DROP INDEX IF EXISTS public.idx_dealer_rule_preferences_tenant_state;-- dup of dealer_rule_preferences_tenant_id_state_key
DROP INDEX IF EXISTS public.idx_dealer_settings_tenant_id;           -- dup of dealer_settings_tenant_id_key
DROP INDEX IF EXISTS public.idx_dealer_template_preferences_tenant_id;-- dup of dealer_template_preferences_tenant_id_key
DROP INDEX IF EXISTS public.passport_delivery_settings_tenant_idx;   -- dup of passport_delivery_settings_tenant_id_key
