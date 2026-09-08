-- Get Ready is created automatically for EVERY ingested vehicle, split by
-- department.
--
-- Before this migration create_draft_get_ready returned NULL for anything that
-- was not used/cpo/certified, so on the live tenant 64 of 134 active vehicles
-- had a Get Ready record and the 70 new cars had none -- even though a new car
-- still has to be washed, detailed, photographed and made lot-ready before it
-- can be sold. The used-vehicle SERVICE worklist (K-208, mechanical, tires,
-- brakes) genuinely does not apply to new stock, so the split is by department
-- rather than by whole record:
--
--   * used / cpo / certified -> service worklist + detail worklist (unchanged)
--   * new (and any other condition) -> detail worklist only, no inspection
--
-- One record per (tenant, vin) either way. The record is created populated and
-- waits only for the manager's additional instructions before dispatch; it is
-- never blocked on a human to exist.
--
-- Deliberately unchanged: recompute_vehicle_lifecycle still returns early for
-- new stock, so a new car gets a detail worklist WITHOUT a vehicle_lifecycle
-- row and without entering the used-vehicle service queue or the recon counts.
-- The lifecycle vocabulary is not extended here.

-- Default work items come from the dealer's own standard_prep_templates when
-- they have any for that department + condition; the built-in list below is the
-- fallback. The table was created in 20260622182000 for exactly this and had no
-- reader until now. Item elements are tolerated as plain strings or as objects
-- carrying label/title/name plus an optional category.
CREATE OR REPLACE FUNCTION public.get_ready_template_items(
  p_tenant_id uuid, p_condition text, p_department text
) RETURNS jsonb
LANGUAGE sql SET search_path = public
AS $function$
  SELECT jsonb_agg(line ORDER BY ord)
  FROM (
    SELECT
      row_number() OVER (ORDER BY t.created_at, t.id, e.ord) AS ord,
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'category', coalesce(nullif(lower(trim(coalesce(e.item ->> 'category', ''))), ''), p_department),
        'department', p_department,
        'label', coalesce(
          nullif(trim(coalesce(e.item ->> 'label', '')), ''),
          nullif(trim(coalesce(e.item ->> 'title', '')), ''),
          nullif(trim(coalesce(e.item ->> 'name', '')), ''),
          CASE WHEN jsonb_typeof(e.item) = 'string' THEN nullif(trim(e.item #>> '{}'), '') END
        ),
        'status', 'pending',
        'internal', true
      ) AS line
    FROM public.standard_prep_templates t
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(t.items, '[]'::jsonb))
      WITH ORDINALITY AS e(item, ord)
    WHERE t.tenant_id = p_tenant_id
      AND coalesce(t.active, true)
      AND lower(trim(coalesce(t.department, ''))) = p_department
      AND lower(trim(coalesce(t.condition, ''))) IN (
        lower(coalesce(p_condition, '')),
        CASE WHEN lower(coalesce(p_condition, '')) IN ('used', 'cpo', 'certified') THEN 'used' ELSE 'new' END,
        'all', 'any', '')
      AND coalesce(
          nullif(trim(coalesce(e.item ->> 'label', '')), ''),
          nullif(trim(coalesce(e.item ->> 'title', '')), ''),
          nullif(trim(coalesce(e.item ->> 'name', '')), ''),
          CASE WHEN jsonb_typeof(e.item) = 'string' THEN nullif(trim(e.item #>> '{}'), '') END
        ) IS NOT NULL
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.get_ready_template_items(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ready_template_items(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_ready_template_items(uuid, text, text) IS
  'The dealer''s standard_prep_templates lines for one department + condition, shaped as get_ready_records.items. NULL when the dealer has no template, so the caller falls back to the built-in list.';

CREATE OR REPLACE FUNCTION public.create_draft_get_ready(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_cond text; v_status text; v_ymm text; v_stock text;
  v_existing uuid; v_id uuid;
  v_needs_service boolean;
  v_items jsonb := '[]'::jsonb;
  v_service jsonb; v_detail jsonb;
  v_vendor record;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_member_or_service(p_tenant_id);

  SELECT id, lower(coalesce(condition, 'used')), coalesce(status, ''), coalesce(ymm, ''),
         coalesce(mc_attributes->>'stock_no', '')
    INTO v_listing_id, v_cond, v_status, v_ymm, v_stock
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND upper(vin) = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;
  -- An archived vehicle is not prepared for sale. Seeding one is how the table
  -- accumulated records for cars sold months ago (20260907160000).
  IF v_status = 'archived' THEN RETURN NULL; END IF;

  -- Same test recompute_vehicle_lifecycle uses, so the two never disagree about
  -- which vehicles carry used-vehicle service work.
  v_needs_service := v_cond IN ('used', 'cpo', 'certified');

  -- Stock lives on vehicle_files (marketcheck-sync writes stock_number there);
  -- mc_attributes->>'stock_no' is only a legacy fallback.
  v_stock := coalesce(
    (SELECT nullif(trim(stock_number), '') FROM public.vehicle_files
      WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1),
    nullif(v_stock, ''), '');

  -- Idempotent on (tenant, vin): re-sync, sweep and backfill all land here.
  -- Case-insensitive, because dms-webhook and autocurb-sync store the
  -- provider's spelling verbatim: an existing lowercase record matched by an
  -- equality test would be missed and a SECOND row minted for the same car,
  -- which the unique index cannot catch because the two VIN strings differ.
  SELECT id INTO v_existing FROM public.get_ready_records
    WHERE tenant_id = p_tenant_id AND upper(vin) = v_vin LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  -- Service list (spec S3) -- used/CPO only. Oil & filter is seeded
  -- unconditionally: no dealer settings key governs it today
  -- (recon_canned_services carries it only as a recon estimate line), so the
  -- manager removes it where not wanted.
  IF v_needs_service THEN
    v_service := public.get_ready_template_items(p_tenant_id, v_cond, 'service');
    IF v_service IS NULL THEN
      v_service := jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'inspection',     'department', 'service', 'label', 'CT K-208 safety inspection',      'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'mechanical',     'department', 'service', 'label', 'Mechanical inspection',           'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'tires',          'department', 'service', 'label', 'Tires: tread depth & condition',  'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'brakes',         'department', 'service', 'label', 'Brakes: pads, rotors & lines',    'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'fluids',         'department', 'service', 'label', 'Fluids: levels & leaks',          'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'warning_lights', 'department', 'service', 'label', 'Warning lights & dash indicators','status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'recall',         'department', 'service', 'label', 'Open recall review',              'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'diagnostics',    'department', 'service', 'label', 'Diagnostics scan',                'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'oil',            'department', 'service', 'label', 'Oil & filter change',             'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'battery',        'department', 'service', 'label', 'Battery test',                    'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'maintenance',    'department', 'service', 'label', 'Scheduled maintenance review',    'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'keys',           'department', 'service', 'label', 'Keys & remotes accounted for',    'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'fuel',           'department', 'service', 'label', 'Fuel level / state of charge',    'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'docs',           'department', 'service', 'label', 'Owner manuals & service records', 'status', 'pending', 'internal', true),
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'reinspection',   'department', 'service', 'label', 'Reinspection after repairs (if required)', 'status', 'pending', 'internal', true)
      );
      IF v_cond IN ('cpo', 'certified') THEN
        v_service := v_service || jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid()::text, 'category', 'cpo', 'department', 'service', 'label', 'CPO certification inspection', 'status', 'pending', 'internal', true)
        );
      END IF;
    END IF;
    v_items := v_items || v_service;
  END IF;

  -- Prep / detail list (spec S3) -- every vehicle, new stock included.
  v_detail := public.get_ready_template_items(p_tenant_id, v_cond, 'detail');
  IF v_detail IS NULL THEN
    v_detail := jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'detail',   'department', 'detail', 'label', 'Interior detail',            'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'detail',   'department', 'detail', 'label', 'Exterior detail',            'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'wash',     'department', 'detail', 'label', 'Wash',                       'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'decon',    'department', 'detail', 'label', 'Decontamination',            'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'odor',     'department', 'detail', 'label', 'Odor treatment (if instructed)', 'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'touch_up', 'department', 'detail', 'label', 'Paint touch-up',             'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'dent',     'department', 'detail', 'label', 'Dent review',                'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'wheels',   'department', 'detail', 'label', 'Wheel review',               'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'glass',    'department', 'detail', 'label', 'Glass review',               'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'photo',    'department', 'detail', 'label', 'Photo readiness',            'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'lot',      'department', 'detail', 'label', 'Lot readiness',              'status', 'pending', 'internal', true),
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'fuel',     'department', 'detail', 'label', 'Fuel / charge for the lot',  'status', 'pending', 'internal', true)
    );
    IF NOT v_needs_service THEN
      v_detail := v_detail || jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid()::text, 'category', 'detail', 'department', 'detail', 'label', 'Remove transport protection & shipping film', 'status', 'pending', 'internal', true)
      );
    END IF;
  END IF;
  v_items := v_items || v_detail;

  -- Unassigned vendor draft lines from the dealer's configured providers.
  -- Drafts until the manager confirms provider, pricing, and instructions.
  --
  -- Used/CPO only, and deliberately so. A line nobody owns still counts against
  -- the "every item complete" rollup that moves a record to ready, so seeding
  -- one per active installer onto all 70 new cars would mint work that no
  -- department drains. A new car that does get an accessory picks its line up
  -- from the addendum path (useGetReady.createGetReady), which merges into this
  -- same record.
  FOR v_vendor IN
    SELECT company, product FROM public.installer_contacts
    WHERE tenant_id = p_tenant_id AND active AND v_needs_service
    ORDER BY company
  LOOP
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text, 'category', 'vendor', 'department', 'vendor',
        'label', 'Vendor: ' || v_vendor.company || coalesce(' - ' || nullif(trim(v_vendor.product), ''), ''),
        'status', 'pending', 'internal', true,
        'vendor_company', v_vendor.company,
        'vendor_product', v_vendor.product,
        'vendor_confirmed', false
      )
    );
  END LOOP;

  INSERT INTO public.get_ready_records (
    tenant_id, store_id, vin, stock_number, ymm, condition,
    get_ready_start_date, items, accessories_to_install,
    inspection_required, inspection_form_type, status, created_by,
    reconciliation_state
  ) VALUES (
    p_tenant_id, p_tenant_id::text, v_vin, v_stock, v_ymm,
    CASE WHEN v_needs_service THEN 'used' ELSE 'new' END,
    now(), v_items, '[]'::jsonb,
    v_needs_service, CASE WHEN v_needs_service THEN 'CT-K208' END,
    'pending', 'ingest_autogen',
    'current'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  -- Lost the race with a concurrent ingest: return the row that won.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.get_ready_records
      WHERE tenant_id = p_tenant_id AND upper(vin) = v_vin LIMIT 1;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_get_ready(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_get_ready(uuid, text) TO authenticated, service_role;

-- Safety net for the detail record, mirroring sweep_missing_intake_drafts
-- (20260726040000) -- which is deliberately left used-only, because every other
-- RPC it runs is a used-vehicle artifact. This one covers ALL conditions and
-- calls the single idempotent RPC, so a new car whose ingest hook failed still
-- gets its detail worklist the same night.
CREATE OR REPLACE FUNCTION public.sweep_missing_get_ready(_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  r record; v_scanned integer := 0; v_created integer := 0; v_failed integer := 0; v_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN RAISE EXCEPTION 'insufficient_permission'; END IF;

  FOR r IN
    SELECT v.tenant_id, v.vin FROM public.vehicle_listings v
    WHERE v.tenant_id IS NOT NULL
      AND coalesce(trim(v.vin), '') <> ''
      AND coalesce(v.status, '') <> 'archived'
      AND NOT EXISTS (
        SELECT 1 FROM public.get_ready_records g
        WHERE g.tenant_id = v.tenant_id AND upper(g.vin) = upper(trim(v.vin)))
    ORDER BY v.created_at DESC LIMIT _limit
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      v_id := public.create_draft_get_ready(r.tenant_id, r.vin);
      IF v_id IS NOT NULL THEN v_created := v_created + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('scanned', v_scanned, 'created', v_created, 'failed', v_failed);
END $function$;

REVOKE ALL ON FUNCTION public.sweep_missing_get_ready(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_missing_get_ready(integer) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'get-ready-sweep';
  PERFORM cron.schedule('get-ready-sweep', '25 3 * * *',
    'SELECT public.sweep_missing_get_ready();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'get-ready-sweep not scheduled (%); schedule it once pg_cron is available', SQLERRM;
END $$;

-- Backfill the fleet standing on the lot today: every active listing with no
-- record gets one. Existing records are never touched, so manager edits and the
-- 20260907160000 classification both survive.
DO $$
DECLARE r record; v_created int := 0; v_id uuid;
BEGIN
  FOR r IN
    SELECT v.tenant_id, v.vin FROM public.vehicle_listings v
    WHERE v.tenant_id IS NOT NULL
      AND coalesce(trim(v.vin), '') <> ''
      AND coalesce(v.status, '') <> 'archived'
      AND NOT EXISTS (
        SELECT 1 FROM public.get_ready_records g
        WHERE g.tenant_id = v.tenant_id AND upper(g.vin) = upper(trim(v.vin)))
  LOOP
    BEGIN
      v_id := public.create_draft_get_ready(r.tenant_id, r.vin);
      IF v_id IS NOT NULL THEN v_created := v_created + 1; END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'get_ready backfill: created % record(s)', v_created;
END $$;

-- Records created before 20260907160000 classified nothing; anything seeded
-- from here on states its own state, and this closes the gap for rows created
-- between that migration and this one.
UPDATE public.get_ready_records g
   SET reconciliation_state = 'current',
       reconciled_at = now(),
       reconciliation_note = 'Active inventory; operational state remains the workflow''s to set.'
 WHERE g.reconciliation_state IS NULL
   AND EXISTS (SELECT 1 FROM public.vehicle_listings v
                WHERE v.tenant_id = g.tenant_id AND upper(v.vin) = upper(g.vin)
                  AND coalesce(v.status, '') <> 'archived');
