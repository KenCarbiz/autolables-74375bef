-- ── 20260727040000: recon estimates reconcile ──
DO $$
DECLARE n int;
BEGIN
  UPDATE public.recon_estimates
     SET status = 'voided', updated_at = now()
   WHERE status = 'submitted'
     AND (origin = 'ingest' OR submitted_role = 'system')
     AND created_at < now() - interval '48 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, details)
    VALUES ('recon_estimates_reconciled', 'system', 'ingest_backlog',
            jsonb_build_object('voided', n,
              'reason', 'auto-seeded at ingest with no decision workflow; superseded by the service_requests approval loop'));
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ── 20260727050000: work items from exceptions ──
CREATE OR REPLACE FUNCTION public.work_item_from_vehicle_exception()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_text text;
  v_work_type text;
  v_department text;
  v_priority text;
  v_title text;
  v_meta jsonb;
BEGIN
  BEGIN
    v_work_type := 'exception_' || coalesce(NEW.exception_type, 'unknown');
    v_text := coalesce(NEW.title, '') || ' ' || coalesce(NEW.explanation, '') || ' ' || coalesce(NEW.exception_type, '');
    v_priority := CASE WHEN v_text ~* '(safety|recall)' THEN 'high' ELSE 'normal' END;
    v_department := CASE
      WHEN v_text ~* '(safety|recall)' THEN 'service'
      WHEN NEW.exception_type = 'artifact_autogen_failed' THEN 'passport'
      ELSE 'inventory'
    END;
    IF EXISTS (
      SELECT 1 FROM public.dealer_work_items w
       WHERE w.tenant_id = NEW.tenant_id AND w.vin = NEW.vin
         AND w.work_type = v_work_type AND w.status NOT IN ('completed','cancelled')
    ) THEN RETURN NEW; END IF;
    SELECT ymm INTO v_title FROM public.vehicle_listings WHERE id = NEW.vehicle_listing_id;
    v_meta := jsonb_build_object('exception_id', NEW.id,
      'exception_type', NEW.exception_type, 'severity', NEW.severity);
    IF NEW.vehicle_listing_id IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_object('deep_link', '/vehicle-file/' || NEW.vehicle_listing_id::text);
    END IF;
    INSERT INTO public.dealer_work_items
      (tenant_id, vehicle_id, vin, stock, vehicle_title, work_type, title, description,
       status, priority, department, source, metadata)
    VALUES
      (NEW.tenant_id, NEW.vehicle_listing_id, NEW.vin, NEW.stock_number, v_title,
       v_work_type, coalesce(nullif(btrim(NEW.title), ''), 'Vehicle exception'),
       coalesce(NEW.explanation, NEW.recommended_action),
       'open', v_priority, v_department, 'vehicle_exception', v_meta);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS vehicle_exceptions_open_work_item ON public.vehicle_exceptions;
CREATE TRIGGER vehicle_exceptions_open_work_item
  AFTER INSERT ON public.vehicle_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.work_item_from_vehicle_exception();

INSERT INTO public.dealer_work_items
  (tenant_id, vehicle_id, vin, stock, vehicle_title, work_type, title, description,
   status, priority, department, source, metadata)
SELECT e.tenant_id, e.vehicle_listing_id, e.vin, e.stock_number, l.ymm,
       'exception_' || coalesce(e.exception_type, 'unknown'),
       coalesce(nullif(btrim(e.title), ''), 'Vehicle exception'),
       coalesce(e.explanation, e.recommended_action),
       'open',
       CASE WHEN t.txt ~* '(safety|recall)' THEN 'high' ELSE 'normal' END,
       CASE WHEN t.txt ~* '(safety|recall)' THEN 'service'
            WHEN e.exception_type = 'artifact_autogen_failed' THEN 'passport'
            ELSE 'inventory' END,
       'vehicle_exception',
       jsonb_build_object('exception_id', e.id, 'exception_type', e.exception_type, 'severity', e.severity)
       || CASE WHEN e.vehicle_listing_id IS NOT NULL
               THEN jsonb_build_object('deep_link', '/vehicle-file/' || e.vehicle_listing_id::text)
               ELSE '{}'::jsonb END
  FROM public.vehicle_exceptions e
  LEFT JOIN public.vehicle_listings l ON l.id = e.vehicle_listing_id
 CROSS JOIN LATERAL (
   SELECT coalesce(e.title, '') || ' ' || coalesce(e.explanation, '') || ' ' || coalesce(e.exception_type, '') AS txt
 ) t
 WHERE e.resolved_at IS NULL AND e.status IN ('open','in_progress')
   AND NOT EXISTS (
     SELECT 1 FROM public.dealer_work_items w
      WHERE w.tenant_id = e.tenant_id AND w.vin = e.vin
        AND w.work_type = 'exception_' || coalesce(e.exception_type, 'unknown')
        AND w.status NOT IN ('completed','cancelled'));

