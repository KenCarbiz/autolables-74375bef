-- ──────────────────────────────────────────────────────────────────────
-- PURPOSE
--
-- Recall is two questions and this database has been answering them with one
-- set of columns.
--
--   VIN scope   "does THIS VIN have an applicable open recall?"
--               VERIFIED_CLEAR | OPEN | UNKNOWN.
--               Only a VIN-level provider may answer it, and only that answer
--               may ever clear a car.
--
--   MODEL scope "does NHTSA hold campaigns for this year/make/model?"
--               MODEL_CAMPAIGNS_FOUND | NO_MODEL_CAMPAIGNS_FOUND |
--               MODEL_NOT_FOUND | LOOKUP_FAILED.
--               Useful context. Not clearance.
--
-- STALE is deliberately absent from both vocabularies: staleness is the age of
-- an answer, so readers derive it from the checked-at time. It is never stored.
--
-- Every recall answer in this database is the free model-level NHTSA fallback
-- (recall_payload->>'source' = 'nhtsa' on 276 of 285 rows), and it has been
-- written into the columns that mean VIN clearance. 2027 INFINITI QX60 is the
-- worked example: NHTSA recognises the model and returns zero campaigns, which
-- is a true statement about the model line and says nothing about any one QX60.
--
-- WHICH COLUMN CARRIES WHICH SCOPE, AND WHY
--
--   recall_status + open_recall_count + closed_recall_count + recall_check
--     = VIN scope. recall_status is what delivery clearance and the customer
--     Passport read as a clean claim and open_recall_count is read as "this car
--     has N open recalls", so the rule "only a VIN-level source may clear a
--     VIN" has to bind exactly these columns or it binds nothing.
--     recall_check becomes their provenance envelope: it is the store the
--     publish gate already consults for a recall check, and a publish gate is a
--     clearance workflow, so what satisfies it must be a VIN-level check.
--
--   recall_payload
--     = MODEL scope. All 276 non-null payloads already hold an NHTSA
--     model-level answer, so this store is being named for what it has always
--     contained rather than repurposed, and not one row has to move. It is also
--     the store vehicle-enrich already writes, so the NHTSA writer keeps writing
--     where it wrote before and no listing gains or loses a publish-gate
--     freshness date as a side effect of this change.
--
-- EVERY ZERO CARRIES PROVENANCE
--
-- A count is only reachable through the state that justifies it:
-- open_recall_count and closed_recall_count are forced NULL unless
-- recall_status is a VIN-level answer, and recall_status = 'verified_clear' is
-- rejected unless recall_check carries scope 'vin', a source and a checked-at
-- time. There is therefore no row shape in which a reader can obtain a zero
-- without also obtaining the source, the scope and the time behind it.
--
-- FORWARD SQL
--
--   1. Withdraw the counts that no state supports (open_recall_count = 0 beside
--      recall_status IS NULL) and the legacy 'clear' rows.
--   2. CHECK constraints for both vocabularies and for the provenance rule.
--   3. Recreate two triggers so that every block that fires today still fires
--      after the model answer moves out of the VIN columns.
--
-- DATA IMPACT (measured 2026-09-09, all tenants, 285 vehicle_listings rows)
--
--   123 rows  recall_status IS NULL, open_recall_count = 0, payload note
--             'no_nhtsa_record_http_400'  ->  counts set to NULL. The provider
--             response in recall_payload is left exactly as it is: it is the
--             evidence of what was asked and what came back.
--     5 rows  recall_status = 'clear' with recall_payload.rawProvider
--             'marketcheck_autorecalls' and an empty recall list  ->
--             recall_status 'unknown', counts and recall_checked_at NULL, and
--             recall_check's 'checked_at' demoted to 'attempted_at'. These five
--             are the only thing the licensed VIN product has ever produced
--             here, and every one of them is an absent record recorded as a
--             clearance — the exact defect this gate exists to remove. One of
--             them is inside the publish gate's 30-day window today, so that
--             one listing loses a freshness date it never earned; it is not
--             un-published, but a future re-publish will need a real check.
--   157 rows  recall_status = 'open_recalls'  ->  UNTOUCHED. Downgrading them
--             would remove live blocks, which this gate is forbidden to do.
--             They are model-derived and are left for the row-classification
--             dry run to decide, with their evidence intact.
--
-- ORDERING AGAINST THE ROW-CLASSIFICATION DRY RUN
--
-- This migration is safe before or after it. Both UPDATEs are guarded by
-- predicates that stop matching once the values are corrected, so running after
-- the dry run is a no-op; the constraints are added after the UPDATEs in the
-- same transaction, so no row can be left violating one. If the dry run later
-- writes a token outside either vocabulary the constraint rejects the write
-- loudly rather than accepting it silently, which is the intended behaviour.
--
-- BLOCKS: EVERY EXISTING ONE IS PRESERVED
--
-- The NHTSA writer stops setting open_recall_count, so the two blocks that
-- keyed on it are re-pointed at the same evidence in its new store:
--   * fire_recall_service_task now also raises a task from a model-scope
--     payload in state 'model_campaigns_found'. Same campaigns, same signature
--     rules, same 'open_review' status, so the same publish block.
--   * unpublish_on_do_not_drive_recall now also fires on recall_payload. It
--     reads the explicit do_not_drive key, which only new writes carry, so no
--     historic row is retroactively unpublished by this migration.
-- The do-not-drive phrase set is unchanged. No new block is introduced and no
-- existing block is relaxed.
--
-- RLS IMPACT: none. No policy is created, altered or dropped.
-- INDEX IMPACT: none. No index is created or dropped.
--
-- BACKFILL PLAN: the two UPDATEs above are the whole backfill; they run inline
-- and touch 128 rows. Model context for the rest is re-derived by the next
-- vehicle-enrich pass, which now records NO_MODEL_CAMPAIGNS_FOUND,
-- MODEL_NOT_FOUND or LOOKUP_FAILED instead of discarding the answer.
--
-- VERIFICATION QUERY
--
--   SELECT recall_status,
--          count(*) FILTER (WHERE open_recall_count IS NOT NULL) AS with_count,
--          count(*) FILTER (WHERE recall_payload->>'scope' = 'model') AS model_scoped,
--          count(*) FILTER (WHERE recall_check->>'scope' = 'vin') AS vin_scoped,
--          count(*)
--     FROM public.vehicle_listings GROUP BY 1;
--
-- ROLLBACK
--
--   ALTER TABLE public.vehicle_listings
--     DROP CONSTRAINT IF EXISTS vehicle_listings_recall_status_vocabulary,
--     DROP CONSTRAINT IF EXISTS vehicle_listings_recall_count_needs_vin_answer,
--     DROP CONSTRAINT IF EXISTS vehicle_listings_recall_verified_clear_provenance,
--     DROP CONSTRAINT IF EXISTS vehicle_listings_recall_check_is_vin_scope,
--     DROP CONSTRAINT IF EXISTS vehicle_listings_recall_payload_is_model_scope;
--   UPDATE public.vehicle_listings SET recall_status = 'clear'
--    WHERE recall_status = 'unknown'
--      AND recall_payload->>'rawProvider' = 'marketcheck_autorecalls';
--   -- then restore the previous bodies of fire_recall_service_task and
--   -- unpublish_on_do_not_drive_recall from 20260627060000 / 20260728114929.
--   -- The withdrawn zeros are not restorable and must not be: they asserted a
--   -- fact no check ever established.
-- ──────────────────────────────────────────────────────────────────────

