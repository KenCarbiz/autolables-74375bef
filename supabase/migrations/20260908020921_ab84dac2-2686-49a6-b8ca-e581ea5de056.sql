-- ─────────────────────────────────────────────────────────────────────
-- What happened the last time we tried to keep this dealer's own copy of a
-- manufacturer document, and whether it is worth trying again.
--
-- WHY THIS EXISTS. oem-document-store already decides correctly: it claims
-- (which asks the franchise gate and writes the evidence row), then fetches,
-- then stores. What it did not do is REMEMBER. A copy that could not be taken
-- -- because the model's manufacturer link had not been harvested yet, because
-- the manufacturer's CDN timed out, because a bot wall served HTML with a 200
-- -- returned a status code to a detached ingest call that logged nothing and
-- opened no exception. The dealer saw a link on the packet, which is the right
-- fallback, and nobody could answer "why is there no copy of this one".
--
-- So every terminal outcome is written here, success and failure alike:
--
--   stored / already_stored  the document is in hand; never asked again
--   not_franchised           the gate said link. Correct, and the common case
--                            for used inventory. Re-asked monthly, because a
--                            store can win a franchise
--   link_missing             no manufacturer link harvested for this model
--                            yet, so there is nothing to copy. Ordinary on the
--                            first car of a model; re-asked in days
--   source_unreachable       fetch failed or timed out; re-asked in days
--   not_a_pdf                the manufacturer served a page, not a document
--                            (usually a bot wall); re-asked in a fortnight
--   too_large                over the storage ceiling. Never re-asked on its
--                            own: a 60 MB manual does not shrink
--   store_failed             ours, not theirs; re-asked the next night
--
-- The retry policy lives in supabase/functions/_shared/oemDocCopy.ts and is
-- unit tested there. This table only holds the verdict and the count.
--
-- TENANT-SCOPED, unlike oem_packet_backfill_attempts. That table caches a
-- question about a MODEL ("does Nissan publish a 2021 Rogue brochure"), which
-- is the same answer for every dealer. This one records a question about a
-- DEALER ("may this store keep a copy, and did it work"), and the answer for
-- an INFINITI store and a Honda store looking at the same INFINITI is
-- deliberately different.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.oem_document_copy_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Normalized lookup key, stored as plain columns rather than an expression
  -- index so the RPC can target the unique constraint by name.
  brand_key       TEXT NOT NULL,
  model_key       TEXT NOT NULL,
  -- 0 stands for "no model year", so the key is never NULL and the unique
  -- constraint actually constrains.
  year_key        INTEGER NOT NULL DEFAULT 0,
  document_kind   TEXT NOT NULL CHECK (document_kind IN ('owners_manual', 'brochure')),
  brand           TEXT NOT NULL,
  model           TEXT NOT NULL,
  model_year      INTEGER,
  outcome         TEXT NOT NULL CHECK (outcome IN (
                    'stored', 'already_stored', 'not_franchised', 'link_missing',
                    'source_unreachable', 'not_a_pdf', 'too_large', 'store_failed')),
  detail          TEXT,
  -- The manufacturer URL the attempt was made against, when there was one.
  -- Never invented: a row with no source_url is a row where no document was
  -- found, and that is the honest answer rather than a guessed link.
  source_url      TEXT,
  attempts        INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set once the document is in hand, cleared never. Makes "what is still
  -- outstanding" an index scan rather than a policy re-implementation in SQL.
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_oem_document_copy_attempts
    UNIQUE (tenant_id, brand_key, model_key, year_key, document_kind)
);

COMMENT ON TABLE public.oem_document_copy_attempts IS
  'Per-dealer record of every attempt to keep a copy of a manufacturer document, including the ones that found nothing. A document that could not be stored leaves a row here rather than vanishing.';

