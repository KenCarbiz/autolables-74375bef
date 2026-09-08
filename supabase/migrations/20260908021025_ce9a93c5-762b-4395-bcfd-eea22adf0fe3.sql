-- ─────────────────────────────────────────────────────────────────────
-- Every car of a model the dealer holds a copy for, not just the first one.
--
-- THE BUG THIS CLOSES. A stored copy is keyed per MODEL — (tenant, brand,
-- model, model-year, kind) — because one PDF serves every QX60 on the lot.
-- Entitlement, though, is keyed per VEHICLE: public-listing-view asks
-- oem_distribution_for_vehicle(tenant, VIN, kind), which answers 'host' only
-- if THAT vin has a host decision on record. That is the right shape — the
-- record says what one customer was given, and it has to survive the dealer
-- later dropping the franchise — but nothing was minting the other vins'
-- decisions.
--
-- And nothing would: the copy step dedupes per model inside an ingest run, so
-- exactly one vin of each model ever reached the gate. The dealer's own
-- INFINITI manual was sitting in the bucket while three of their four QX60s
-- served the manufacturer link, and every check in the system reported
-- success.
--
-- This mints the missing decisions, and it mints them properly: through
-- record_oem_distribution, which asks the gate itself and snapshots the
-- evidence per vehicle. It is not a backdated claim — each row is decided now,
-- on today's franchise, for a copy that is already lawfully held.
--
-- Two guards, both load-bearing:
--   * only for a document we ACTUALLY hold. No hosted row, no event.
--   * only while the gate still says yes. A dealer who dropped the franchise
--     stops getting NEW host decisions; the ones already given stand, which is
--     the persistence rule the evidence table is built on.
-- ─────────────────────────────────────────────────────────────────────

-- The (make, model, year) a listing's OEM documents are filed under.
--
-- Deliberately NOT oem_make_from_ymm, which rejoins multi-word makes: this
-- has to reproduce oemDocKeyFromYmm in _shared/oemDocKey.ts verbatim — second
-- word is the make, everything after it is the model — because that is the
-- key the copies were STORED under. Being cleverer here would fail to match
-- the row it is looking for. The two derivations answer different questions
-- and are both correct for theirs.
CREATE OR REPLACE FUNCTION public.oem_doc_key_from_ymm(_ymm TEXT)
RETURNS TABLE (make TEXT, model TEXT, year INTEGER)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_parts TEXT[];
  v_len INTEGER;
BEGIN
  v_parts := regexp_split_to_array(
    btrim(regexp_replace(coalesce(_ymm, ''), '\s+', ' ', 'g')), ' ');
  v_len := COALESCE(array_length(v_parts, 1), 0);
  IF v_len < 3 THEN RETURN; END IF;
  IF v_parts[1] !~ '^(19|20)\d{2}$' THEN RETURN; END IF;
  make := v_parts[2];
  model := array_to_string(v_parts[3:v_len], ' ');
  year := v_parts[1]::INTEGER;
  IF btrim(make) = '' OR btrim(model) = '' THEN RETURN; END IF;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.oem_doc_key_from_ymm(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.backfill_oem_distribution_entitlements(
  _tenant_id UUID,
  _limit INTEGER DEFAULT 200
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT vl.vin, vl.id AS listing_id, h.brand, h.document_kind, h.storage_path, h.source_url
      FROM public.vehicle_listings vl
      JOIN LATERAL public.oem_doc_key_from_ymm(vl.ymm) k ON TRUE
      JOIN public.oem_hosted_documents h
        ON h.tenant_id = vl.tenant_id
       AND lower(h.brand) = lower(k.make)
       AND lower(h.model) = lower(k.model)
       AND COALESCE(h.model_year, 0) = COALESCE(k.year, 0)
     WHERE vl.tenant_id = _tenant_id
       AND vl.status = 'published'
       AND vl.vin IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.oem_distribution_events e
              WHERE e.tenant_id = _tenant_id
                AND upper(e.vin) = upper(vl.vin)
                AND e.document_kind = h.document_kind
                AND e.decision = 'host')
     ORDER BY vl.updated_at DESC
     LIMIT GREATEST(COALESCE(_limit, 200), 0)
  LOOP
    -- The gate decides each one, exactly as it does at ingest. This function
    -- never writes a decision of its own.
    IF public.tenant_may_host_oem_documents(_tenant_id, v_row.brand, NULL) THEN
      PERFORM public.record_oem_distribution(
        _tenant_id, v_row.vin, v_row.brand, v_row.document_kind,
        v_row.source_url, NULL, v_row.listing_id, v_row.storage_path);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;

COMMENT ON FUNCTION public.backfill_oem_distribution_entitlements(UUID, INTEGER) IS
  'Mints the missing per-vehicle host decisions for models this dealer already holds a copy of, so every car of the model serves the stored document rather than only the first one ingested.';

REVOKE ALL ON FUNCTION public.backfill_oem_distribution_entitlements(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_oem_distribution_entitlements(UUID, INTEGER) TO service_role;