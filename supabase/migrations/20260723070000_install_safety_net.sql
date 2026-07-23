-- ──────────────────────────────────────────────────────────────────────
-- Safety net: flip un-installed "installed (pending proof)" lines to OPTIONAL.
--
-- Slice 4 adds a get-ready accessory to the addendum as installed with
-- install_pending=true. If the installer never submits proof within the
-- dealer's window (settings.install_safety_net_days, default 3, measured from
-- when the get-ready was dispatched), a car must not sell as "installed" for
-- work that never happened. This nightly sweep demotes any still-pending line
-- to badge_type='optional' (recompute is client-side off the snapshot). Lines
-- that DID get a verified install proof are confirmed installed and lose the
-- pending flag. Runs daily via pg_cron.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_getready_install_safety_net()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a record; e jsonb; v_new jsonb; v_changed boolean; v_has_proof boolean; v_flipped int := 0;
BEGIN
  FOR a IN
    SELECT ad.id, ad.tenant_id, ad.vehicle_vin, ad.products_snapshot, ad.getready_dispatched_at,
           coalesce((dp.settings ->> 'install_safety_net_days')::int, 3) AS days
    FROM public.addendums ad
    LEFT JOIN public.dealer_profiles dp ON dp.tenant_id = ad.tenant_id
    WHERE ad.getready_dispatched_at IS NOT NULL
      AND coalesce(ad.status, '') <> 'signed'
      AND ad.products_snapshot::text LIKE '%"install_pending"%'
  LOOP
    -- Window starts when the get-ready was dispatched to the shop.
    IF a.getready_dispatched_at > now() - make_interval(days => greatest(a.days, 0)) THEN CONTINUE; END IF;

    v_changed := false;
    v_new := '[]'::jsonb;
    FOR e IN SELECT * FROM jsonb_array_elements(coalesce(a.products_snapshot, '[]'::jsonb))
    LOOP
      IF (e ->> 'install_pending')::boolean IS TRUE AND coalesce(e ->> 'badge_type', '') = 'installed' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.install_proofs ip
          WHERE ip.tenant_id = a.tenant_id AND upper(ip.vin) = upper(a.vehicle_vin)
            AND ip.is_verified = true
            AND (ip.product_id = (e ->> 'id') OR lower(ip.product_name) = lower(coalesce(e ->> 'name', '')))
        ) INTO v_has_proof;

        IF v_has_proof THEN
          v_new := v_new || jsonb_build_array(e - 'install_pending');   -- confirmed installed
        ELSE
          v_new := v_new || jsonb_build_array(e || jsonb_build_object('badge_type', 'optional', 'install_pending', false, 'flipped_to_optional', true));
          v_changed := true; v_flipped := v_flipped + 1;
        END IF;
      ELSE
        v_new := v_new || jsonb_build_array(e);
      END IF;
    END LOOP;

    IF v_changed THEN
      UPDATE public.addendums SET products_snapshot = v_new, updated_at = now() WHERE id = a.id;
      BEGIN
        INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
        VALUES ('install_safety_net_flip', 'vehicle', a.vehicle_vin, a.tenant_id::text, jsonb_build_object('addendum_id', a.id));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END LOOP;

  RETURN v_flipped;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sweep_getready_install_safety_net() TO service_role;

-- Schedule it daily at 04:30 UTC (idempotent).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'getready-install-safety-net';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('getready-install-safety-net', '30 4 * * *', 'SELECT public.sweep_getready_install_safety_net();');
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not available in this environment — the function can still be
  -- invoked manually / by an external scheduler.
  NULL;
END $$;
