-- Write-once description policy.
--
-- Before this migration the nightly reconcile (cron job 15,
-- description-reconcile-nightly, 0 6 * * *) rewrote a description purely
-- because the vehicle had aged: 60 days in inventory, and again at 200. The
-- sweep forces those runs, so an unchanged vehicle -- same price, same
-- equipment, same source_data_version -- was regenerated anyway. One
-- orchestrate run is NINE provider calls (1 master + 8 channel variants)
-- against a 500/day, ~1,350/month tenant ceiling, so a single lot-wide pass on
-- a 130-car lot is ~1,170 calls: most of a month's budget spent re-wording copy
-- that was already correct.
--
-- The owner's rule: generate on ingest, then leave it alone. The one scheduled
-- rewrite is age AND market -- past the configured threshold (90-120 days) and
-- comparable supply measurably abundant, because copy only has to work harder
-- when the shopper has many near-identical listings to choose from. Age alone
-- is the weaker half of that test. At most one aged rewrite per vehicle, ever.
--
-- What still regenerates is untouched: the stalled, source_changed, retryable
-- and missing_case candidate classes below are all input-driven and are
-- deliberately left byte-for-byte as they were. A price change, an equipment
-- change, a new current_source_data_version, a config_version bump or a
-- repairable failure all still reach the orchestrator exactly as before.

-- ── 1. Cadence settings, per tenant ──────────────────────────────────
--
-- Safe to add here: computeConfigVersion() in _shared/description-core.ts
-- hashes an explicit ALLOW-LIST of copy-shaping fields, so a new column does
-- not move configuration_version and cannot invalidate a single description.
-- These are scheduling policy, not writing inputs; they must never be added to
-- that list.

ALTER TABLE public.description_settings
  ADD COLUMN IF NOT EXISTS refresh_age_days integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS refresh_require_abundant_supply boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS refresh_abundant_supply_count integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS refresh_abundant_days_supply integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS refresh_supply_evidence_max_age_days integer NOT NULL DEFAULT 180;