-- ── 20260727060000: auto-assign K-208 on release ──
CREATE OR REPLACE FUNCTION public.authorize_vehicle_for_get_ready(p_vehicle_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.vehicle_lifecycle%ROWTYPE;
  v_authorized boolean;
  v_member record;
  v_settled text;
  v_assignee uuid;
BEGIN
  SELECT * INTO v_row FROM public.vehicle_lifecycle WHERE vehicle_id = p_vehicle_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'lifecycle row not found'; END IF;
  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
        AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager','used_car_manager','inventory_manager','sales_manager')
    ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
    IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized'; END IF;
  END IF;
  IF v_row.authorized_at IS NOT NULL AND v_row.state <> 'AWAITING_MANAGER_AUTHORIZATION' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_authorized',
      'authorized_at', v_row.authorized_at, 'authorized_by', v_row.authorized_by);
  END IF;
  IF v_row.state NOT IN ('AWAITING_MANAGER_AUTHORIZATION','INGESTED','PRELOAD_RUNNING','PRELOAD_EXCEPTION') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_awaiting', 'state', v_row.state);
  END IF;
  UPDATE public.vehicle_lifecycle
  SET state = 'AUTHORIZED_FOR_GET_READY', state_changed_by = v_uid,
      authorized_by = v_uid, authorized_at = now(), gate_reason = p_note
  WHERE id = v_row.id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('vehicle_authorized_for_get_ready', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object('prev_state', v_row.state, 'note', p_note));
  FOR v_member IN
    SELECT tm.user_id FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN ('service_manager','service_advisor','service')
  LOOP
    INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
    VALUES (v_row.tenant_id, v_member.user_id, 'vehicle_released_to_service',
            'vehicle_released:' || v_row.tenant_id || ':' || v_row.vin || ':' || v_member.user_id,
            v_row.vin, jsonb_build_object('note', p_note))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
  BEGIN
    IF (SELECT dp.settings->>'service_auto_assign' FROM public.dealer_profiles dp
        WHERE dp.tenant_id = v_row.tenant_id) = 'round_robin' THEN
      UPDATE public.safety_inspections si
      SET assigned_to = (
            SELECT tm.user_id FROM public.tenant_members tm
            LEFT JOIN public.safety_inspections open_si
              ON open_si.tenant_id = tm.tenant_id
             AND open_si.assigned_to = tm.user_id
             AND open_si.status = 'pending'
            WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL
              AND lower(trim(tm.role)) IN ('service','service_advisor','detail')
            GROUP BY tm.user_id
            ORDER BY count(open_si.id) ASC, tm.user_id ASC LIMIT 1),
          updated_at = now()
      WHERE si.id = (
              SELECT id FROM public.safety_inspections
              WHERE tenant_id = v_row.tenant_id AND vin = v_row.vin
                AND status = 'pending' AND assigned_to IS NULL
              ORDER BY created_at ASC LIMIT 1)
        AND EXISTS (
              SELECT 1 FROM public.tenant_members tm
              WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL
                AND lower(trim(tm.role)) IN ('service','service_advisor','detail'))
      RETURNING si.assigned_to INTO v_assignee;
      IF v_assignee IS NOT NULL THEN
        INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
        VALUES ('inspection_auto_assigned', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
                jsonb_build_object('assigned_to', v_assignee, 'strategy', 'round_robin'));
        INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
        VALUES (v_row.tenant_id, v_assignee, 'inspection_assigned',
                'auto_assign:' || v_row.tenant_id || ':' || v_row.vin,
                v_row.vin, jsonb_build_object('strategy', 'round_robin'))
        ON CONFLICT (dedupe_key) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  v_settled := public.recompute_vehicle_lifecycle(v_row.tenant_id, p_vehicle_id);
  RETURN jsonb_build_object('ok', true, 'state', coalesce(v_settled, 'AUTHORIZED_FOR_GET_READY'));