CREATE INDEX IF NOT EXISTS idx_oem_document_copy_attempts_open
  ON public.oem_document_copy_attempts (tenant_id, last_attempt_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.oem_document_copy_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oem copy attempts readable by tenant" ON public.oem_document_copy_attempts;
CREATE POLICY "oem copy attempts readable by tenant"
  ON public.oem_document_copy_attempts FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- No INSERT/UPDATE/DELETE policy: oem-document-store is the only writer, and
-- it writes through the SECURITY DEFINER function below.
GRANT SELECT ON public.oem_document_copy_attempts TO authenticated;
GRANT ALL ON public.oem_document_copy_attempts TO service_role;

/**
 * Record one copy attempt, incrementing the count in place.
 *
 * A plain upsert would reset `attempts` to 1 on every write, so the "stop
 * after five tries, ever" ceiling would never be reached and an unreachable
 * manufacturer CDN would be re-downloaded forever at the cooldown interval.
 * The increment has to happen inside the conflict clause.
 */
CREATE OR REPLACE FUNCTION public.record_oem_document_copy_attempt(
  _tenant_id     UUID,
  _brand         TEXT,
  _model         TEXT,
  _model_year    INTEGER,
  _document_kind TEXT,
  _outcome       TEXT,
  _detail        TEXT DEFAULT NULL,
  _source_url    TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempts INTEGER;
  v_resolved TIMESTAMPTZ := CASE WHEN _outcome IN ('stored', 'already_stored') THEN now() END;
BEGIN
  INSERT INTO public.oem_document_copy_attempts
    (tenant_id, brand_key, model_key, year_key, document_kind,
     brand, model, model_year, outcome, detail, source_url, resolved_at)
  VALUES (
    _tenant_id,
    lower(btrim(coalesce(_brand, ''))), lower(btrim(coalesce(_model, ''))), COALESCE(_model_year, 0),
    _document_kind,
    btrim(coalesce(_brand, '')), btrim(coalesce(_model, '')), _model_year,
    _outcome, left(_detail, 500), _source_url, v_resolved
  )
  ON CONFLICT ON CONSTRAINT uq_oem_document_copy_attempts DO UPDATE
    SET outcome         = EXCLUDED.outcome,
        detail          = EXCLUDED.detail,
        source_url      = COALESCE(EXCLUDED.source_url, public.oem_document_copy_attempts.source_url),
        attempts        = public.oem_document_copy_attempts.attempts + 1,
        last_attempt_at = now(),
        -- A document once held stays held: a later transient failure must not
        -- clear the resolution and re-open a copy that is sitting in the
        -- bucket.
        resolved_at     = COALESCE(public.oem_document_copy_attempts.resolved_at, EXCLUDED.resolved_at)
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts;
END $$;

REVOKE ALL ON FUNCTION public.record_oem_document_copy_attempt(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_oem_document_copy_attempt(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- What a franchised dealer is still missing, and why.
--
-- security_invoker so the reader's own RLS applies: a dealer sees their own
-- backlog, an admin sees every dealer's. Without it this view would be a hole
-- straight through the policy above.
CREATE OR REPLACE VIEW public.oem_document_copy_backlog
WITH (security_invoker = on) AS
  SELECT a.tenant_id,
         a.brand,
         a.model,
         a.model_year,
         a.document_kind,
         a.outcome,
         a.detail,
         a.attempts,
         a.last_attempt_at,
         -- Mirrors OEM_COPY_RETRY_DAYS in _shared/oemDocCopy.ts. NULL means
         -- the sweep will not re-open this one on its own.
         CASE a.outcome
           WHEN 'link_missing'       THEN a.last_attempt_at + INTERVAL '2 days'
           WHEN 'source_unreachable' THEN a.last_attempt_at + INTERVAL '2 days'
           WHEN 'store_failed'       THEN a.last_attempt_at + INTERVAL '1 day'
           WHEN 'not_a_pdf'          THEN a.last_attempt_at + INTERVAL '14 days'
           WHEN 'not_franchised'     THEN a.last_attempt_at + INTERVAL '30 days'
         END AS retry_after
    FROM public.oem_document_copy_attempts a
   WHERE a.resolved_at IS NULL;

COMMENT ON VIEW public.oem_document_copy_backlog IS
  'Manufacturer documents a dealer has no stored copy of, with the reason and when the sweep will try again. Empty is the healthy state.';

GRANT SELECT ON public.oem_document_copy_backlog TO authenticated, service_role;

-- ── The franchise a dealer SAYS it holds, recorded alongside the one we
--    derived. Additive only: this changes no decision. ─────────────────
--
-- dealer_profiles.settings->>'dealer_oem_brands' is the store's own statement
-- of its franchises (populated from the Autocurb profile, or by an admin on
-- the platform tenants screen). The gate does not read it, and this migration
-- does not make it read it: a franchise is not a checkbox a dealer can tick,
-- and the derivation from new-vehicle inventory is deliberately the only
-- evidence that unlocks hosting.
--
-- But the MISMATCH is worth seeing. An INFINITI store that has not yet put
-- three new INFINITIs through AutoLabels links its own brand's manuals, which
-- is correct under the rule and still surprising to the dealer. Recording the
-- declaration next to the derivation in the evidence snapshot turns that from
-- an unexplained absence into a queryable one.
CREATE OR REPLACE FUNCTION public.declared_oem_brands(_tenant_id UUID)
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT array_agg(DISTINCT lower(btrim(b)) ORDER BY lower(btrim(b)))
       FROM public.dealer_profiles dp,
            LATERAL unnest(string_to_array(COALESCE(dp.settings->>'dealer_oem_brands', ''), ',')) AS b
      WHERE dp.tenant_id = _tenant_id
        AND btrim(b) <> ''),
    ARRAY[]::TEXT[]);
$$;

GRANT EXECUTE ON FUNCTION public.declared_oem_brands(UUID) TO authenticated, service_role;

-- Re-stated whole, because the evidence object gains two keys. The decision
-- itself is byte-for-byte the previous logic: the gate is still asked, the
-- caller still cannot supply a verdict, and declared_brands is recorded
-- WITHOUT being consulted.
CREATE OR REPLACE FUNCTION public.record_oem_distribution(
  _tenant_id UUID,
  _vin TEXT,
  _brand TEXT,
  _document_kind TEXT,
  _source_url TEXT DEFAULT NULL,
  _store_id TEXT DEFAULT NULL,
  _vehicle_listing_id UUID DEFAULT NULL,
  _stored_path TEXT DEFAULT NULL
)
RETURNS TABLE (decision TEXT, event_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand TEXT := lower(btrim(coalesce(_brand, '')));
  v_vin TEXT := upper(btrim(coalesce(_vin, '')));
  v_may BOOLEAN;
  v_decision TEXT;
  v_declared TEXT[];
  v_evidence JSONB;
  v_id UUID;
BEGIN
  IF v_brand = '' OR v_vin = '' THEN
    RAISE EXCEPTION 'vin and brand are required';
  END IF;
  IF _document_kind NOT IN ('owners_manual', 'brochure') THEN
    RAISE EXCEPTION 'unknown document kind %', _document_kind;
  END IF;

  v_may := public.tenant_may_host_oem_documents(_tenant_id, v_brand, _store_id);
  v_decision := CASE WHEN v_may THEN 'host' ELSE 'link' END;
  v_declared := public.declared_oem_brands(_tenant_id);

  SELECT jsonb_build_object(
    'franchise_brands', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('brand', f.brand, 'new_units', f.new_units)
                        ORDER BY f.brand)
         FROM public.derive_oem_franchise_brands(_tenant_id) f), '[]'::jsonb),
    'min_new_units_required', public.oem_franchise_min_new_units(),
    'brand_blocked', EXISTS (
      SELECT 1 FROM public.oem_distribution_blocks b
       WHERE lower(b.brand) = v_brand
         AND (b.tenant_id IS NULL OR b.tenant_id = _tenant_id)),
    -- Recorded, not consulted. See the comment above this function.
    'declared_brands', to_jsonb(v_declared),
    'declared_not_derived', (
      v_brand = ANY(v_declared)
      AND NOT EXISTS (
        SELECT 1 FROM public.derive_oem_franchise_brands(_tenant_id) f
         WHERE f.brand = v_brand)),
    'derived_at', now()
  ) INTO v_evidence;

  INSERT INTO public.oem_distribution_events
    (tenant_id, store_id, vin, vehicle_listing_id, brand, document_kind,
     decision, source_url, stored_path, evidence, decided_by)
  VALUES
    (_tenant_id, _store_id, v_vin, _vehicle_listing_id, v_brand, _document_kind,
     v_decision, _source_url, CASE WHEN v_may THEN _stored_path ELSE NULL END,
     v_evidence, (SELECT auth.uid()))
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_decision, v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.record_oem_distribution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;