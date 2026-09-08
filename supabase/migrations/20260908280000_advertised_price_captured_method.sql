-- Separate "the dealer's inventory feed says this price" from "we observed this
-- price published on the dealer's website".
--
-- `advertised_prices` is the evidence table behind the compliance packet. Every
-- row in it has been read as a website observation, because `source_channel`
-- was set to 'website' by everything that writes it -- including the
-- MarketCheck sync, which has never seen a website. The sync's own comment
-- conceded the problem: "the provenance lives in notes". Provenance in prose is
-- provenance nobody can query, and `auditPacket.ts` selects * unfiltered.
--
-- That became live on 2026-09-08 when the feed wrote 58 rows with
-- source_channel='website', captured_by null and no screenshot, into a table
-- whose last real crawl capture was 2026-08-24. Fifteen days later they are
-- indistinguishable from 1,532 screenshot-backed observations, and every packet
-- generated since reports a feed echo as an observed advertisement.
--
-- Two changes: a real column for the method, and a truthful `source_channel` on
-- the feed writer (in the function, not here).

ALTER TABLE public.advertised_prices
  ADD COLUMN IF NOT EXISTS captured_method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'advertised_prices_captured_method_check'
  ) THEN
    ALTER TABLE public.advertised_prices
      ADD CONSTRAINT advertised_prices_captured_method_check
      CHECK (captured_method IS NULL OR captured_method IN (
        'marketcheck_syndication',   -- the dealer's inventory feed. Not an observation.
        'dealer_vdp_observation',    -- we fetched the dealer's page and read it.
        'manual_dealer_confirmation',-- a person at the dealership stated it.
        'crawl_seed'                 -- a placeholder row so the crawler has a target.
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_advertised_prices_method
  ON public.advertised_prices (tenant_id, captured_method, captured_at DESC);

COMMENT ON COLUMN public.advertised_prices.captured_method IS
  'How this price was obtained. NULL means the row predates this column and its '
  'provenance could not be established from the evidence on the row -- treat as '
  'LEGACY/UNKNOWN, never as an observation.';

-- ── Backfill, only where the evidence on the row settles it ──────────
--
-- Nothing is inferred from absence. A row with no screenshot, no recognisable
-- note and no capturing user stays NULL, because "we do not know" is the true
-- answer and inventing one here would repeat the mistake this migration undoes.
DO $$
DECLARE v_feed int; v_obs int; v_manual int; v_seed int; v_unknown int;
BEGIN
  -- The feed writer stamps its own name into notes. Unambiguous.
  UPDATE public.advertised_prices
     SET captured_method = 'marketcheck_syndication'
   WHERE captured_method IS NULL AND notes LIKE 'MarketCheck%';
  GET DIAGNOSTICS v_feed = ROW_COUNT;

  -- A screenshot hash can only have come from a render of the dealer's page.
  UPDATE public.advertised_prices
     SET captured_method = 'dealer_vdp_observation'
   WHERE captured_method IS NULL AND screenshot_sha256 IS NOT NULL;
  GET DIAGNOSTICS v_obs = ROW_COUNT;

  -- Seed rows carry price 0 as "no baseline captured yet" -- explicitly not a
  -- price anyone advertised, and they must never reach a compliance packet.
  UPDATE public.advertised_prices
     SET captured_method = 'crawl_seed'
   WHERE captured_method IS NULL
     AND (advertised_price IS NULL OR advertised_price = 0);
  GET DIAGNOSTICS v_seed = ROW_COUNT;

  -- The crawler names itself too, and by here has no screenshot to rely on.
  UPDATE public.advertised_prices
     SET captured_method = 'dealer_vdp_observation'
   WHERE captured_method IS NULL AND notes ILIKE '%crawl%';
  GET DIAGNOSTICS v_obs = v_obs + ROW_COUNT;

  -- A capturing user is a person at the dealership.
  UPDATE public.advertised_prices
     SET captured_method = 'manual_dealer_confirmation'
   WHERE captured_method IS NULL AND captured_by IS NOT NULL;
  GET DIAGNOSTICS v_manual = ROW_COUNT;

  SELECT count(*) INTO v_unknown
    FROM public.advertised_prices WHERE captured_method IS NULL;

  RAISE NOTICE 'captured_method backfill: feed=%, observed=%, manual=%, seed=%, left UNKNOWN=%',
    v_feed, v_obs, v_manual, v_seed, v_unknown;
END $$;

-- Feed rows are not website observations, and must stop claiming to be. The
-- writer is corrected in marketcheck-sync; this repairs the rows it already
-- wrote. Only rows the backfill positively identified as feed rows are moved.
UPDATE public.advertised_prices
   SET source_channel = 'feed'
 WHERE captured_method = 'marketcheck_syndication'
   AND source_channel = 'website';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.advertised_prices
     WHERE captured_method = 'marketcheck_syndication' AND source_channel = 'website'
  ) THEN
    RAISE EXCEPTION 'a MarketCheck feed row is still labelled as a website observation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.advertised_prices
     WHERE captured_method = 'dealer_vdp_observation' AND source_channel = 'feed'
  ) THEN
    RAISE EXCEPTION 'an observed row is labelled as a feed row';
  END IF;
END $$;
