-- Refresh cadence: rewrite a description at 60 days in inventory and again at
-- 200. Generate on ingest, nothing in between.
--
-- The reconcile sweep had four candidate classes -- stalled, source_changed,
-- retryable, missing_case -- and every one of them is event-driven. A vehicle
-- whose description succeeded on day one and whose source data never moved was
-- therefore never selected again, at any age. refreshDecision() had been
-- written and tested but nothing could reach it, because nothing put an ageing
-- vehicle in front of it.
--
-- The ladder itself is NOT encoded here. This predicate is a coarse bound --
-- old enough to possibly be due, and not already written for the last
-- milestone -- and description-refresh.ts decides which milestone a given
-- vehicle is actually owed. Two copies of the ladder would drift; a test pins
-- the two numbers below to REFRESH_MILESTONES.

ALTER TABLE public.description_cases
  ADD COLUMN IF NOT EXISTS last_refresh_milestone integer;

COMMENT ON COLUMN public.description_cases.last_refresh_milestone IS
  'Days-in-inventory milestone the current description was written for (60, 200). NULL = original ingest. Set by description-orchestrate; the ladder lives in _shared/description-refresh.ts.';

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
    -- Aged out of its current copy. Lowest priority: a vehicle with no
    -- description at all, or one actively failing, is worth more than a
    -- rewrite of copy that still reads correctly.
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'refresh_due', 5
      FROM public.description_cases dc
      JOIN public.vehicle_listings vl
        ON vl.id = dc.vehicle_id AND vl.tenant_id = dc.tenant_id
     WHERE dc.archived_at IS NULL
       AND dc.status NOT IN ('ARCHIVED','FAILED_BLOCKED')
       AND dc.published_master_version_id IS NOT NULL
       -- A human chose this copy. Age never overrides that.
       AND dc.master_locked IS NOT TRUE
       AND COALESCE(dc.last_refresh_milestone, 0) < 200
       AND (p_sweep_start IS NULL OR dc.last_orchestrated_at IS NULL
            OR dc.last_orchestrated_at < p_sweep_start)
       -- Days on market from the provider is the vehicle's real age on the
       -- lot. Our own ingest date restarts the clock for every car that was
       -- already in stock at onboarding: on this lot the oldest row is 79 days
       -- old while the oldest vehicle has been listed 883 days. The jsonb value
       -- is text and is not guaranteed numeric, so it is matched before it is
       -- cast rather than cast inside a subquery that could still be hoisted.
       AND COALESCE(
             CASE WHEN vl.mc_attributes->>'dom' ~ '^[0-9]+$'
                  THEN (vl.mc_attributes->>'dom')::int END,
             GREATEST(0, (EXTRACT(EPOCH FROM (now() - vl.created_at)) / 86400)::int)
           ) >= 60
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