-- ── 1. Withdraw counts that no VIN answer supports ────────────────────

UPDATE public.vehicle_listings
   SET open_recall_count = NULL,
       closed_recall_count = NULL,
       recall_checked_at = NULL
 WHERE recall_status IS NULL
   AND (open_recall_count IS NOT NULL OR closed_recall_count IS NOT NULL OR recall_checked_at IS NOT NULL);

-- The five 'clear' rows are MarketCheck 404s recorded as clearances. The row
-- keeps its evidence: the provider response stays in recall_payload and the
-- check envelope keeps its timestamp, demoted from 'checked_at' to
-- 'attempted_at' so a fabricated clearance can no longer satisfy the publish
-- gate's freshness requirement. Nothing is deleted and no history is rewritten.
UPDATE public.vehicle_listings
   SET recall_status = 'unknown',
       open_recall_count = NULL,
       closed_recall_count = NULL,
       recall_checked_at = NULL,
       recall_check = CASE
         WHEN recall_check IS NULL THEN NULL
         ELSE (recall_check - 'checked_at' - 'has_open') || jsonb_build_object(
           'scope', 'vin',
           'state', 'unknown',
           'source', COALESCE(recall_payload ->> 'rawProvider', 'marketcheck_autorecalls'),
           'attempted_at', COALESCE(recall_check ->> 'checked_at', now()::text),
           'note', 'marketcheck_absence_recorded_as_clear_withdrawn')
       END
 WHERE recall_status = 'clear';