DO $$
BEGIN
  -- 90 is the floor _shared/description-refresh.ts enforces independently. A
  -- tenant configuring below it would be selected here and refused there --
  -- selected work that can never run is the failure mode this whole cadence
  -- already had once.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'description_settings_refresh_age_days_floor') THEN
    ALTER TABLE public.description_settings
      ADD CONSTRAINT description_settings_refresh_age_days_floor CHECK (refresh_age_days >= 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'description_settings_refresh_supply_count_positive') THEN
    ALTER TABLE public.description_settings
      ADD CONSTRAINT description_settings_refresh_supply_count_positive CHECK (refresh_abundant_supply_count > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.description_settings.refresh_age_days IS
  'Days in inventory before an unchanged description may be rewritten once (default 120, floor 90). The ladder lives in _shared/description-refresh.ts.';
COMMENT ON COLUMN public.description_settings.refresh_require_abundant_supply IS
  'When true (default) an aged vehicle is only rewritten if comparable supply is measurably abundant. False lets age alone qualify -- roughly 9 extra provider calls per aged vehicle.';
COMMENT ON COLUMN public.description_settings.refresh_abundant_supply_count IS
  'Comparable active listings (MarketCheck num_found via market_meta.trim_count / similar_count) at or above which supply counts as abundant.';
COMMENT ON COLUMN public.description_settings.refresh_abundant_days_supply IS
  'Fallback: regional market days supply (market_meta.market_days_supply) at or above which supply counts as abundant.';
COMMENT ON COLUMN public.description_settings.refresh_supply_evidence_max_age_days IS
  'Oldest market_meta still allowed to decide. Generous on purpose: next_enrich_batch only re-enriches vehicles MISSING enrichment, so a fully enriched lot never has recent market_meta.';

COMMENT ON COLUMN public.description_cases.last_refresh_milestone IS
  'Days-in-inventory threshold the current description was rewritten for. NULL = never age-refreshed, and only a NULL is ever selected again -- one aged rewrite per vehicle, ever. Values of 60/200 are from the retired ladder and count as spent.';

-- ── 2. Selection ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_description_reconcile_batch(
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 50,
  p_sweep_start timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(tenant_id uuid, vehicle_id uuid, vin text, case_id uuid, reason text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH candidates AS (
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id AS case_id, 'stalled'::text AS reason, 1 AS pri
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL
       AND dc.status IN ('QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','PUBLISHING')
       AND dc.updated_at < now() - interval '30 minutes'
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
    UNION ALL
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'source_changed', 2
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL
       AND dc.status NOT IN ('ARCHIVED','FAILED_BLOCKED')
       AND dc.current_source_data_version IS NOT NULL
       AND dc.current_source_data_version IS DISTINCT FROM dc.processed_source_data_version
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
    UNION ALL
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'retryable', 3
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL AND dc.status = 'FAILED_RETRYABLE'
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
       AND EXISTS (SELECT 1 FROM public.description_jobs j
                    WHERE j.description_case_id = dc.id
                      AND j.status = 'failed_retryable' AND j.attempt_count < j.max_attempts)
    UNION ALL
    SELECT vl.tenant_id, vl.id, vl.vin, NULL::uuid, 'missing_case', 4
      FROM public.vehicle_listings vl
      LEFT JOIN public.description_cases dc
        ON dc.vehicle_id = vl.id AND dc.tenant_id = vl.tenant_id
     WHERE vl.tenant_id IS NOT NULL AND vl.status IN ('draft','published')
       AND vl.vin IS NOT NULL AND dc.id IS NULL
    UNION ALL
    -- Aged out of its current copy AND competing against abundant supply.
    -- Lowest priority: a vehicle with no description at all, or one actively
    -- failing, is worth more than a rewrite of copy that still reads correctly.
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'refresh_due', 5
      FROM public.description_cases dc
      JOIN public.vehicle_listings vl
        ON vl.id = dc.vehicle_id AND vl.tenant_id = dc.tenant_id
      LEFT JOIN public.description_settings s
        ON s.tenant_id = dc.tenant_id
     WHERE dc.archived_at IS NULL
       AND dc.status NOT IN ('ARCHIVED','FAILED_BLOCKED')
       AND dc.published_master_version_id IS NOT NULL
       -- A human chose this copy. Age never overrides that.
       AND dc.master_locked IS NOT TRUE
       -- Write once: one aged rewrite per vehicle, ever.
       AND dc.last_refresh_milestone IS NULL
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
       -- Days on market from the provider is the vehicle's real age on the
       -- lot. Our own ingest date restarts the clock for every car that was
       -- already in stock at onboarding: on this lot the oldest row is 79 days
       -- old while the oldest vehicle has been listed 883 days. The jsonb value
       -- is text and is not guaranteed numeric, so it is matched before it is
       -- cast rather than cast inside a subquery that could still be hoisted.
       -- get_ready_records.inventory_date is not used: it is set by a click in
       -- the recon workflow, so most of the lot has none.
       AND COALESCE(
             CASE WHEN vl.mc_attributes->>'dom' ~ '^[0-9]+$'
                  THEN (vl.mc_attributes->>'dom')::int END,
             GREATEST(0, (EXTRACT(EPOCH FROM (now() - vl.created_at)) / 86400)::int)
           ) >= GREATEST(COALESCE(s.refresh_age_days, 120), 90)
       -- Comparable supply. Only whole-market counts decide:
       --   trim_count    -- num_found for this trim in the same geometry
       --   similar_count -- num_found at the winning search tier, usable only
       --                    when that tier kept the year or the price band
       --   market_days_supply -- regional MDS, when the plan returns one
       -- market_meta.like_count is deliberately ignored: it is the length of
       -- the like-for-like subset of ONE returned page, so it saturates at the
       -- page size and would report a commodity model as scarce. market_position
       -- is ignored too -- it is a PRICE position, not a supply figure. No
       -- scarcity score is computed anywhere; each basis is a stored provider
       -- number compared to one threshold, and the first usable basis decides.
       -- This mirrors classifyMarketSupply() in _shared/description-refresh.ts;
       -- a test pins the defaults below to REFRESH_POLICY.
       AND (
         COALESCE(s.refresh_require_abundant_supply, true) IS NOT TRUE
         OR (
           -- Cast only what matched, for the same reason the dom check above
           -- does: an unexpected string here would abort the whole sweep.
           CASE WHEN vl.market_meta->>'checked_at' ~ '^\d{4}-\d{2}-\d{2}'
                THEN (vl.market_meta->>'checked_at')::timestamptz END
             >= now() - make_interval(days => COALESCE(s.refresh_supply_evidence_max_age_days, 180))
           AND CASE
             WHEN vl.market_meta->>'trim_count' ~ '^[0-9]+$'
               THEN (vl.market_meta->>'trim_count')::int
                      >= COALESCE(s.refresh_abundant_supply_count, 10)
             WHEN vl.market_meta->>'relaxation_tier'
                    IN ('trim_year_band','year_band','year','band')
                  AND COALESCE(vl.market_meta->>'similar_count',
                               vl.market_meta->>'inventory_count') ~ '^[0-9]+$'
               THEN COALESCE(vl.market_meta->>'similar_count',
                             vl.market_meta->>'inventory_count')::int
                      >= COALESCE(s.refresh_abundant_supply_count, 10)
             WHEN vl.market_meta->>'market_days_supply' ~ '^[0-9]+(\.[0-9]+)?$'
               THEN (vl.market_meta->>'market_days_supply')::numeric
                      >= COALESCE(s.refresh_abundant_days_supply, 60)
             ELSE false
           END
         )
       )
  ), scoped AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.pri ORDER BY c.vehicle_id) AS rn
      FROM candidates c
     WHERE (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
  )
  SELECT tenant_id, vehicle_id, vin, case_id, reason
    FROM scoped
   ORDER BY rn, pri
   LIMIT GREATEST(p_limit, 1);
$function$;

GRANT EXECUTE ON FUNCTION public.next_description_reconcile_batch(uuid, integer, timestamptz)
  TO authenticated, service_role;
