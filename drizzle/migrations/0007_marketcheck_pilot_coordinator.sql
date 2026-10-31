-- ── MarketCheck pilot coordinator (owner change orders 2026-10-31) ─────────
--
--   provider_accounts            one row per provider account (all keys on the
--                                account share it): quota, protected reserve,
--                                priority floors, dollar cap, rate limit, and
--                                the provider's own reported usage and reset.
--   provider_product_catalog     account-specific products: endpoint, bundled
--                                fields, verified rate and billing unit,
--                                initial vs repeat charge, repeat eligibility,
--                                retention / cross-store reuse / display rights,
--                                evidence and verification date. Seeded with
--                                list-price ESTIMATES and every right UNKNOWN.
--   provider_field_definitions   the information a store can require, with the
--                                distinctions the data must keep (installed vs
--                                available, listing vs ownership history, ...).
--   provider_requests            atomic reservations and the outcome of every
--                                request: consumed, no charge, billing
--                                uncertain, joined (deduplicated), reused,
--                                recalculated.
--   vehicle_provider_states      reason-specific decode/result states with
--                                cooldowns and attempt limits.
--
-- provider_reserve is the single admission point for MarketCheck quota. The
-- existing provider_call_admit platform budget still applies on top; both must
-- admit. Nothing here spends allowance on its own, at month end or otherwise.

CREATE TABLE public.provider_accounts (
  account_ref text PRIMARY KEY CHECK (account_ref ~ '^[a-z0-9_]{3,60}$'),
  provider text NOT NULL DEFAULT 'marketcheck',
  credential_refs text[] NOT NULL DEFAULT '{}',
  plan_name text,
  pilot_mode boolean NOT NULL DEFAULT true,
  monthly_call_quota integer NOT NULL CHECK (monthly_call_quota > 0),
  protected_reserve integer NOT NULL DEFAULT 1000 CHECK (protected_reserve >= 0),
  -- Minimum calls that must remain (after the reserve) for each priority:
  -- 1 required work for primary subscribed stores, 2 missing high-value info,
  -- 3 approved refreshes, 4 optional enrichment of additional inventory.
  priority_floors jsonb NOT NULL DEFAULT '{"1":0,"2":0,"3":250,"4":750}'::jsonb,
  monthly_usd_cap numeric(10,2),
  rate_limit_per_minute integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 1000),
  uncertain_retry_hold_hours integer NOT NULL DEFAULT 24 CHECK (uncertain_retry_hold_hours BETWEEN 1 AND 720),
  provider_reported_limit integer,
  provider_reported_used integer,
  provider_reported_remaining integer,
  provider_reset_at timestamptz,
  provider_reported_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (protected_reserve < monthly_call_quota)
);
INSERT INTO public.provider_accounts (account_ref, provider, credential_refs, plan_name, monthly_call_quota, protected_reserve)
VALUES ('marketcheck_primary', 'marketcheck', ARRAY['MARKETCHECK_API_KEY'], '5,000-call monthly plan (pilot)', 5000, 1000)
ON CONFLICT (account_ref) DO NOTHING;

-- The billing period: the provider's reset when it has told us, otherwise the
-- UTC calendar month, which the dashboard labels as an assumption.
CREATE OR REPLACE FUNCTION public.provider_period(p_account_ref text, OUT period_start timestamptz, OUT period_end timestamptz, OUT source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.provider_accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM provider_accounts WHERE account_ref = p_account_ref;
  IF a.provider_reset_at IS NOT NULL AND a.provider_reset_at > now() AND a.provider_reset_at <= now() + interval '32 days' THEN
    period_end := a.provider_reset_at; period_start := a.provider_reset_at - interval '1 month'; source := 'provider_reset';
  ELSE
    period_start := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; period_end := period_start + interval '1 month'; source := 'assumed_utc_month';
  END IF;
END $$;

CREATE TABLE public.provider_field_definitions (
  field_key text PRIMARY KEY,
  label text NOT NULL,
  semantic_kind text NOT NULL,
  description text NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('static','freshness_or_input_change','freshness','monthly_dataset','derived'))
);
INSERT INTO public.provider_field_definitions VALUES
  ('build_identity', 'Factory build identity', 'decoded_specification', 'Exact year/make/model/trim/engine decoded from the VIN.', 'static'),
  ('installed_equipment', 'Installed options and packages', 'installed_equipment', 'Equipment the provider reports as built into this VIN. Never mixed with what the trim could be ordered with.', 'static'),
  ('available_equipment', 'Available options for the trim', 'available_equipment', 'What the trim CAN be ordered with. Never shown as installed.', 'static'),
  ('msrp_build', 'Original MSRP from the build', 'decoded_specification', 'Factory MSRP figures from the decode, not the dealer price.', 'static'),
  ('factory_warranty_spec', 'Factory warranty terms', 'warranty_specification', 'The warranty programme as specified. Remaining coverage is derived separately from in-service date and mileage.', 'static'),
  ('warranty_remaining', 'Remaining warranty coverage', 'derived', 'Calculated from warranty terms, in-service date and mileage. Recalculated, never requested.', 'derived'),
  ('valuation', 'Market valuation', 'provider_estimate', 'Provider price prediction with its own confidence; an estimate, not a fact.', 'freshness_or_input_change'),
  ('comparables', 'Comparable listings', 'market_listings', 'Comparable vehicles the provider used or returned.', 'freshness_or_input_change'),
  ('listing_history', 'Listing history', 'listing_history', 'Past listings of this VIN (dealers, prices, mileage). Not verified ownership history.', 'freshness'),
  ('market_days_supply', 'Market days supply', 'market_statistic', 'Liquidity for the cohort; regenerated by the provider.', 'freshness'),
  ('inferred_sales', 'Inferred sales statistics', 'inferred_statistic', 'Sales the provider infers from listings leaving the market. Not confirmed sales.', 'monthly_dataset'),
  ('market_exits', 'Recent market exits', 'inferred_statistic', 'Listings recently removed; inferred, not confirmed sold.', 'monthly_dataset'),
  ('recall_status', 'Open recalls', 'recall_status', 'VIN-specific recall state.', 'freshness')
ON CONFLICT (field_key) DO NOTHING;

