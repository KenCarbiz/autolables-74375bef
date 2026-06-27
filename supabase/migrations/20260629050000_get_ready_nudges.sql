-- ─────────────────────────────────────────────────────────────────────────
-- Get-Ready nudges: a daily digest that chases unfinished safety inspections.
--
-- Opt-in: only fires for dealers who turned on require_safety_inspection. For
-- those, it lists used/cpo cars that have been in inventory > 12h with no signed
-- K-208, and emails the service/manager/admin members a digest with one-tap
-- Get-Ready links. Throttled to once/day per tenant via get_ready_nudge_log.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.get_ready_nudge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  stuck_count int,
  recipient_count int
);
CREATE INDEX IF NOT EXISTS get_ready_nudge_log_tenant_idx ON public.get_ready_nudge_log (tenant_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.get_ready_nudge_payload(p_tenant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_recipients jsonb; v_stuck jsonb;
BEGIN
  SELECT (settings ->> 'require_safety_inspection')::boolean INTO v_require
    FROM public.dealer_profiles WHERE tenant_id = p_tenant_id;
  IF NOT coalesce(v_require, false) THEN
    RETURN jsonb_build_object('recipients', '[]'::jsonb, 'stuck', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(DISTINCT email) FILTER (WHERE email IS NOT NULL AND email <> ''), '[]'::jsonb)
    INTO v_recipients
  FROM (
    SELECT coalesce(u.email, tm.invited_email) AS email
    FROM public.tenant_members tm
    LEFT JOIN auth.users u ON u.id = tm.user_id
    WHERE tm.tenant_id = p_tenant_id AND tm.role IN ('owner','admin','manager','service')
  ) q;

  SELECT coalesce(jsonb_agg(row_to_json(s) ORDER BY (s).created_at), '[]'::jsonb) INTO v_stuck
  FROM (
    SELECT vl.vin, vl.ymm, vl.created_at,
      (SELECT dt.token FROM public.dept_signoff_tokens dt
         WHERE dt.tenant_id = vl.tenant_id AND dt.vin = vl.vin
           AND dt.department = 'vehicle' AND dt.status = 'pending' LIMIT 1) AS ready_token
    FROM public.vehicle_listings vl
    WHERE vl.tenant_id = p_tenant_id
      AND lower(coalesce(vl.condition, 'used')) IN ('used','cpo','certified')
      AND vl.created_at < now() - interval '12 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.safety_inspections si
        WHERE si.tenant_id = vl.tenant_id AND si.vin = vl.vin AND si.status = 'signed')
    ORDER BY vl.created_at
    LIMIT 40
  ) s;

  RETURN jsonb_build_object('recipients', v_recipients, 'stuck', v_stuck);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_ready_nudge_payload(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ready_nudge_payload(uuid) TO service_role;
