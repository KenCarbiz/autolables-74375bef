-- Relabel crawl outcomes that were recorded under a name that was not true.
--
-- `classifyCrawlOutcome` tested the response BODY for "upgrade your plan"
-- before it tested the HTTP status. Firecrawl puts that phrase in its
-- rate-limit body as well as its credit body, so the 429 branch was
-- unreachable and every rate limit was written to this ledger as
-- "render_credits_exhausted". The operator surface therefore reported an
-- exhausted account for eighteen days, and the indicated fix -- buy credits --
-- would have cost money and changed nothing.
--
-- Two remedies, in the code and here. The code now ranks structured status
-- above prose (see supabase/functions/_shared/crawlOutcome.ts). This migration
-- repairs the rows that name is already on.
--
-- Only rows whose provenance is unambiguous are rewritten. `render_status`
-- came straight off the provider's response and was never part of the
-- misclassification, so it is the evidence:
--
--   render_status 429  ->  render_rate_limited   (a rate limit, always)
--   render_status 402  ->  render_cost_refused   (a cost refusal, always)
--
-- Rows carrying the old name with NO render_status are left exactly as they
-- are. We cannot tell what they were, and inventing a provenance to tidy up a
-- ledger would be the same class of error this migration exists to undo.
--
-- "render_cost_refused" replaces "render_credits_exhausted" deliberately. A
-- 402 means the provider refused this request at this cost; its own body
-- suggests "changing the request limit to a lower value". An empty balance
-- produces it and so does a request too expensive for the plan while the
-- balance is healthy. Naming it after one of two causes is what sent the
-- diagnosis wrong twice.

DO $$
DECLARE
  v_rate int;
  v_cost int;
  v_legacy int;
BEGIN
  IF to_regclass('public.advertised_price_crawl_attempts') IS NULL THEN
    RAISE NOTICE 'advertised_price_crawl_attempts absent; nothing to relabel';
    RETURN;
  END IF;

  UPDATE public.advertised_price_crawl_attempts
     SET outcome = 'render_rate_limited'
   WHERE outcome = 'render_credits_exhausted'
     AND render_status = 429;
  GET DIAGNOSTICS v_rate = ROW_COUNT;

  UPDATE public.advertised_price_crawl_attempts
     SET outcome = 'render_cost_refused'
   WHERE outcome = 'render_credits_exhausted'
     AND render_status = 402;
  GET DIAGNOSTICS v_cost = ROW_COUNT;

  SELECT count(*) INTO v_legacy
    FROM public.advertised_price_crawl_attempts
   WHERE outcome = 'render_credits_exhausted';

  RAISE NOTICE 'relabelled % rate-limit rows, % cost-refusal rows; % legacy rows left unchanged (no render_status to judge by)',
    v_rate, v_cost, v_legacy;

  -- Self-verification: no row may claim a rate limit is a cost problem.
  IF EXISTS (
    SELECT 1 FROM public.advertised_price_crawl_attempts
     WHERE render_status = 429 AND outcome <> 'render_rate_limited'
  ) THEN
    RAISE EXCEPTION 'a 429 row is still labelled as something other than a rate limit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.advertised_price_crawl_attempts
     WHERE render_status = 402 AND outcome NOT IN ('render_cost_refused')
  ) THEN
    RAISE EXCEPTION 'a 402 row is still labelled as something other than a cost refusal';
  END IF;
END $$;