CREATE TABLE public.provider_product_catalog (
  account_ref text NOT NULL REFERENCES public.provider_accounts(account_ref) ON DELETE CASCADE,
  product_key text NOT NULL CHECK (product_key ~ '^[a-z0-9_]{2,60}$'),
  billing_product text NOT NULL,
  label text NOT NULL,
  endpoint text NOT NULL,
  bundled_fields text[] NOT NULL,
  billing_unit text NOT NULL DEFAULT 'request',
  quota_units integer NOT NULL DEFAULT 1 CHECK (quota_units >= 1),
  rate_usd numeric(10,4),
  rate_status text NOT NULL DEFAULT 'unknown' CHECK (rate_status IN ('verified','list_price_estimate','placeholder','unknown')),
  initial_charge_usd numeric(10,4),
  repeat_charge_policy text NOT NULL DEFAULT 'unknown' CHECK (repeat_charge_policy IN ('charged','free_within_window','discounted','unknown')),
  repeat_charge_usd numeric(10,4),
  repeat_window_days integer CHECK (repeat_window_days IS NULL OR repeat_window_days BETWEEN 1 AND 365),
  repeat_allowance integer CHECK (repeat_allowance IS NULL OR repeat_allowance >= 0),
  -- A free repeat may still use quota; unknown counts as using it.
  repeat_consumes_quota text NOT NULL DEFAULT 'unknown' CHECK (repeat_consumes_quota IN ('yes','no','unknown')),
  retention_policy text NOT NULL DEFAULT 'unknown' CHECK (retention_policy IN ('permitted','limited','prohibited','unknown')),
  retention_days integer,
  cross_store_reuse text NOT NULL DEFAULT 'unknown' CHECK (cross_store_reuse IN ('permitted','prohibited','unknown')),
  customer_display text NOT NULL DEFAULT 'unknown' CHECK (customer_display IN ('permitted','prohibited','unknown')),
  update_cadence text NOT NULL CHECK (update_cadence IN ('static','freshness_or_input_change','freshness','monthly_dataset')),
  freshness_days integer,
  unavailable_cooldown_hours integer NOT NULL DEFAULT 168,
  unavailable_max_attempts integer NOT NULL DEFAULT 3,
  failure_cooldown_hours integer NOT NULL DEFAULT 6,
  failure_max_attempts integer NOT NULL DEFAULT 4,
  enabled boolean NOT NULL DEFAULT true,
  evidence text,
  evidence_url text,
  verified_at timestamptz,
  verified_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_ref, product_key),
  -- A free repeat is never assumed: it needs a verified rate and evidence.
  CHECK (repeat_charge_policy <> 'free_within_window' OR (verified_at IS NOT NULL AND evidence IS NOT NULL AND repeat_window_days IS NOT NULL)),
  CHECK (rate_status <> 'verified' OR (verified_at IS NOT NULL AND evidence IS NOT NULL AND rate_usd IS NOT NULL))
);

-- Seed: public list prices from mcCost.ts as estimates; every right unknown.
INSERT INTO public.provider_product_catalog (account_ref, product_key, billing_product, label, endpoint, bundled_fields, rate_usd, rate_status, update_cadence, freshness_days, evidence) VALUES
  ('marketcheck_primary', 'neovin', 'neovin', 'NeoVIN decode', '/v2/decode/car/neovin/{vin}/specs', ARRAY['build_identity','installed_equipment','msrp_build','factory_warranty_spec'], 0.08, 'list_price_estimate', 'static', NULL, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'basic_decode', 'basic_vin_decode', 'Basic VIN decode', '/v2/decode/car/{vin}/specs', ARRAY['build_identity'], 0.0015, 'list_price_estimate', 'static', NULL, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'price_base', 'price_prediction', 'MarketCheck Price (base)', '/v2/predict/car/us/marketcheck_price', ARRAY['valuation'], 0.07, 'list_price_estimate', 'freshness_or_input_change', 7, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'price_premium', 'price_prediction', 'MarketCheck Price Premium (comparables)', '/v2/predict/car/us/marketcheck_price/comparables', ARRAY['valuation','comparables'], 0.07, 'placeholder', 'freshness_or_input_change', 7, 'Price is a placeholder in MARKETCHECK_CAPABILITY_MATRIX.md'),
  ('marketcheck_primary', 'price_premium_plus', 'price_prediction', 'MarketCheck Price Premium Plus (comparables + NeoVIN)', '/v2/predict/car/us/marketcheck_price/comparables/decode', ARRAY['valuation','comparables','build_identity','installed_equipment','msrp_build','factory_warranty_spec'], 0.07, 'placeholder', 'freshness_or_input_change', 7, 'Price is a placeholder in MARKETCHECK_CAPABILITY_MATRIX.md'),
  ('marketcheck_primary', 'vin_history', 'vin_history', 'Listing history by VIN', '/v2/history/car/{vin}', ARRAY['listing_history'], 0.006, 'list_price_estimate', 'freshness', 30, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'mds', 'market_days_supply', 'Market days supply', '/v2/mds/car', ARRAY['market_days_supply'], 0.002, 'list_price_estimate', 'freshness', 7, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'sales_stats', 'sales_stats', 'Inferred sales statistics', '/v2/sales/car', ARRAY['inferred_sales'], 0.002, 'list_price_estimate', 'monthly_dataset', NULL, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'recents', 'recent_inventory', 'Recent market exits', '/v2/search/car/recents', ARRAY['market_exits'], 0.0025, 'list_price_estimate', 'monthly_dataset', NULL, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'autorecalls', 'auto_recalls', 'VIN recalls', '/v2/car/autorecalls/{vin}', ARRAY['recall_status'], 0.07, 'list_price_estimate', 'freshness', 30, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'active_search', 'inventory_search', 'Active listings search', '/v2/search/car/active', ARRAY['comparables'], 0.002, 'list_price_estimate', 'freshness', 1, 'mcCost.ts public list price; not account-verified'),
  ('marketcheck_primary', 'available_options_packages', 'available_options_packages', 'Available options packages', '/v2/options/packages', ARRAY['available_equipment'], 0.002, 'list_price_estimate', 'static', NULL, 'mcCost.ts public list price; not account-verified')
ON CONFLICT (account_ref, product_key) DO NOTHING;

ALTER TABLE public.store_enrichment_policies
  ADD COLUMN IF NOT EXISTS account_ref text NOT NULL DEFAULT 'marketcheck_primary' REFERENCES public.provider_accounts(account_ref),
  ADD COLUMN IF NOT EXISTS required_fields text[] NOT NULL DEFAULT '{}';

-- store_enrichment_policies.allowed_products held billing names in 0006; from
-- here it holds catalog product keys. Widen the check accordingly.
ALTER TABLE public.store_enrichment_policies DROP CONSTRAINT IF EXISTS store_enrichment_policies_allowed_products_check;
CREATE OR REPLACE FUNCTION public.store_enrichment_products() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['basic_vin_decode','neovin','vin_history','price_prediction','inventory_search','market_days_supply','recent_inventory','sales_stats','auto_recalls','cached_images',
               'basic_decode','price_base','price_premium','price_premium_plus','mds','recents','autorecalls','available_options_packages']::text[]