-- ── 2. The two vocabularies, and the provenance rule ──────────────────

ALTER TABLE public.vehicle_listings
  DROP CONSTRAINT IF EXISTS vehicle_listings_recall_status_vocabulary;
ALTER TABLE public.vehicle_listings
  ADD CONSTRAINT vehicle_listings_recall_status_vocabulary
  CHECK (recall_status IS NULL OR recall_status IN ('verified_clear', 'open_recalls', 'unknown'));

-- A count without a VIN-level answer behind it is the defect this gate exists
-- to remove: zero is a factual result and an unanswered lookup is not.
ALTER TABLE public.vehicle_listings
  DROP CONSTRAINT IF EXISTS vehicle_listings_recall_count_needs_vin_answer;
ALTER TABLE public.vehicle_listings
  ADD CONSTRAINT vehicle_listings_recall_count_needs_vin_answer
  CHECK (
    (open_recall_count IS NULL AND closed_recall_count IS NULL AND recall_checked_at IS NULL)
    OR recall_status IN ('verified_clear', 'open_recalls')
  );

-- A clean claim must be able to name its source, its scope and its time.
ALTER TABLE public.vehicle_listings
  DROP CONSTRAINT IF EXISTS vehicle_listings_recall_verified_clear_provenance;
ALTER TABLE public.vehicle_listings
  ADD CONSTRAINT vehicle_listings_recall_verified_clear_provenance
  CHECK (
    recall_status IS DISTINCT FROM 'verified_clear'
    OR (
      recall_check ->> 'scope' = 'vin'
      AND COALESCE(recall_check ->> 'source', '') <> ''
      AND COALESCE(recall_check ->> 'checked_at', '') <> ''
    )
  );

-- Scope-tagged envelopes are checked; the untagged legacy rows are left alone
-- so an unrelated UPDATE to one of them cannot fail on a shape it predates.
ALTER TABLE public.vehicle_listings
  DROP CONSTRAINT IF EXISTS vehicle_listings_recall_check_is_vin_scope;
ALTER TABLE public.vehicle_listings
  ADD CONSTRAINT vehicle_listings_recall_check_is_vin_scope
  CHECK (
    recall_check IS NULL
    OR NOT (recall_check ? 'scope')
    OR (
      recall_check ->> 'scope' = 'vin'
      AND COALESCE(recall_check ->> 'source', '') <> ''
      AND (
        -- An answered check carries the date it answered.
        (recall_check ->> 'state' IN ('verified_clear', 'open_recalls')
         AND COALESCE(recall_check ->> 'checked_at', '') <> '')
        -- An unanswered one carries the attempt and must NOT carry a check
        -- date: the publish gate and the stale worklist key on checked_at, so
        -- a lookup that answered nothing may never satisfy them.
        OR (recall_check ->> 'state' = 'unknown'
            AND COALESCE(recall_check ->> 'attempted_at', '') <> ''
            AND NOT (recall_check ? 'checked_at'))
      )
    )
  );

ALTER TABLE public.vehicle_listings
  DROP CONSTRAINT IF EXISTS vehicle_listings_recall_payload_is_model_scope;
ALTER TABLE public.vehicle_listings
  ADD CONSTRAINT vehicle_listings_recall_payload_is_model_scope
  CHECK (
    recall_payload IS NULL
    OR NOT (recall_payload ? 'scope')
    OR (
      recall_payload ->> 'scope' = 'model'
      AND recall_payload ->> 'state' IN
        ('model_campaigns_found', 'no_model_campaigns_found', 'model_not_found', 'lookup_failed')
      AND COALESCE(recall_payload ->> 'source', '') <> ''
      AND COALESCE(recall_payload ->> 'checked_at', '') <> ''
    )
  );

COMMENT ON COLUMN public.vehicle_listings.recall_status IS
  'VIN scope. verified_clear | open_recalls | unknown | NULL (unknown). Only a VIN-level provider may set verified_clear or open_recalls. STALE is derived by readers from recall_check.checked_at.';
COMMENT ON COLUMN public.vehicle_listings.open_recall_count IS
  'VIN scope. NULL unless recall_status is a VIN-level answer; a zero here always has recall_check for its source, scope and time.';
