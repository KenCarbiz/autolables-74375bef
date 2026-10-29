-- PROPOSED, NOT APPLIED. Columns the advertised-price crawler needs to store an
-- observation before it may change a listing (supabase/functions/_shared/
-- crawlCommit.ts, feeBasis.ts). Additive only: no existing row, column,
-- policy or function changes.
--
--   observation               the fee basis record (raw figure and label, the
--                             dealership's configured interpretation, the
--                             page's own fee evidence, derived values and the
--                             basis used), page identity and evidence status
--   idempotency_key           sha256 over what was observed; the same page
--                             state is stored once per dealership
--   listing_promotion         what happened to the listing: pending, promoted,
--                             not_required, promotion_failed,
--                             promotion_conflict, held_fee_basis,
--                             held_evidence
--   listing_promotion_detail  the reason, when held or failed
--
-- Until this is applied the crawler stores observations the old way and never
-- updates listing pricing (outcome held_schema).

ALTER TABLE public.advertised_prices
  ADD COLUMN IF NOT EXISTS observation jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS listing_promotion text,
  ADD COLUMN IF NOT EXISTS listing_promotion_detail text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advertised_prices_listing_promotion_check') THEN
    ALTER TABLE public.advertised_prices ADD CONSTRAINT advertised_prices_listing_promotion_check
      CHECK (listing_promotion IS NULL OR listing_promotion IN (
        'pending', 'promoted', 'not_required', 'promotion_failed', 'promotion_conflict',
        'held_fee_basis', 'held_evidence'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_advertised_prices_tenant_idempotency
  ON public.advertised_prices (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.advertised_prices.observation IS
  'Crawler observation record: observed figure and label, dealer fee interpretation, page fee evidence, derived values, page identity and evidence status. Written by crawl-advertised-prices.';
COMMENT ON COLUMN public.advertised_prices.listing_promotion IS
  'Whether this observation changed the listing: promoted only when the fee basis is page-verified and evidence was accepted.';