$$;
ALTER TABLE public.store_enrichment_policies ADD CONSTRAINT store_enrichment_policies_allowed_products_check CHECK (allowed_products <@ public.store_enrichment_products());

-- Paid bulk work (backfill or scheduled refresh) stays locked until every
-- approved product has a verified rate, a known repeat policy and known
-- retention rights for this account.
CREATE OR REPLACE FUNCTION public.store_enrichment_policies_bulk_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_bad text[];
BEGIN
  IF NEW.backfill_limit > 0 OR NEW.refresh_cadence_hours IS NOT NULL OR NEW.per_run_limit > 0 THEN
    SELECT array_agg(p) INTO v_bad FROM unnest(NEW.allowed_products) p
     WHERE NOT EXISTS (SELECT 1 FROM provider_product_catalog c WHERE c.account_ref = NEW.account_ref AND c.product_key = p
                         AND c.rate_status = 'verified' AND c.repeat_charge_policy <> 'unknown' AND c.retention_policy <> 'unknown');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'bulk_requires_verified_catalog: %', array_to_string(v_bad, ',');
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.required_fields) f WHERE NOT EXISTS (SELECT 1 FROM provider_field_definitions d WHERE d.field_key = f)) THEN
    RAISE EXCEPTION 'unknown_required_field';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER store_enrichment_policies_bulk_guard BEFORE INSERT OR UPDATE ON public.store_enrichment_policies
  FOR EACH ROW EXECUTE FUNCTION public.store_enrichment_policies_bulk_guard();

