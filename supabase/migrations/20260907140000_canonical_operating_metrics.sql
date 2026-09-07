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
    -- is historical evidence a vehicle was once published and is non-null on
    -- every archived row.
    SELECT v.id, v.vin
    FROM public.vehicle_listings v
    WHERE v.tenant_id = p_tenant_id
      AND coalesce(v.status,'') <> 'archived'
  ),
  lc AS (
    SELECT a.id AS vehicle_id,
           l.state,
           public.lifecycle_bucket(l.state) AS bucket
    FROM active a
    LEFT JOIN public.vehicle_lifecycle l
      ON l.vehicle_id = a.id AND l.tenant_id = p_tenant_id
  )
  SELECT jsonb_build_object(
    'active_inventory',        (SELECT count(*) FROM active),
    'published_inventory',     (SELECT count(*) FROM public.vehicle_listings
                                 WHERE tenant_id = p_tenant_id AND status = 'published'),
    -- Coverage, so a partially-populated lifecycle can never be mistaken for
    -- an empty shop floor.
    'lifecycle_tracked',       (SELECT count(*) FROM lc WHERE state IS NOT NULL),
    'lifecycle_untracked',     (SELECT count(*) FROM lc WHERE state IS NULL),
    'in_get_ready',            (SELECT count(*) FROM lc
                                 WHERE bucket IN ('INTAKE','SERVICE','PREP','VERIFIED')),
    'get_ready_intake',        (SELECT count(*) FROM lc WHERE bucket = 'INTAKE'),
    'get_ready_service',       (SELECT count(*) FROM lc WHERE bucket = 'SERVICE'),
    'get_ready_prep',          (SELECT count(*) FROM lc WHERE bucket = 'PREP'),
    'get_ready_verified',      (SELECT count(*) FROM lc WHERE bucket = 'VERIFIED'),
    'retail_ready',            (SELECT count(*) FROM lc WHERE bucket = 'READY'),
    'gated',                   (SELECT count(*) FROM lc WHERE bucket = 'GATED'),
    -- Recon is its own record type, counted as UNIQUE VEHICLES rather than
    -- estimate rows.
    -- Open recon work, as UNIQUE VEHICLES rather than estimate rows: one
    -- vehicle can carry several estimates. 'voided' and 'approved' are settled.
    'get_ready_recon',         (SELECT count(DISTINCT r.vehicle_listing_id)
                                 FROM public.recon_estimates r
                                 JOIN active a ON a.id = r.vehicle_listing_id
                                 WHERE r.tenant_id = p_tenant_id
                                   AND coalesce(r.status,'') = 'submitted'),
    'tenant_id',               p_tenant_id
  );
$$;

COMMENT ON FUNCTION public.operating_metrics(uuid) IS
  'One canonical, tenant-scoped source for operating counts. Every value counts UNIQUE VEHICLES; no metric is the sum of overlapping populations.';

GRANT EXECUTE ON FUNCTION public.lifecycle_bucket(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operating_metrics(uuid) TO authenticated;
