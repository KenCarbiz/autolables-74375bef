-- Canonical operating metrics.
--
-- Every screen had been inventing its own counts, which is how the dashboard
-- came to claim 196 vehicles in recon against 134 active vehicles. This gives
-- the app one tenant-scoped source with a named population per metric.
--
-- Authority is public.vehicle_lifecycle, whose CHECK constraint enumerates the
-- 22 canonical states. get_ready_records is deliberately NOT the authority: its
-- rows are write-once in practice (see the completion repair in this release),
-- so counting them yields every vehicle that ever entered Get Ready, including
-- ones sold months ago.
--
-- SECURITY INVOKER: the caller's RLS decides which tenants are visible, so this
-- cannot become a cross-tenant read.

-- Physical-preparation bucket for a canonical lifecycle state. Null for states
-- that are not physical preparation at all.
CREATE OR REPLACE FUNCTION public.lifecycle_bucket(p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_state IN ('INGESTED','PRELOAD_RUNNING','PRELOAD_EXCEPTION',
                     'AWAITING_MANAGER_AUTHORIZATION','AUTHORIZED_FOR_GET_READY')
      THEN 'INTAKE'
    WHEN p_state IN ('SERVICE_UNASSIGNED','K208_IN_PROGRESS','SERVICE_FINDINGS_RECORDED',
                     'WAITING_FOR_MANAGER_DECISION','RETURNED_FOR_CLARIFICATION',
                     'WORK_AUTHORIZED','REPAIR_IN_PROGRESS','REPAIR_VERIFICATION_REQUIRED',
                     'K208_READY_TO_CERTIFY','K208_FINALIZED')
      THEN 'SERVICE'
    WHEN p_state IN ('DETAIL_PENDING','DETAIL_IN_PROGRESS') THEN 'PREP'
    WHEN p_state = 'FINAL_READY_VERIFICATION' THEN 'VERIFIED'
    WHEN p_state = 'RETAIL_READY' THEN 'READY'
    WHEN p_state IN ('ON_HOLD','WHOLESALE') THEN 'GATED'
    WHEN p_state = 'REMOVED' THEN 'REMOVED'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.lifecycle_bucket(text) IS
  'Maps a canonical vehicle_lifecycle.state to its physical-preparation bucket. RECON has no dedicated lifecycle state; recon lives in recon_estimates and is reported separately.';

CREATE OR REPLACE FUNCTION public.operating_metrics(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH active AS (
    -- ACTIVE INVENTORY: still on the lot. Deliberately NOT published_at, which
    -- is non-null on every archived row and so is historical evidence rather
    -- than proof a vehicle is still here.
    SELECT v.id, v.vin, lower(coalesce(v.condition,'')) AS cond
    FROM public.vehicle_listings v
    WHERE v.tenant_id = p_tenant_id
      AND coalesce(v.status,'') <> 'archived'
  ),
  lc AS (
    SELECT a.id AS vehicle_id, a.cond, l.state,
           public.lifecycle_bucket(l.state) AS bucket
    FROM active a
    LEFT JOIN public.vehicle_lifecycle l
      ON l.vehicle_id = a.id AND l.tenant_id = p_tenant_id
  )
  SELECT jsonb_build_object(
    'active_inventory',       (SELECT count(*) FROM active),
    'published_inventory',    (SELECT count(*) FROM public.vehicle_listings
                                WHERE tenant_id = p_tenant_id AND status = 'published'),
    'new_inventory',          (SELECT count(*) FROM active WHERE cond = 'new'),
    'used_inventory',         (SELECT count(*) FROM active WHERE cond IN ('used','cpo','certified')),
    'in_get_ready',           (SELECT count(*) FROM lc
                                WHERE bucket IN ('INTAKE','SERVICE','PREP','VERIFIED')),
    'get_ready_intake',       (SELECT count(*) FROM lc WHERE bucket = 'INTAKE'),
    'get_ready_service',      (SELECT count(*) FROM lc WHERE bucket = 'SERVICE'),
    'get_ready_prep',         (SELECT count(*) FROM lc WHERE bucket = 'PREP'),
    'get_ready_verified',     (SELECT count(*) FROM lc WHERE bucket = 'VERIFIED'),
    'awaiting_authorization', (SELECT count(*) FROM lc WHERE state = 'AWAITING_MANAGER_AUTHORIZATION'),
    'retail_ready',           (SELECT count(*) FROM lc WHERE bucket = 'READY'),
    'gated',                  (SELECT count(*) FROM lc WHERE bucket = 'GATED'),
    -- Open recon work as UNIQUE VEHICLES, not estimate rows: one vehicle can
    -- carry several. 'voided' and 'approved' are settled.
    'get_ready_recon',        (SELECT count(DISTINCT r.vehicle_listing_id)
                                FROM public.recon_estimates r
                                JOIN active a ON a.id = r.vehicle_listing_id
                                WHERE r.tenant_id = p_tenant_id
                                  AND coalesce(r.status,'') = 'submitted'),
    -- A used/CPO vehicle with no lifecycle row IS a defect. A new vehicle
    -- without one is correct: recompute_vehicle_lifecycle returns early for
    -- new stock, because new cars do not run used-vehicle Get Ready.
    -- Vehicles needing a price review, NOT flag rows. 7,080 open flags on one
    -- tenant resolve to 2 vehicles, neither still on the lot; counting rows
    -- made the navigation badge read 99+ for work that does not exist.
    'price_review_required', (SELECT count(DISTINCT f.vehicle_id)
                               FROM public.stale_document_flags f
                               JOIN active a ON a.id = f.vehicle_id
                               WHERE f.tenant_id = p_tenant_id AND f.status = 'open'),
    'used_missing_lifecycle', (SELECT count(*) FROM lc
                                WHERE state IS NULL AND cond IN ('used','cpo','certified')),
    'tenant_id',              p_tenant_id
  );
$$;

COMMENT ON FUNCTION public.operating_metrics(uuid) IS
  'One canonical, tenant-scoped source for operating counts. Every value counts UNIQUE VEHICLES; no metric is the sum of overlapping populations.';

GRANT EXECUTE ON FUNCTION public.lifecycle_bucket(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operating_metrics(uuid) TO authenticated;