-- Live MarketCheck tools that staff AI may use. Each maps to the REST
-- products it can call; one invocation may make several billable requests,
-- each reserved separately. Nothing is enabled by default.
CREATE TABLE public.provider_ai_tools (
  tool_name text PRIMARY KEY CHECK (tool_name ~ '^[a-z0-9_]{2,80}$'),
  account_ref text NOT NULL REFERENCES public.provider_accounts(account_ref),
  label text NOT NULL,
  product_keys text[] NOT NULL,
  max_requests_per_invocation integer NOT NULL DEFAULT 1 CHECK (max_requests_per_invocation BETWEEN 1 AND 20),
  staff_enabled boolean NOT NULL DEFAULT false,
  allowed_for_automation boolean NOT NULL DEFAULT false CHECK (NOT allowed_for_automation),
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.provider_ai_tools (tool_name, account_ref, label, product_keys, max_requests_per_invocation, note) VALUES
  ('decode_vin_neovin', 'marketcheck_primary', 'Decode a VIN (NeoVIN)', ARRAY['neovin'], 1, 'Prefer an existing decode; never for automated enrichment.'),
  ('get_car_history', 'marketcheck_primary', 'Listing history for a VIN', ARRAY['vin_history'], 1, 'Listing history, not ownership history.'),
  ('predict_price_with_comparables', 'marketcheck_primary', 'Price with comparables', ARRAY['price_premium','price_premium_plus'], 1, NULL),
  ('search_active_cars', 'marketcheck_primary', 'Search active listings', ARRAY['active_search'], 3, 'Paged searches make one request per page.'),
  ('search_past_90_days', 'marketcheck_primary', 'Recently removed listings', ARRAY['recents'], 3, 'Removed is inferred, not confirmed sold.'),
  ('get_sold_summary', 'marketcheck_primary', 'Sold summary', ARRAY['sales_stats'], 1, 'Inferred sales statistics.')
ON CONFLICT (tool_name) DO NOTHING;

CREATE TABLE public.provider_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_ref text NOT NULL REFERENCES public.provider_accounts(account_ref),
  product_key text NOT NULL,
  billing_product text,
  caller text NOT NULL,
  reason text NOT NULL,
  priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 4),
  -- How the request was made: deterministic REST code, a live MCP tool, or
  -- staff AI research. All share the same account quota.
  channel text NOT NULL DEFAULT 'rest' CHECK (channel IN ('rest','mcp','staff_ai')),
  initiated_by uuid,
  purpose text,
  tool_name text,
  invocation_id uuid,
  tenant_id uuid,
  store_id uuid,
  group_id uuid,
  vin text,
  dedupe_key text,
  status text NOT NULL CHECK (status IN ('reserved','consumed','no_charge','billing_uncertain','released','refused','joined','reused','recalculated')),
  refusal_reason text,
  joined_request_id uuid,
  free_refresh boolean NOT NULL DEFAULT false,
  quota_units integer NOT NULL DEFAULT 1,
  estimated_cost_usd numeric(10,4),
  actual_cost_usd numeric(10,4),
  http_status integer,
  provider_event_id bigint,
  provider_headers jsonb,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  settled_at timestamptz
);
-- Concurrent deduplication: one live reservation per request identity.
CREATE UNIQUE INDEX provider_requests_live_dedupe ON public.provider_requests (account_ref, dedupe_key) WHERE status = 'reserved' AND dedupe_key IS NOT NULL;
CREATE INDEX provider_requests_account_at ON public.provider_requests (account_ref, reserved_at DESC);
CREATE INDEX provider_requests_vin ON public.provider_requests (vin, reserved_at DESC);
CREATE INDEX provider_requests_event ON public.provider_requests (provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE TABLE public.vehicle_provider_states (
  account_ref text NOT NULL,
  vin text NOT NULL,
  product_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('complete','partial','ambiguous','invalid_vin','unsupported','unavailable','temporarily_failed','budget_blocked','billing_uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_eligible_at timestamptz,
  partial_fields text[] NOT NULL DEFAULT '{}',
  confidence numeric,
  confidence_scale text CHECK (confidence_scale IS NULL OR confidence_scale IN ('fraction','percent','unknown')),
  data_delivery_date date,
  last_request_id uuid,
  detail text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_ref, vin, product_key)
);

GRANT SELECT ON public.provider_accounts, public.provider_product_catalog, public.provider_field_definitions, public.provider_requests, public.vehicle_provider_states, public.provider_ai_tools TO authenticated;
GRANT ALL ON public.provider_accounts, public.provider_product_catalog, public.provider_field_definitions, public.provider_requests, public.vehicle_provider_states, public.provider_ai_tools TO service_role;
ALTER TABLE public.provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_product_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_provider_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_ai_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins read AI tools" ON public.provider_ai_tools FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read provider accounts" ON public.provider_accounts FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read catalog" ON public.provider_product_catalog FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Signed-in users read field definitions" ON public.provider_field_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Platform admins read provider requests" ON public.provider_requests FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read vehicle provider states" ON public.vehicle_provider_states FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

CREATE TRIGGER audit_provider_accounts AFTER INSERT OR UPDATE ON public.provider_accounts FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();
CREATE TRIGGER audit_provider_ai_tools AFTER INSERT OR UPDATE ON public.provider_ai_tools FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();
CREATE TRIGGER audit_provider_product_catalog AFTER INSERT OR UPDATE ON public.provider_product_catalog FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();

-- Quota consumed this period by local requests (reserved ones count until
-- settled; billing-uncertain ones count, because the provider may have billed).
CREATE OR REPLACE FUNCTION public.provider_local_usage(p_account_ref text, OUT consumed integer, OUT reserved integer, OUT uncertain integer, OUT usd_spent numeric, OUT usd_committed numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM provider_period(p_account_ref);
  SELECT COALESCE(sum(quota_units) FILTER (WHERE status = 'consumed'), 0)::int,
         COALESCE(sum(quota_units) FILTER (WHERE status = 'reserved' AND (expires_at IS NULL OR expires_at > now())), 0)::int,
         COALESCE(sum(quota_units) FILTER (WHERE status = 'billing_uncertain'), 0)::int,
         COALESCE(sum(COALESCE(actual_cost_usd, estimated_cost_usd)) FILTER (WHERE status IN ('consumed','billing_uncertain')), 0),
         COALESCE(sum(estimated_cost_usd) FILTER (WHERE status = 'reserved' AND (expires_at IS NULL OR expires_at > now())), 0)
    INTO consumed, reserved, uncertain, usd_spent, usd_committed
    FROM provider_requests WHERE account_ref = p_account_ref AND reserved_at >= p.period_start;
END $$;

-- Atomic reservation. Serialised per account by the row lock, so concurrent
-- jobs cannot jointly overspend. Returns {reserved, request_id, reason, ...}.
CREATE OR REPLACE FUNCTION public.provider_reserve(
  p_account_ref text, p_product_key text, p_caller text, p_reason text, p_priority integer,
  p_tenant_id uuid DEFAULT NULL, p_store_id uuid DEFAULT NULL, p_vin text DEFAULT NULL,
  p_dedupe_key text DEFAULT NULL, p_estimated_cost_usd numeric DEFAULT NULL, p_free_refresh boolean DEFAULT false,
  p_provider_event_id bigint DEFAULT NULL, p_ttl_seconds integer DEFAULT 300, p_context jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.provider_accounts%ROWTYPE; c public.provider_product_catalog%ROWTYPE; u record; st public.vehicle_provider_states%ROWTYPE;
  v_used integer; v_external integer; v_available integer; v_floor integer; v_units integer := 1; v_reason text; v_id uuid; v_existing uuid;
  v_vin text := NULLIF(upper(trim(COALESCE(p_vin, ''))), ''); v_group uuid; v_cost numeric := p_estimated_cost_usd; v_free boolean := false;
  v_dedupe text := COALESCE(p_dedupe_key, CASE WHEN p_vin IS NOT NULL THEN p_product_key || ':' || upper(trim(p_vin)) END);
  v_channel text := COALESCE(p_context->>'channel', 'rest'); v_initiator uuid := NULLIF(p_context->>'initiated_by','')::uuid;
  v_purpose text := left(p_context->>'purpose', 200); v_tool text := left(p_context->>'tool_name', 80); v_invocation uuid := NULLIF(p_context->>'invocation_id','')::uuid;
  v_priority integer := p_priority; t public.provider_ai_tools%ROWTYPE;
BEGIN
  IF p_priority NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'bad_priority'; END IF;
  IF v_channel NOT IN ('rest','mcp','staff_ai') THEN RAISE EXCEPTION 'bad_channel'; END IF;
  -- AI/MCP research is never required inventory work: it ranks as optional
  -- and must name the person, the purpose and an authorised tool.
  IF v_channel <> 'rest' THEN
    v_priority := GREATEST(v_priority, 3);
    SELECT * INTO t FROM provider_ai_tools WHERE tool_name = v_tool AND account_ref = p_account_ref;
    IF v_initiator IS NULL OR v_purpose IS NULL OR length(trim(v_purpose)) < 3 THEN v_reason := 'ai_attribution_required';
    ELSIF t.tool_name IS NULL OR NOT t.staff_enabled THEN v_reason := 'ai_tool_not_authorized';
    ELSIF NOT (p_product_key = ANY (t.product_keys)) THEN v_reason := 'ai_tool_product_mismatch';
    ELSIF v_invocation IS NULL THEN v_reason := 'ai_invocation_required';
    ELSIF (SELECT count(*) FROM provider_requests WHERE invocation_id = v_invocation AND status IN ('reserved','consumed','billing_uncertain')) >= t.max_requests_per_invocation THEN
      v_reason := 'ai_invocation_request_limit';
    END IF;
  END IF;
  SELECT * INTO a FROM provider_accounts WHERE account_ref = p_account_ref FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('reserved', false, 'reason', 'unknown_account'); END IF;
  SELECT * INTO c FROM provider_product_catalog WHERE account_ref = p_account_ref AND product_key = p_product_key;
  IF c.product_key IS NOT NULL THEN
    v_units := c.quota_units;
    IF v_cost IS NULL THEN v_cost := c.rate_usd; END IF;
  END IF;
  IF p_store_id IS NOT NULL THEN SELECT group_id INTO v_group FROM dealer_stores WHERE id = p_store_id; END IF;

  -- A free repeat is honoured only when the catalog proves it for this account
  -- and a paid request for the same VIN and product sits inside the window.
  IF v_reason IS NULL AND p_free_refresh THEN
    IF c.repeat_charge_policy = 'free_within_window' AND c.verified_at IS NOT NULL AND EXISTS (
         SELECT 1 FROM provider_requests r WHERE r.account_ref = p_account_ref AND r.product_key = p_product_key AND r.vin = v_vin
            AND r.status = 'consumed' AND NOT r.free_refresh AND r.reserved_at > now() - make_interval(days => c.repeat_window_days)) THEN
      v_free := true;
      v_cost := COALESCE(c.repeat_charge_usd, 0);
      IF c.repeat_consumes_quota = 'no' THEN v_units := 0; END IF;
    ELSE
      v_reason := 'free_refresh_not_verified';
    END IF;
  END IF;

  IF v_reason IS NULL AND v_dedupe IS NOT NULL THEN
    SELECT id INTO v_existing FROM provider_requests WHERE account_ref = p_account_ref AND dedupe_key = v_dedupe AND status = 'reserved' AND (expires_at IS NULL OR expires_at > now());
    IF v_existing IS NOT NULL THEN
      INSERT INTO provider_requests (account_ref, product_key, billing_product, caller, reason, priority, channel, initiated_by, purpose, tool_name, invocation_id, tenant_id, store_id, group_id, vin, status, joined_request_id, quota_units, estimated_cost_usd)
      VALUES (p_account_ref, p_product_key, c.billing_product, left(p_caller, 80), left(p_reason, 60), v_priority, v_channel, v_initiator, v_purpose, v_tool, v_invocation, p_tenant_id, p_store_id, v_group, v_vin, 'joined', v_existing, 0, 0);
      RETURN jsonb_build_object('reserved', false, 'reason', 'duplicate_in_flight', 'joined_request_id', v_existing);
    END IF;
    -- Expired reservations are released so they stop holding quota.
    UPDATE provider_requests SET status = 'released', settled_at = now(), refusal_reason = 'reservation_expired'
     WHERE account_ref = p_account_ref AND dedupe_key = v_dedupe AND status = 'reserved' AND expires_at <= now();
    IF EXISTS (SELECT 1 FROM provider_requests WHERE account_ref = p_account_ref AND dedupe_key = v_dedupe AND status = 'billing_uncertain'
                AND settled_at > now() - make_interval(hours => a.uncertain_retry_hold_hours)) THEN
      v_reason := 'billing_uncertain_hold';
    END IF;
  END IF;

  IF v_reason IS NULL AND v_vin IS NOT NULL THEN
    SELECT * INTO st FROM vehicle_provider_states WHERE account_ref = p_account_ref AND vin = v_vin AND product_key = p_product_key;
    IF st.state IN ('invalid_vin','unsupported') THEN v_reason := 'vehicle_state_' || st.state;
    ELSIF st.next_eligible_at IS NOT NULL AND st.next_eligible_at > now() THEN v_reason := 'vehicle_state_cooldown';
    END IF;
  END IF;

  IF v_reason IS NULL AND (SELECT count(*) FROM provider_requests WHERE account_ref = p_account_ref AND status IN ('reserved','consumed','billing_uncertain','no_charge')
                            AND reserved_at > now() - interval '1 minute') >= a.rate_limit_per_minute THEN
    v_reason := 'rate_limited';
  END IF;

  IF v_reason IS NULL AND v_units > 0 THEN
    SELECT * INTO u FROM provider_local_usage(p_account_ref);
    v_used := u.consumed + u.reserved + u.uncertain;
    -- Usage the provider reports beyond ours is external/unattributed and
    -- still reduces what we may spend.
    v_external := GREATEST(0, COALESCE(a.provider_reported_used, 0) - (u.consumed + u.uncertain));
    v_available := a.monthly_call_quota - v_used - v_external;
    IF a.provider_reported_remaining IS NOT NULL AND a.provider_reported_at > now() - interval '1 day' THEN
      v_available := LEAST(v_available, a.provider_reported_remaining - u.reserved);
    END IF;
    v_floor := a.protected_reserve * (v_priority > 1)::int + COALESCE((a.priority_floors->>v_priority::text)::int, 0);
    IF v_available - v_units < v_floor THEN
      v_reason := CASE WHEN v_available - v_units < 0 THEN 'quota_exhausted' WHEN v_priority > 1 AND v_available - v_units < a.protected_reserve THEN 'protected_reserve' ELSE 'priority_floor' END;
    ELSIF a.monthly_usd_cap IS NOT NULL AND v_cost IS NULL THEN
      v_reason := 'unpriced';
    ELSIF a.monthly_usd_cap IS NOT NULL AND u.usd_spent + u.usd_committed + v_cost > a.monthly_usd_cap THEN
      v_reason := 'usd_cap';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO provider_requests (account_ref, product_key, billing_product, caller, reason, priority, channel, initiated_by, purpose, tool_name, invocation_id, tenant_id, store_id, group_id, vin, dedupe_key, status, refusal_reason, quota_units, estimated_cost_usd, provider_event_id)
    VALUES (p_account_ref, p_product_key, c.billing_product, left(p_caller, 80), left(p_reason, 60), v_priority, v_channel, v_initiator, v_purpose, v_tool, v_invocation, p_tenant_id, p_store_id, v_group, v_vin, NULL, 'refused', v_reason, 0, 0, p_provider_event_id);
    IF v_vin IS NOT NULL AND v_reason IN ('quota_exhausted','protected_reserve','priority_floor','usd_cap') THEN
      INSERT INTO vehicle_provider_states (account_ref, vin, product_key, state, detail) VALUES (p_account_ref, v_vin, p_product_key, 'budget_blocked', v_reason)
      ON CONFLICT (account_ref, vin, product_key) DO UPDATE SET state = CASE WHEN vehicle_provider_states.state IN ('complete','partial') THEN vehicle_provider_states.state ELSE 'budget_blocked' END,
        detail = EXCLUDED.detail, updated_at = now();
    END IF;
    RETURN jsonb_build_object('reserved', false, 'reason', v_reason, 'available', v_available);
  END IF;

  INSERT INTO provider_requests (account_ref, product_key, billing_product, caller, reason, priority, channel, initiated_by, purpose, tool_name, invocation_id, tenant_id, store_id, group_id, vin, dedupe_key, status, free_refresh, quota_units, estimated_cost_usd, provider_event_id, expires_at)
  VALUES (p_account_ref, p_product_key, c.billing_product, left(p_caller, 80), left(p_reason, 60), v_priority, v_channel, v_initiator, v_purpose, v_tool, v_invocation, p_tenant_id, p_store_id, v_group, v_vin, v_dedupe, 'reserved', v_free, v_units, v_cost, p_provider_event_id,
          now() + make_interval(secs => GREATEST(30, LEAST(p_ttl_seconds, 3600))))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('reserved', true, 'request_id', v_id, 'available_after', v_available - v_units, 'free_refresh', v_free);
END $$;

-- Settles a reservation. consumed / no_charge / billing_uncertain decide what
-- counts; a vehicle state, when given, records why a VIN should or should not
-- be asked again.
CREATE OR REPLACE FUNCTION public.provider_settle(
  p_request_id uuid, p_outcome text, p_http_status integer DEFAULT NULL, p_actual_cost_usd numeric DEFAULT NULL,
  p_headers jsonb DEFAULT NULL, p_vehicle_state text DEFAULT NULL, p_partial_fields text[] DEFAULT NULL,
  p_confidence numeric DEFAULT NULL, p_confidence_scale text DEFAULT NULL, p_data_delivery_date date DEFAULT NULL, p_detail text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.provider_requests%ROWTYPE; c public.provider_product_catalog%ROWTYPE; st public.vehicle_provider_states%ROWTYPE; v_next timestamptz; v_attempts integer;
BEGIN
  IF p_outcome NOT IN ('consumed','no_charge','billing_uncertain','released') THEN RAISE EXCEPTION 'bad_outcome'; END IF;
  SELECT * INTO r FROM provider_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'reserved' THEN RETURN 'not_reserved'; END IF;
  UPDATE provider_requests SET status = p_outcome, http_status = p_http_status, actual_cost_usd = p_actual_cost_usd, provider_headers = p_headers, settled_at = now(),
    quota_units = CASE WHEN p_outcome IN ('no_charge','released') THEN 0 ELSE quota_units END
   WHERE id = r.id;
  IF p_vehicle_state IS NOT NULL AND r.vin IS NOT NULL THEN
    SELECT * INTO c FROM provider_product_catalog WHERE account_ref = r.account_ref AND product_key = r.product_key;
    SELECT * INTO st FROM vehicle_provider_states WHERE account_ref = r.account_ref AND vin = r.vin AND product_key = r.product_key;
    v_attempts := CASE WHEN p_vehicle_state IN ('complete') THEN 0 ELSE COALESCE(st.attempts, 0) + 1 END;
    v_next := CASE p_vehicle_state
      WHEN 'unavailable' THEN CASE WHEN v_attempts >= COALESCE(c.unavailable_max_attempts, 3) THEN 'infinity'::timestamptz ELSE now() + make_interval(hours => COALESCE(c.unavailable_cooldown_hours, 168)) END
      WHEN 'temporarily_failed' THEN CASE WHEN v_attempts >= COALESCE(c.failure_max_attempts, 4) THEN 'infinity'::timestamptz ELSE now() + make_interval(hours => COALESCE(c.failure_cooldown_hours, 6) * power(2, LEAST(v_attempts - 1, 5))::int) END
      WHEN 'billing_uncertain' THEN now() + make_interval(hours => (SELECT uncertain_retry_hold_hours FROM provider_accounts WHERE account_ref = r.account_ref))
      WHEN 'ambiguous' THEN now() + make_interval(hours => COALESCE(c.unavailable_cooldown_hours, 168))
      ELSE NULL END;
    INSERT INTO vehicle_provider_states (account_ref, vin, product_key, state, attempts, last_attempt_at, next_eligible_at, partial_fields, confidence, confidence_scale, data_delivery_date, last_request_id, detail)
    VALUES (r.account_ref, r.vin, r.product_key, p_vehicle_state, v_attempts, now(), v_next, COALESCE(p_partial_fields, '{}'), p_confidence, p_confidence_scale, p_data_delivery_date, r.id, left(p_detail, 300))
    ON CONFLICT (account_ref, vin, product_key) DO UPDATE SET state = EXCLUDED.state, attempts = EXCLUDED.attempts, last_attempt_at = now(),
      next_eligible_at = EXCLUDED.next_eligible_at,
      -- A later failure never discards fields a partial answer already gave.
      partial_fields = CASE WHEN EXCLUDED.state IN ('complete','partial') THEN EXCLUDED.partial_fields ELSE vehicle_provider_states.partial_fields END,
      confidence = COALESCE(EXCLUDED.confidence, vehicle_provider_states.confidence), confidence_scale = COALESCE(EXCLUDED.confidence_scale, vehicle_provider_states.confidence_scale),
      data_delivery_date = COALESCE(EXCLUDED.data_delivery_date, vehicle_provider_states.data_delivery_date),
      last_request_id = EXCLUDED.last_request_id, detail = EXCLUDED.detail, updated_at = now();
  END IF;
  RETURN p_outcome;
END $$;

-- Settles by the platform-budget event id, for callers that only carry that.
CREATE OR REPLACE FUNCTION public.provider_settle_event(p_event_id bigint, p_outcome text, p_http_status integer DEFAULT NULL, p_headers jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM provider_requests WHERE provider_event_id = p_event_id AND status = 'reserved' ORDER BY reserved_at DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN 'not_reserved'; END IF;
  RETURN provider_settle(v_id, p_outcome, p_http_status, NULL, p_headers);
END $$;

-- Records what the provider says about the account (quota headers). Never
-- guesses a reset time: only a reset the provider stated is stored.
CREATE OR REPLACE FUNCTION public.provider_reconcile_account(p_account_ref text, p_limit integer, p_used integer, p_remaining integer, p_reset_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u record; v_used integer := p_used;
BEGIN
  IF v_used IS NULL AND p_limit IS NOT NULL AND p_remaining IS NOT NULL THEN v_used := p_limit - p_remaining; END IF;
  UPDATE provider_accounts SET provider_reported_limit = COALESCE(p_limit, provider_reported_limit), provider_reported_used = COALESCE(v_used, provider_reported_used),
    provider_reported_remaining = COALESCE(p_remaining, provider_reported_remaining), provider_reset_at = COALESCE(p_reset_at, provider_reset_at), provider_reported_at = now()
   WHERE account_ref = p_account_ref;
  SELECT * INTO u FROM provider_local_usage(p_account_ref);
  RETURN jsonb_build_object('reported_used', v_used, 'local_used', u.consumed + u.uncertain, 'unattributed', GREATEST(0, COALESCE(v_used, 0) - (u.consumed + u.uncertain)));
END $$;

-- Reuse and recalculation are recorded too, at zero quota, so the dashboard
-- can show what was avoided.
CREATE OR REPLACE FUNCTION public.provider_record_avoided(p_account_ref text, p_product_key text, p_kind text, p_caller text, p_store_id uuid, p_vin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_kind NOT IN ('reused','recalculated') THEN RAISE EXCEPTION 'bad_kind'; END IF;
  INSERT INTO provider_requests (account_ref, product_key, caller, reason, priority, store_id, group_id, vin, status, quota_units, estimated_cost_usd, settled_at)
  VALUES (p_account_ref, p_product_key, left(p_caller, 80), p_kind, 4, p_store_id, (SELECT group_id FROM dealer_stores WHERE id = p_store_id), NULLIF(upper(trim(COALESCE(p_vin, ''))), ''), p_kind, 0, 0, now());
END $$;

-- ── Admin ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.inv_admin_save_provider_account(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  UPDATE provider_accounts SET
    plan_name = COALESCE(p->>'plan_name', plan_name), pilot_mode = COALESCE((p->>'pilot_mode')::boolean, pilot_mode),
    monthly_call_quota = COALESCE((p->>'monthly_call_quota')::integer, monthly_call_quota), protected_reserve = COALESCE((p->>'protected_reserve')::integer, protected_reserve),
    priority_floors = COALESCE(p->'priority_floors', priority_floors),
    monthly_usd_cap = CASE WHEN p ? 'monthly_usd_cap' THEN NULLIF(p->>'monthly_usd_cap','')::numeric ELSE monthly_usd_cap END,
    rate_limit_per_minute = COALESCE((p->>'rate_limit_per_minute')::integer, rate_limit_per_minute),
    uncertain_retry_hold_hours = COALESCE((p->>'uncertain_retry_hold_hours')::integer, uncertain_retry_hold_hours),
    updated_by = v_uid, updated_at = now()
  WHERE account_ref = p->>'account_ref';
  IF NOT FOUND THEN RAISE EXCEPTION 'account_not_found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_save_catalog_product(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); v_verify boolean := COALESCE((p->>'mark_verified')::boolean, false);
BEGIN
  IF v_verify AND length(trim(COALESCE(p->>'evidence', ''))) < 10 THEN RAISE EXCEPTION 'evidence_required'; END IF;
  UPDATE provider_product_catalog SET
    rate_usd = CASE WHEN p ? 'rate_usd' THEN NULLIF(p->>'rate_usd','')::numeric ELSE rate_usd END,
    rate_status = COALESCE(p->>'rate_status', rate_status), billing_unit = COALESCE(p->>'billing_unit', billing_unit),
    quota_units = COALESCE((p->>'quota_units')::integer, quota_units),
    initial_charge_usd = CASE WHEN p ? 'initial_charge_usd' THEN NULLIF(p->>'initial_charge_usd','')::numeric ELSE initial_charge_usd END,
    repeat_charge_policy = COALESCE(p->>'repeat_charge_policy', repeat_charge_policy),
    repeat_charge_usd = CASE WHEN p ? 'repeat_charge_usd' THEN NULLIF(p->>'repeat_charge_usd','')::numeric ELSE repeat_charge_usd END,
    repeat_window_days = CASE WHEN p ? 'repeat_window_days' THEN NULLIF(p->>'repeat_window_days','')::integer ELSE repeat_window_days END,
    repeat_allowance = CASE WHEN p ? 'repeat_allowance' THEN NULLIF(p->>'repeat_allowance','')::integer ELSE repeat_allowance END,
    repeat_consumes_quota = COALESCE(p->>'repeat_consumes_quota', repeat_consumes_quota),
    retention_policy = COALESCE(p->>'retention_policy', retention_policy),
    retention_days = CASE WHEN p ? 'retention_days' THEN NULLIF(p->>'retention_days','')::integer ELSE retention_days END,
    cross_store_reuse = COALESCE(p->>'cross_store_reuse', cross_store_reuse), customer_display = COALESCE(p->>'customer_display', customer_display),
    freshness_days = CASE WHEN p ? 'freshness_days' THEN NULLIF(p->>'freshness_days','')::integer ELSE freshness_days END,
    enabled = COALESCE((p->>'enabled')::boolean, enabled),
    evidence = COALESCE(NULLIF(p->>'evidence',''), evidence), evidence_url = COALESCE(NULLIF(p->>'evidence_url',''), evidence_url),
    verified_at = CASE WHEN v_verify THEN now() ELSE verified_at END, verified_by = CASE WHEN v_verify THEN v_uid ELSE verified_by END,
    updated_at = now()
  WHERE account_ref = p->>'account_ref' AND product_key = p->>'product_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_save_ai_tool(p_tool_name text, p_staff_enabled boolean, p_max_requests integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  UPDATE provider_ai_tools SET staff_enabled = p_staff_enabled, max_requests_per_invocation = COALESCE(p_max_requests, max_requests_per_invocation), updated_by = v_uid, updated_at = now()
   WHERE tool_name = p_tool_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'tool_not_found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_provider_dashboard(p_account_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.provider_accounts%ROWTYPE; p record; u record; v_external integer; v_available integer; v_elapsed numeric; v_rate numeric; v_spendable integer;
BEGIN
  PERFORM inv_require_platform_admin();
  SELECT * INTO a FROM provider_accounts WHERE account_ref = p_account_ref;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO p FROM provider_period(p_account_ref);
  SELECT * INTO u FROM provider_local_usage(p_account_ref);
  v_external := GREATEST(0, COALESCE(a.provider_reported_used, 0) - (u.consumed + u.uncertain));
  v_available := a.monthly_call_quota - u.consumed - u.uncertain - u.reserved - v_external;
  v_spendable := GREATEST(0, v_available - a.protected_reserve);
  v_elapsed := GREATEST(EXTRACT(epoch FROM now() - p.period_start) / 86400.0, 0.04);
  v_rate := (u.consumed + u.uncertain + v_external) / v_elapsed;
  RETURN jsonb_build_object(
    'account', to_jsonb(a),
    'period', jsonb_build_object('start', p.period_start, 'end', p.period_end, 'source', p.source),
    'calls', jsonb_build_object('quota', a.monthly_call_quota, 'consumed', u.consumed, 'billing_uncertain', u.uncertain, 'reserved', u.reserved,
      'external_unattributed', v_external, 'available', v_available, 'protected', a.protected_reserve, 'spendable', v_spendable,
      'provider_reported_used', a.provider_reported_used, 'provider_reported_remaining', a.provider_reported_remaining, 'provider_reported_at', a.provider_reported_at),
    'usd', jsonb_build_object('spent', u.usd_spent, 'committed', u.usd_committed, 'cap', a.monthly_usd_cap,
      'basis', 'estimates unless a verified rate or actual cost was recorded'),
    'projection', jsonb_build_object('calls_per_day', round(v_rate, 2),
      'exhausts_spendable_at', CASE WHEN v_rate > 0 THEN now() + LEAST(v_spendable / v_rate, 3650) * interval '1 day' END,
      'exhausts_before_period_end', CASE WHEN v_rate > 0 THEN now() + LEAST(v_spendable / v_rate, 3650) * interval '1 day' < p.period_end ELSE false END),
    'by_outcome', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM provider_requests WHERE account_ref = p_account_ref AND reserved_at >= p.period_start GROUP BY 1) x), '{}'::jsonb),
    'by_channel', COALESCE((SELECT jsonb_object_agg(channel, n) FROM (SELECT channel, count(*) n FROM provider_requests WHERE account_ref = p_account_ref AND reserved_at >= p.period_start AND status IN ('consumed','billing_uncertain') GROUP BY 1) x), '{}'::jsonb),
    'free_refreshes', (SELECT count(*) FROM provider_requests WHERE account_ref = p_account_ref AND reserved_at >= p.period_start AND free_refresh AND status = 'consumed'),
    'by_store_product', COALESCE((SELECT jsonb_agg(x ORDER BY x.calls DESC) FROM (
        SELECT r.store_id, s.display_name AS store_name, r.product_key, count(*) FILTER (WHERE r.status IN ('consumed','billing_uncertain')) AS calls,
               count(*) FILTER (WHERE r.status = 'refused') AS refused, count(*) FILTER (WHERE r.status IN ('reused','recalculated','joined')) AS avoided,
               COALESCE(sum(COALESCE(r.actual_cost_usd, r.estimated_cost_usd)) FILTER (WHERE r.status IN ('consumed','billing_uncertain')), 0) AS usd
          FROM provider_requests r LEFT JOIN dealer_stores s ON s.id = r.store_id
         WHERE r.account_ref = p_account_ref AND r.reserved_at >= p.period_start GROUP BY 1,2,3) x), '[]'::jsonb),
    'refusals', COALESCE((SELECT jsonb_object_agg(refusal_reason, n) FROM (SELECT refusal_reason, count(*) n FROM provider_requests WHERE account_ref = p_account_ref AND status = 'refused' AND reserved_at >= p.period_start GROUP BY 1) x), '{}'::jsonb),
    'pending', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', 'reservation', 'id', id, 'product_key', product_key, 'reason', reason, 'priority', priority, 'store_id', store_id, 'vin', vin, 'estimated_cost_usd', estimated_cost_usd, 'expires_at', expires_at))
        FROM provider_requests WHERE account_ref = p_account_ref AND status = 'reserved'), '[]'::jsonb)
      || COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', 'queued_request', 'id', q.id, 'product_key', q.product, 'reason', q.reason, 'store_id', q.store_id, 'vin', q.vin,
          'estimated_cost_usd', (SELECT rate_usd FROM provider_product_catalog c WHERE c.account_ref = p_account_ref AND c.product_key = q.product)))
        FROM store_enrichment_requests q WHERE q.status = 'queued'), '[]'::jsonb),
    'repeat_pulls', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT vin, product_key, count(*) AS paid_calls, min(reserved_at) AS first_at, max(reserved_at) AS last_at
          FROM provider_requests WHERE account_ref = p_account_ref AND reserved_at >= p.period_start AND vin IS NOT NULL AND status IN ('consumed','billing_uncertain') AND NOT free_refresh
         GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 3 DESC LIMIT 50) x), '[]'::jsonb),
    'catalog_review', COALESCE((SELECT jsonb_agg(jsonb_build_object('product_key', product_key, 'label', label, 'rate_status', rate_status,
        'repeat_charge_policy', repeat_charge_policy, 'retention_policy', retention_policy, 'cross_store_reuse', cross_store_reuse, 'customer_display', customer_display, 'verified_at', verified_at))
        FROM provider_product_catalog WHERE account_ref = p_account_ref
          AND (rate_status <> 'verified' OR repeat_charge_policy = 'unknown' OR retention_policy = 'unknown' OR cross_store_reuse = 'unknown' OR customer_display = 'unknown')), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_vehicle_provider_history(p_vin text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM inv_require_platform_admin();
  RETURN jsonb_build_object(
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'at', r.reserved_at, 'product_key', r.product_key, 'caller', r.caller, 'reason', r.reason,
        'priority', r.priority, 'channel', r.channel, 'tool_name', r.tool_name, 'initiated_by', r.initiated_by, 'purpose', r.purpose, 'status', r.status, 'refusal_reason', r.refusal_reason, 'free_refresh', r.free_refresh, 'http_status', r.http_status,
        'estimated_cost_usd', r.estimated_cost_usd, 'actual_cost_usd', r.actual_cost_usd, 'store', s.display_name) ORDER BY r.reserved_at DESC)
      FROM provider_requests r LEFT JOIN dealer_stores s ON s.id = r.store_id WHERE r.vin = upper(trim(p_vin))), '[]'::jsonb),
    'states', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM vehicle_provider_states v WHERE v.vin = upper(trim(p_vin))), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_reset_vehicle_state(p_account_ref text, p_vin text, p_product_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  UPDATE vehicle_provider_states SET next_eligible_at = NULL, attempts = 0, detail = 'reset by platform admin', updated_at = now(),
    state = CASE WHEN state IN ('invalid_vin','unsupported') THEN 'unavailable' ELSE state END
   WHERE account_ref = p_account_ref AND vin = upper(trim(p_vin)) AND product_key = p_product_key;
  INSERT INTO inventory_network_audit (actor, entity, entity_id, action, after) VALUES (v_uid, 'vehicle_provider_states', p_vin, 'reset', jsonb_build_object('product_key', p_product_key));
END $$;

REVOKE ALL ON FUNCTION public.provider_period(text), public.provider_local_usage(text),
  public.provider_reserve(text, text, text, text, integer, uuid, uuid, text, text, numeric, boolean, bigint, integer, jsonb),
  public.provider_settle(uuid, text, integer, numeric, jsonb, text, text[], numeric, text, date, text), public.provider_settle_event(bigint, text, integer, jsonb),
  public.provider_reconcile_account(text, integer, integer, integer, timestamptz), public.provider_record_avoided(text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_period(text), public.provider_local_usage(text),
  public.provider_reserve(text, text, text, text, integer, uuid, uuid, text, text, numeric, boolean, bigint, integer, jsonb),
  public.provider_settle(uuid, text, integer, numeric, jsonb, text, text[], numeric, text, date, text), public.provider_settle_event(bigint, text, integer, jsonb),
  public.provider_reconcile_account(text, integer, integer, integer, timestamptz), public.provider_record_avoided(text, text, text, text, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.inv_admin_save_provider_account(jsonb), public.inv_admin_save_catalog_product(jsonb), public.inv_admin_provider_dashboard(text),
  public.inv_admin_vehicle_provider_history(text), public.inv_admin_reset_vehicle_state(text, text, text), public.inv_admin_save_ai_tool(text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_admin_save_provider_account(jsonb), public.inv_admin_save_catalog_product(jsonb), public.inv_admin_provider_dashboard(text),
  public.inv_admin_vehicle_provider_history(text), public.inv_admin_reset_vehicle_state(text, text, text), public.inv_admin_save_ai_tool(text, boolean, integer) TO authenticated;