COMMENT ON COLUMN public.vehicle_listings.recall_check IS
  'VIN scope envelope: {scope:vin, state, source, checked_at, vin, open_count, closed_count, has_open, do_not_drive, campaigns}.';
COMMENT ON COLUMN public.vehicle_listings.recall_payload IS
  'MODEL scope envelope: {scope:model, state, source, checked_at, queried, matched_model, match_rule, campaign_count, campaigns}. Campaign context for a year/make/model. Never VIN clearance.';

-- ── 3. Keep every block firing on the same evidence ───────────────────

-- The campaign signature decides whether a resolved service task may stay
-- resolved. The two-scope campaign shape names the campaign 'campaign', so
-- without this key the signature would be NULL for every new write and a
-- resolved task would be raised again on the next enrich pass.
CREATE OR REPLACE FUNCTION public.recall_payload_signature(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_agg(c, ',' ORDER BY c)
  FROM (
    SELECT DISTINCT COALESCE(
             elem->>'nhtsaCampaignNumber', elem->>'NHTSACampaignNumber',
             elem->>'campaignId', elem->>'campaign_id', elem->>'campaign_number',
             elem->>'campaign'
           ) AS c
    FROM jsonb_array_elements(
           COALESCE(p->'campaigns', p->'recalls', '[]'::jsonb)
         ) elem
  ) s
  WHERE c IS NOT NULL AND c <> '';
$$;

-- Open campaigns a MODEL-scope payload reports. Only a scope-tagged payload in
-- state 'model_campaigns_found' counts, so this reads new writes only and can
-- never re-interpret a legacy payload.
CREATE OR REPLACE FUNCTION public.recall_model_open_count(p jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p ->> 'scope' <> 'model' THEN 0
    WHEN p ->> 'state' <> 'model_campaigns_found' THEN 0
    WHEN jsonb_typeof(p -> 'campaigns') = 'array' THEN jsonb_array_length(p -> 'campaigns')
    ELSE COALESCE((p ->> 'campaign_count')::integer, 0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.fire_recall_service_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sig text;
  v_open integer;
  v_payload jsonb;
BEGIN
  -- The VIN count when a VIN-level source answered, otherwise the model-scope
  -- campaign count. Model campaigns raised this task before the two scopes were
  -- separated and they must keep raising it: withholding a car on model
  -- evidence is conservative, and only clearing one on model evidence is
  -- forbidden.
  v_open := COALESCE(NEW.open_recall_count, 0);
  v_payload := NEW.recall_payload;
  IF v_open <= 0 THEN
    v_open := public.recall_model_open_count(NEW.recall_payload);
  END IF;

  IF v_open <= 0 THEN
    RETURN NEW;   -- no open recall → nothing to raise
  END IF;

  v_sig := public.recall_payload_signature(COALESCE(v_payload, NEW.recall_check));

  -- Refresh the snapshot on an already-open task for this vehicle.
  IF EXISTS (SELECT 1 FROM public.recall_service_tasks t
             WHERE t.vehicle_listing_id = NEW.id AND t.status = 'open_review') THEN
    UPDATE public.recall_service_tasks
       SET open_recall_count = v_open,
           recall_payload    = COALESCE(v_payload, NEW.recall_check),
           recall_signature  = v_sig,
           ymm               = COALESCE(NEW.ymm, ymm),
           updated_at        = now()
     WHERE vehicle_listing_id = NEW.id AND status = 'open_review';
    RETURN NEW;
  END IF;

  -- Don't recreate a task the service department already resolved for this same
  -- recall set (same signature). A NEW campaign signature DOES raise a new task.
  IF v_sig IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.recall_service_tasks t
       WHERE t.vehicle_listing_id = NEW.id
         AND t.status = 'resolved'
         AND t.recall_signature IS NOT DISTINCT FROM v_sig
     ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.recall_service_tasks
    (tenant_id, vehicle_listing_id, vin, ymm, open_recall_count, recall_payload, recall_signature, status)
  VALUES
    (NEW.tenant_id, NEW.id, NEW.vin, NEW.ymm, v_open,
     COALESCE(v_payload, NEW.recall_check), v_sig, 'open_review')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_recall_service_task ON public.vehicle_listings;
CREATE TRIGGER trg_fire_recall_service_task
  AFTER INSERT OR UPDATE OF open_recall_count, recall_payload, recall_status, recall_check
  ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.fire_recall_service_task();

CREATE OR REPLACE FUNCTION public.unpublish_on_do_not_drive_recall()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Either store may carry the do-not-drive flag. A model-level campaign that
  -- says do-not-drive pulled a listing back to draft before the scopes were
  -- separated and it still does; only clearance is scope-restricted.
  IF NEW.status IS DISTINCT FROM 'published'
     OR NEW.recall_override_by IS NOT NULL
     OR NOT (public.recall_is_do_not_drive(NEW.recall_check)
             OR public.recall_is_do_not_drive(NEW.recall_payload)) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'draft';
  NEW.published_at := NULL;

  BEGIN
    INSERT INTO public.vehicle_exceptions AS ve
      (tenant_id, vehicle_listing_id, vin, exception_type, severity, title, explanation,
       source_values, recommended_action, status)
    VALUES
      (NEW.tenant_id, NEW.id, NEW.vin, 'recall_do_not_drive_unpublished', 'critical',
       'Vehicle un-published: do-not-drive recall',
       'A do-not-drive recall was recorded on this VIN while its customer passport was live. '
         || 'The listing was pulled back to draft automatically and is no longer reachable at its public /v/ URL. '
         || 'It cannot be re-published until the recall is resolved or an admin records an override.',
       jsonb_build_object(
         'recall_check', NEW.recall_check,
         'recall_payload', NEW.recall_payload,
         'open_recall_count', NEW.open_recall_count,
         'unpublished_at', now(),
         'source', 'recall_unpublish_guard'),
       'Confirm the campaign with the manufacturer, record the recall service outcome, then re-publish.',
       'open')
    ON CONFLICT (tenant_id, vin, exception_type) WHERE status IN ('open', 'in_progress')
    DO UPDATE SET
      severity      = 'critical',
      source_values = coalesce(ve.source_values, '{}'::jsonb) || EXCLUDED.source_values,
      updated_at    = now();
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
    VALUES (
      'recall_do_not_drive_unpublished', 'vehicle_listing', NEW.vin, NEW.tenant_id::text,
      (SELECT auth.uid()),
      jsonb_build_object(
        'listing_id', NEW.id,
        'open_recall_count', NEW.open_recall_count,
        'recall_status', NEW.recall_status));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recall_unpublish_guard ON public.vehicle_listings;
CREATE TRIGGER trg_recall_unpublish_guard
  BEFORE UPDATE OF recall_check, recall_payload ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.unpublish_on_do_not_drive_recall();

-- ── Self-check: RAISE if the change did not take ──────────────────────

DO $$
DECLARE
  v_missing text;
  v_bad integer;
BEGIN
  FOREACH v_missing IN ARRAY ARRAY[
    'vehicle_listings_recall_status_vocabulary',
    'vehicle_listings_recall_count_needs_vin_answer',
    'vehicle_listings_recall_verified_clear_provenance',
    'vehicle_listings_recall_check_is_vin_scope',
    'vehicle_listings_recall_payload_is_model_scope'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.vehicle_listings'::regclass
         AND contype = 'c' AND conname = v_missing AND convalidated
    ) THEN
      RAISE EXCEPTION 'recall constraint % is missing or unvalidated', v_missing;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_bad FROM public.vehicle_listings
   WHERE recall_status IS NULL
     AND (open_recall_count IS NOT NULL OR closed_recall_count IS NOT NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'still % rows carrying a recall count with no VIN-level state', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.vehicle_listings WHERE recall_status = 'clear';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'still % rows carrying the retired recall_status ''clear''', v_bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.vehicle_listings'::regclass
       AND tgname = 'trg_fire_recall_service_task' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_fire_recall_service_task is missing; the recall service block would not fire';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.vehicle_listings'::regclass
       AND tgname = 'trg_recall_unpublish_guard' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_recall_unpublish_guard is missing; the do-not-drive block would not fire';
  END IF;

  -- The rule the whole gate exists for: a model-scope payload must never be
  -- able to present itself as a VIN clearance.
  IF EXISTS (
    SELECT 1 FROM public.vehicle_listings
     WHERE recall_payload ->> 'scope' = 'model'
       AND recall_payload ->> 'state' IN ('verified_clear', 'open_recalls', 'unknown')
  ) THEN
    RAISE EXCEPTION 'a model-scope recall payload is carrying a VIN vocabulary token';
  END IF;
END $$;