END; $$;
REVOKE ALL ON FUNCTION public.authorize_vehicle_for_get_ready(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_vehicle_for_get_ready(uuid, text) TO authenticated, service_role;

-- ── 20260727070000: factory sticker foundation ──
ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_document_type_check;
ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_document_type_check
  CHECK (document_type IN ('window','addendum','passport','cpo_sheet','buyers_guide','k208','factory_sticker'));

ALTER TABLE public.signed_document_archive
  DROP CONSTRAINT IF EXISTS signed_document_archive_doc_type_check;
ALTER TABLE public.signed_document_archive
  ADD CONSTRAINT signed_document_archive_doc_type_check
  CHECK (doc_type IN ('addendum','deal','sticker','buyers_guide','prep_signoff','disclosure','k208','factory_sticker'));

CREATE TABLE IF NOT EXISTS public.neovin_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id    uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  vin           text NOT NULL,
  endpoint      text,
  payload       jsonb NOT NULL,
  payload_hash  text,
  http_status   integer,
  raw_key_count integer,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.neovin_snapshots TO service_role;
CREATE INDEX IF NOT EXISTS idx_neovin_snapshots_tenant_vin
  ON public.neovin_snapshots (tenant_id, vin, fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_neovin_snapshots_dedupe
  ON public.neovin_snapshots (tenant_id, vin, payload_hash);
ALTER TABLE public.neovin_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.factory_sticker_records (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id                  uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin                         text NOT NULL,
  generation_status           text NOT NULL DEFAULT 'PENDING_DATA'
                                CHECK (generation_status IN (
                                  'PENDING_DATA','NORMALIZING','VALIDATING','REVIEW_REQUIRED',
                                  'READY_TO_GENERATE','GENERATING','RUNNING_QA','APPROVED',
                                  'PUBLISHED','FAILED_RETRYABLE','FAILED_PERMANENT',
                                  'SUPERSEDED','ARCHIVED')),
  source_provider             text,
  source_classification       text,
  confidence_level            text,
  verification_status         text,
  reconciliation_status       text,
  reconciliation_difference   numeric,
  review_required             boolean NOT NULL DEFAULT false,
  review_reason               text,
  normalized_data_json        jsonb,
  canonical_oem_id            text,
  detected_make_value         text,
  oem_resolution_confidence   text,
  oem_theme_id                text,
  oem_theme_version           text,
  template_family_id          text,
  template_version            text,
  renderer_version            text,
  logo_asset_id               text,
  logo_asset_version          text,
  passport_slug               text,
  canonical_passport_url      text,
  qr_payload                  text,
  qr_identity_qa_status       text,
  barcode_payload             text,
  barcode_identity_qa_status  text,
  visual_qa_status            text,
  qa_metadata                 jsonb,
  generation_fingerprint      text,
  current_document_id         uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  attempt_count               integer NOT NULL DEFAULT 0,
  last_error                  text,
  reviewed_by                 uuid REFERENCES auth.users(id),
  reviewed_at                 timestamptz,
  approved_by                 uuid REFERENCES auth.users(id),
  approved_at                 timestamptz,
  published_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT factory_sticker_records_tenant_vehicle_key UNIQUE (tenant_id, vehicle_id)
);
GRANT SELECT ON public.factory_sticker_records TO authenticated;
GRANT ALL ON public.factory_sticker_records TO service_role;
CREATE INDEX IF NOT EXISTS idx_factory_sticker_records_tenant_status
  ON public.factory_sticker_records (tenant_id, generation_status);
CREATE INDEX IF NOT EXISTS idx_factory_sticker_records_tenant_vin
  ON public.factory_sticker_records (tenant_id, vin);
ALTER TABLE public.factory_sticker_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "factory_sticker_records_read" ON public.factory_sticker_records;
CREATE POLICY "factory_sticker_records_read"
  ON public.factory_sticker_records FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                       WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.factory_sticker_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.generation_status = OLD.generation_status THEN
    NEW.updated_at := now(); RETURN NEW;
  END IF;
  IF OLD.generation_status = 'FAILED_PERMANENT'
     AND NEW.generation_status NOT IN ('ARCHIVED','PENDING_DATA') THEN
    RAISE EXCEPTION 'invalid factory sticker transition % -> %', OLD.generation_status, NEW.generation_status;
  END IF;
  IF OLD.generation_status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'invalid factory sticker transition % -> %', OLD.generation_status, NEW.generation_status;
  END IF;
  IF OLD.generation_status = 'ARCHIVED' AND NEW.generation_status <> 'PENDING_DATA' THEN
    RAISE EXCEPTION 'invalid factory sticker transition % -> %', OLD.generation_status, NEW.generation_status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_factory_sticker_guard ON public.factory_sticker_records;
CREATE TRIGGER trg_factory_sticker_guard
  BEFORE UPDATE ON public.factory_sticker_records
  FOR EACH ROW EXECUTE FUNCTION public.factory_sticker_transition_guard();

CREATE OR REPLACE FUNCTION public.factory_sticker_on_listing_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      UPDATE public.factory_sticker_records
      SET generation_status = 'ARCHIVED'
      WHERE tenant_id = OLD.tenant_id AND vehicle_id = OLD.id
        AND generation_status NOT IN ('ARCHIVED','SUPERSEDED');
      RETURN OLD;
    END IF;
    IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
      UPDATE public.factory_sticker_records
      SET generation_status = 'ARCHIVED'
      WHERE tenant_id = NEW.tenant_id AND vehicle_id = NEW.id
        AND generation_status NOT IN ('ARCHIVED','SUPERSEDED');
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_factory_sticker_on_listing_archive ON public.vehicle_listings;
CREATE TRIGGER trg_factory_sticker_on_listing_archive
  AFTER UPDATE OF status ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.factory_sticker_on_listing_archive();
DROP TRIGGER IF EXISTS trg_factory_sticker_on_listing_delete ON public.vehicle_listings;
CREATE TRIGGER trg_factory_sticker_on_listing_delete
  BEFORE DELETE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.factory_sticker_on_listing_archive();