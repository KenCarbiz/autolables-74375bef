-- The signing gate must compare the deal against what the dealer is advertising
-- TODAY, and an old capture is not that.
--
-- verify_addendum_price picks the price it compares the addendum's all-in total
-- against with a single ORDER BY: (source_channel = 'website') DESC,
-- captured_at DESC. Website first, at any age, by any writer. Three things are
-- wrong with that ordering now that advertised_prices carries truthful
-- provenance (captured_method, added 20260908280000):
--
--   1. "website" is a channel label, not a provenance. A crawler observation of
--      the dealer's own VDP (captured_method = 'dealer_vdp_observation') is the
--      dealer's current claim. A 'marketcheck_syndication' row is the feed
--      echoing the inventory system, a 'crawl_seed' row is a placeholder that
--      carries the feed price, and a NULL captured_method is a legacy row of
--      unknown provenance. The admin seeder still writes a website-channel row
--      with the feed price and no captured_method
--      (src/components/admin/PriceIntegrityPanel.tsx:106-115), and the client
--      capture path writes source_channel = 'manual' with no captured_method
--      (src/hooks/useAdvertisedPrices.ts:70-77), so the channel alone cannot be
--      trusted to mean "we looked at the page".
--
--   2. There is no age bound, so the OLDEST possible evidence outranks the
--      newest. Live on the pilot tenant (Harte Infiniti,
--      3f0f97f5-4151-4e32-88ef-e2d6fc5a3142) on 2026-09-09: VIN
--      JN8AZ3AE1T9720885 (2026 QX80) carries a website capture of $90,403 taken
--      2026-07-05 while the dealer's feed price today is $78,084. The gate
--      compares the customer's all-in total against $90,403. Three more active
--      VINs are in the same state: JN8AZ3CC9T9622022 $109,195 (2026-08-10) vs
--      $103,090; 5N1AL1FS7TC339685 $63,120 (2026-07-05) vs $60,893;
--      NMTKHMBXXMR129285 $19,890 (2026-08-24) vs $19,785.
--
--   3. A refusal never supersedes the row it refused. Every one of those stale
--      captures reads ABOVE the feed price, which is exactly what the crawler's
--      misparse guard refuses to write (supabase/functions/crawl-advertised-
--      prices/index.ts:1662-1666: a scrape more than 2% above the feed is a
--      sticker/MSRP/lease mis-parse, not a sale price). The refusal is recorded
--      as outcome 'price_rejected' in advertised_price_crawl_attempts and the
--      VIN is then held out of the rotation for 7 days
--      (REJECTED_BACKOFF_MS, index.ts:775). Nothing is written to
--      advertised_prices on a refusal, so the bad row simply stays the winner
--      and the ledger entry that says "we looked again and would not believe
--      that number" is ignored.
--
-- WHY 7 DAYS. The bound is taken from the crawler's own contract with itself,
-- not chosen for feel. REJECTED_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000
-- (crawl-advertised-prices/index.ts:775) is the longest interval the system
-- deliberately allows between two looks at a VIN's page: a refused vehicle is
-- knowingly not revisited for 7 days, and every other vehicle is revisited
-- sooner because the queue is ordered by observation staleness
-- (advertised_price_crawl_queue, 20260909020000). So after 7 days one of two
-- things is true, and both mean the same thing: either the rotation has been
-- back and the row would have been refreshed, or the crawl is not running. In
-- neither case does the platform have a basis to tell a customer that the page
-- still says that number. Measured against live rotation on this tenant: 1,511
-- consecutive-observation gaps, p50 0.25 days, p90 0.25 days, p99 1.50 days,
-- max 10.45 days -- so 7 days sits above the 99th percentile of a healthy
-- rotation and well below the 30-66 day rows this change is here to demote.
-- The rotation is also demonstrably interruptible: zero website observations
-- were written between 2026-08-25 and 2026-09-08 inclusive, a 15-day hole, and
-- 25 of 46 crawl attempts on 2026-09-09 ended in render_rate_limited or
-- render_cost_refused. A bound long enough to survive that hole would be a
-- bound long enough to sign a customer against a July price.
--
-- WHAT REPLACES IT. An explicit three-rung ladder, each rung named by
-- provenance instead of by channel label:
--
--   1. the newest dealer_vdp_observation on the website channel, no older than
--      7 days, that has not been superseded by a later price_rejected entry for
--      the same tenant and VIN;
--   2. else the newest manual_dealer_confirmation, same 7-day bound (a human at
--      the dealership attesting the number is evidence, but it ages too);
--   3. else the newest marketcheck_syndication row -- the dealer's own current
--      feed price. No age bound on this rung: marketcheck-sync writes a feed row
--      only when the price MOVES (marketcheck-sync/index.ts:1210-1241), so the
--      newest feed row IS the current feed price. Verified live: the newest feed
--      row equals vehicle_listings.price on 128 of 128 active listings that have
--      one, and on the pilot tenant vehicle_listings.price is exactly the number
--      the customer Passport shows as Total Advertised Price
--      (price_display_mode = 'website_sale_price', advertised_includes_doc_fee =
--      true, src/lib/priceModel.ts:196-213).
--
-- Rows with captured_method NULL or 'crawl_seed' are never used. That is
-- deliberate and fail-closed: a placeholder carrying the feed price, or a row of
-- unknown provenance, must not be presented as evidence of an advertised price
-- at a signing gate. Live count of such rows: 0.
--
-- The fallback is the point. Nothing here can leave a car unsignable that is
-- signable today, because rung 3 is the dealer's own current price rather than
-- nothing -- see "DATA IMPACT" for the row-by-row proof.
--
-- ---------------------------------------------------------------------------
-- PURPOSE (directive 55)
-- Stop a stale, guard-refused or wrongly-provenanced advertised-price row from
-- outranking the dealer's current price at public.verify_addendum_price, the
-- server-side price-integrity gate that decides whether a customer may sign an
-- addendum. Same signature, same return type, same grants, same SECURITY
-- DEFINER + search_path; body only.
--
-- FORWARD SQL
-- One CREATE OR REPLACE FUNCTION public.verify_addendum_price(uuid, numeric),
-- below. No DDL on any table, no grant statement, no cron change, no data
-- write of any kind at apply time.
--
-- DATA IMPACT (all figures read-only on 2026-09-09 against project
-- onnbmmdbrsgytfozfozn / Lovable 1a2a5abf-4218-480d-aac9-d7bd0d3cfb73)
--
--   Rows written by this migration: 0. The function is called per addendum and
--   writes only the addendum it was called with; nothing is backfilled.
--
--   Which addendums change: NONE. There are 4 addendum rows in the database.
--   All 4 are for VINs that have no advertised_prices row at all
--   (5N1AT3CB7MC736556, JN8AZ3CC0S9602059 x2, JN8AZ3CC5T9624253), so the
--   function returns 'pending' for each of them both before and after this
--   change. No existing row's price_verification_status, price_verified,
--   scraped_advertised_price or price_verification_delta would move.
--
--   Which VINs change the number the gate would compare against: 4 of the 131
--   active listings, all on the pilot tenant, all new cars whose stale website
--   capture reads above the feed:
--
--     VIN                 today (channel, captured)      after (rung, captured)
--     JN8AZ3AE1T9720885   90,403  website  2026-07-05    78,084  feed 2026-09-09
--     JN8AZ3CC9T9622022  109,195  website  2026-08-10   103,090  feed 2026-09-09
--     5N1AL1FS7TC339685   63,120  website  2026-07-05    60,893  feed 2026-09-09
--     NMTKHMBXXMR129285   19,890  website  2026-08-24    19,785  feed 2026-09-08
--
--   In all four cases the new number equals vehicle_listings.price exactly, and
--   therefore equals the Total Advertised Price the customer Passport shows.
--   No active VIN moves in the other direction (a fresh observation is still
--   preferred over the feed on all 16 VINs that have one; all 16 were captured
--   within the last 24 hours).
--
--   Coverage does not shrink on live inventory: 128 of 131 active listings
--   yield a comparable price before AND after (16 via rung 1, 112 via rung 3).
--   The 3 that yield nothing yield nothing today either: 5N1AT3CB7MC736556 and
--   JN8AZ3CC5T9624253 (no advertised_prices row, and vehicle_listings.price is
--   NULL) and JN8AZ3DB6T9435410 in tenant 93ae75c1 (no advertised_prices row).
--
--   17 (tenant, VIN) keys in advertised_prices do lose their value (website
--   rows only, no feed row, newest capture 2026-07-05 to 2026-08-22, so they
--   fall through all three rungs and return NULL -> 'pending'). Every one of
--   them is either an archived listing or a VIN with no vehicle_listings row at
--   all, and all 17 have ZERO addendums. None of them is a car that can be
--   sold, so no vehicle loses its ability to sign. They are listed by the
--   verification query below.
--
--   Pass/fail flips on real rows: none, because no addendum has a comparable
--   price today. Forward-looking, a NEW deal written on one of the four VINs
--   above would flip from pass to fail if and only if the desk built it against
--   the stale capture -- which is the entire purpose of the change: on
--   JN8AZ3AE1T9720885 the customer's advertised price is 78,084, not 90,403.
--
--   CALLERS. One caller exists: src/pages/Index.tsx:1087
--   (.rpc("verify_addendum_price", { _addendum_id, _tolerance: 50 })) on the
--   "Ready for Signatures" path, gated on settings.feature_price_verification
--   and skipped on a manager override. No edge function and no other SQL
--   function calls it (pg_proc.prosrc scan: 0 hits). Consumers of what it
--   writes are read-only and unchanged in shape: MobileSigning.tsx:304-305 and
--   CustomerReview.tsx:272-273 (block signing unless verified),
--   SavedAddendums.tsx:180,221 (chip), SalesManagerHome.tsx:221 and
--   customerBook.ts:511 (counts), plus the server guards
--   record_customer_signing and the trg_enforce_price_verified trigger, both of
--   which read addendums.price_verified and are themselves gated on
--   tenant_price_verification_on(tenant_id).
--
--   LIVE BLAST RADIUS TODAY IS ZERO, and this must be said plainly: EXECUTE on
--   verify_addendum_price(uuid, numeric) was revoked from anon, authenticated
--   and PUBLIC by 20260627175334_7c96133c...sql:92, and live proacl today is
--   {postgres=X/postgres, service_role=X/postgres}. The browser caller runs
--   under the user's JWT, so it currently receives "permission denied for
--   function verify_addendum_price", which Index.tsx:1090 matches with
--   /verify_addendum_price|function|does not exist/i and treats as "migration
--   not applied yet", silently falling back to the client-side gate. So the
--   server gate is inert for every human user right now. That is a separate
--   defect (recorded, not fixed here -- this migration is forbidden from
--   touching grants), and it is also why this change can be applied with no
--   risk of surprising a live signing session: it corrects the arithmetic
--   before the grant is restored.
--
-- RLS IMPACT
--   None. No policy is created, altered or dropped. The function is and stays
--   SECURITY DEFINER with SET search_path = public, owned by postgres, so it
--   reads advertised_prices, advertised_price_crawl_attempts and addendums with
--   RLS bypassed exactly as it does today. The one newly-read table,
--   advertised_price_crawl_attempts (RLS enabled, 2 policies), is read only as
--   an EXISTS test scoped to the addendum's own tenant_id and VIN; no row from
--   it is returned to the caller and nothing about it is exposed. The CLAUDE.md
--   (SELECT auth.uid()) / TO authenticated policy rule has nothing to bind to
--   here: this migration defines no policy.
--
-- INDEX IMPACT
--   None created, none dropped. Rungs 1-3 filter (tenant_id, upper(vin),
--   captured_at) and are served by the existing
--   idx_advertised_prices_tenant_vin_captured (tenant_id, upper(vin),
--   captured_at DESC); the supersession test is served by
--   ux_ap_crawl_attempts_target (tenant_id, upper(vin), source_label) as a
--   leading-column prefix. Measured plan for rung 1 on the worked VIN:
--   Nested Loop Anti Join over Index Scan, 3 shared buffer hits, 0.132 ms
--   execution. The gate runs once per addendum, so the worst case is three
--   index probes plus one anti-join per call.
--
-- EXPECTED ROW COUNTS (pre-apply, live)
--   advertised_prices                1,676 rows -- 1,548 website /
--                                    dealer_vdp_observation (2026-06-23 ..
--                                    2026-09-09), 128 feed /
--                                    marketcheck_syndication (2026-09-08 ..
--                                    2026-09-09), 0 NULL captured_method,
--                                    0 crawl_seed, 0 manual_dealer_confirmation
--   advertised_price_crawl_attempts  46 rows -- 16 captured, 15
--                                    render_rate_limited, 10
--                                    render_cost_refused, 5 price_rejected
--                                    (5N1BT3BB2TC779545, 5N1AL1F90VC336143,
--                                    5N1AL1F86VC332265, 5N1AL1F83VC338993,
--                                    5N1AL1F83VC338945 -- none of which has any
--                                    website row, so rule 3 is a latent guard
--                                    with zero effect on today's data)
--   addendums                        4 rows, 2 with expected_total, all
--                                    price_verification_status = 'pending'
--   vehicle_listings                 131 active (130 pilot tenant + 1 other)
--   (tenant, VIN) keys in advertised_prices  145; 21 change their pick
--                                    (4 active listings -> feed price,
--                                    17 archived/absent -> NULL)
--
-- BACKFILL PLAN
--   None, and none is possible or wanted. verify_addendum_price is a per-call
--   setter; the columns it writes (price_verification_status, price_verified,
--   price_verified_at, price_verification_method, scraped_advertised_price,
--   price_verification_delta) are re-derived on the next call for that
--   addendum. Re-verifying the 4 existing addendums would change nothing (all
--   'pending', no advertised price on file for their VINs). Deliberately NOT
--   done: mass-calling the function would fire the addendums UPDATE trigger on
--   rows that include two legacy signed addendums from 2026-06-15/17.
--
-- VERIFICATION QUERY (read-only; run before and after -- the two runs must
-- return the same 4 changed active VINs and the same 128/131 coverage)
--
--   WITH act AS (
--     SELECT tenant_id, upper(vin) AS vin, price FROM public.vehicle_listings
--      WHERE archived_at IS NULL AND status <> 'archived'),
--   cur AS (SELECT a.vin, ap.advertised_price AS old_pick, ap.source_channel, ap.captured_at
--     FROM act a JOIN LATERAL (
--       SELECT * FROM public.advertised_prices ap
--        WHERE ap.tenant_id = a.tenant_id AND upper(ap.vin) = a.vin
--        ORDER BY (ap.source_channel = 'website') DESC, ap.captured_at DESC LIMIT 1) ap ON true),
--   nw AS (SELECT a.vin, coalesce(o.advertised_price, m.advertised_price, f.advertised_price) AS new_pick,
--            CASE WHEN o.advertised_price IS NOT NULL THEN 'observation'
--                 WHEN m.advertised_price IS NOT NULL THEN 'manual'
--                 WHEN f.advertised_price IS NOT NULL THEN 'feed' ELSE 'none' END AS rung
--     FROM act a
--     LEFT JOIN LATERAL (SELECT * FROM public.advertised_prices ap
--        WHERE ap.tenant_id = a.tenant_id AND upper(ap.vin) = a.vin
--          AND ap.source_channel = 'website' AND ap.captured_method = 'dealer_vdp_observation'
--          AND ap.captured_at >= now() - interval '7 days'
--          AND NOT EXISTS (SELECT 1 FROM public.advertised_price_crawl_attempts t
--                           WHERE t.tenant_id = a.tenant_id AND upper(t.vin) = a.vin
--                             AND t.outcome = 'price_rejected' AND t.last_attempt_at > ap.captured_at)
--        ORDER BY ap.captured_at DESC LIMIT 1) o ON true
--     LEFT JOIN LATERAL (SELECT * FROM public.advertised_prices ap
--        WHERE ap.tenant_id = a.tenant_id AND upper(ap.vin) = a.vin
--          AND ap.captured_method = 'manual_dealer_confirmation'
--          AND ap.captured_at >= now() - interval '7 days'
--        ORDER BY ap.captured_at DESC LIMIT 1) m ON true
--     LEFT JOIN LATERAL (SELECT * FROM public.advertised_prices ap
--        WHERE ap.tenant_id = a.tenant_id AND upper(ap.vin) = a.vin
--          AND ap.captured_method = 'marketcheck_syndication'
--        ORDER BY ap.captured_at DESC LIMIT 1) f ON true)
--   SELECT a.vin, a.price AS listing_price, cur.old_pick, cur.source_channel,
--          cur.captured_at::date, nw.new_pick, nw.rung
--     FROM act a JOIN cur ON cur.vin = a.vin JOIN nw ON nw.vin = a.vin
--    WHERE cur.old_pick IS DISTINCT FROM nw.new_pick
--    ORDER BY abs(cur.old_pick - coalesce(nw.new_pick, 0)) DESC;
--
--   Companion (must stay 0): addendums whose verification status would move --
--   SELECT count(*) FROM public.addendums a
--    WHERE a.expected_total IS NOT NULL
--      AND EXISTS (SELECT 1 FROM public.advertised_prices ap
--                   WHERE ap.tenant_id = a.tenant_id
--                     AND upper(ap.vin) = upper(coalesce(a.vehicle_vin,'')));
--
--   Companion (the 17 archived/absent keys that go to NULL, each of which must
--   show 0 addendums) --
--   SELECT k.vin, l.status, l.archived_at,
--          (SELECT count(*) FROM public.addendums a
--            WHERE a.tenant_id = k.tenant_id
--              AND upper(coalesce(a.vehicle_vin,'')) = k.vin) AS addenda
--     FROM (SELECT DISTINCT tenant_id, upper(vin) AS vin FROM public.advertised_prices) k
--     LEFT JOIN public.vehicle_listings l ON l.tenant_id = k.tenant_id AND upper(l.vin) = k.vin
--    WHERE NOT EXISTS (SELECT 1 FROM public.advertised_prices ap
--                       WHERE ap.tenant_id = k.tenant_id AND upper(ap.vin) = k.vin
--                         AND ap.captured_method = 'marketcheck_syndication');
--
-- ROLLBACK / COMPENSATING STRATEGY
--   Body-only change, so rollback is body-only and instant. Nothing to undo in
--   data: this migration writes no rows, drops no object and changes no grant,
--   so re-applying the prior body restores the exact prior behaviour. Verbatim
--   restore of the 20260618011323 body:
--
--     CREATE OR REPLACE FUNCTION public.verify_addendum_price(
--       _addendum_id uuid, _tolerance numeric DEFAULT 50)
--     RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $rb$
--     DECLARE
--       v_addendum public.addendums%ROWTYPE; v_adv numeric;
--       v_expected numeric; v_status text;
--     BEGIN
--       SELECT * INTO v_addendum FROM public.addendums WHERE id = _addendum_id;
--       IF NOT FOUND THEN RAISE EXCEPTION 'addendum % not found', _addendum_id; END IF;
--       v_expected := v_addendum.expected_total;
--       SELECT ap.advertised_price INTO v_adv
--         FROM public.advertised_prices ap
--        WHERE ap.tenant_id = v_addendum.tenant_id
--          AND upper(ap.vin) = upper(coalesce(v_addendum.vehicle_vin, ''))
--        ORDER BY (ap.source_channel = 'website') DESC, ap.captured_at DESC
--        LIMIT 1;
--       IF v_expected IS NULL OR v_adv IS NULL THEN v_status := 'pending';
--       ELSIF abs(v_expected - v_adv) <= _tolerance THEN v_status := 'verified';
--       ELSE v_status := 'mismatch'; END IF;
--       UPDATE public.addendums SET
--         price_verification_status = v_status,
--         price_verified            = (v_status = 'verified'),
--         price_verified_at         = CASE WHEN v_status = 'verified' THEN now() ELSE price_verified_at END,
--         price_verification_method = CASE WHEN v_adv IS NULL THEN 'scrape_pending' ELSE 'scrape_auto' END,
--         scraped_advertised_price  = v_adv,
--         price_verification_delta  = CASE WHEN v_adv IS NULL OR v_expected IS NULL THEN NULL ELSE v_expected - v_adv END
--       WHERE id = _addendum_id;
--       RETURN v_status;
--     END; $rb$;
--
--   Compensating action if a desk is blocked after this change: the correct
--   remedy is NOT rollback. A 'mismatch' here means the deal total disagrees
--   with the dealer's own current price by more than the tolerance; re-crawl
--   the VIN (crawl-advertised-prices with that vin), or correct the selling
--   price. The manager-override path (Index.tsx:1049-1053) remains available
--   and remains recorded on the audit trail.
--
--   Customer Passport: unaffected, and structurally so. Neither
--   supabase/functions/public-listing-view/index.ts, src/hooks/usePublicListing.ts,
--   src/lib/passportV2Data.ts nor src/pages/VehiclePassportGoverned.tsx reads
--   advertised_prices or addendums at all (grep: 0 hits); the Passport price
--   comes from get_vehicle_listing_by_slug -> vehicle_listings + dealer_profiles
--   settings. This migration touches neither table.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_addendum_price(
  _addendum_id uuid,
  _tolerance   numeric DEFAULT 50
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_addendum public.addendums%ROWTYPE;
  v_vin      text;
  v_adv      numeric;
  v_expected numeric;
  v_status   text;
  v_method   text;
  -- The crawler holds a refused VIN out of the rotation for exactly this long
  -- (REJECTED_BACKOFF_MS, crawl-advertised-prices/index.ts:775), which makes it
  -- the longest interval the platform ever intends to go without looking at a
  -- dealer's page. Past it, an observation is no longer a claim about today.
  v_max_observation_age constant interval := interval '7 days';
BEGIN
  SELECT * INTO v_addendum FROM public.addendums WHERE id = _addendum_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'addendum % not found', _addendum_id;
  END IF;

  v_expected := v_addendum.expected_total;
  v_vin      := upper(coalesce(v_addendum.vehicle_vin, ''));

  -- Rung 1: we looked at the dealer's own page recently, and no later crawl
  -- refused what we read. captured_method is the provenance; source_channel is
  -- only a label, so both are required.
  SELECT ap.advertised_price INTO v_adv
    FROM public.advertised_prices ap
   WHERE ap.tenant_id = v_addendum.tenant_id
     AND upper(ap.vin) = v_vin
     AND ap.source_channel  = 'website'
     AND ap.captured_method = 'dealer_vdp_observation'
     AND ap.captured_at >= now() - v_max_observation_age
     AND NOT EXISTS (
           SELECT 1
             FROM public.advertised_price_crawl_attempts t
            WHERE t.tenant_id = v_addendum.tenant_id
              AND upper(t.vin) = v_vin
              AND t.outcome = 'price_rejected'
              AND t.last_attempt_at > ap.captured_at)
   ORDER BY ap.captured_at DESC
   LIMIT 1;
  IF v_adv IS NOT NULL THEN
    v_method := 'scrape_auto';
  END IF;

  -- Rung 2: a human at the dealership attested the number. Evidence, but it
  -- ages the same way an observation does.
  IF v_adv IS NULL THEN
    SELECT ap.advertised_price INTO v_adv
      FROM public.advertised_prices ap
     WHERE ap.tenant_id = v_addendum.tenant_id
       AND upper(ap.vin) = v_vin
       AND ap.captured_method = 'manual_dealer_confirmation'
       AND ap.captured_at >= now() - v_max_observation_age
     ORDER BY ap.captured_at DESC
     LIMIT 1;
    IF v_adv IS NOT NULL THEN
      v_method := 'manual_confirmation';
    END IF;
  END IF;

  -- Rung 3: the dealer's own current price. marketcheck-sync writes a feed row
  -- only when the price moves, so the newest feed row is the current feed
  -- price, and no age bound belongs on it. This rung is why nothing becomes
  -- unsignable: the fallback is the dealer's live number, not nothing.
  IF v_adv IS NULL THEN
    SELECT ap.advertised_price INTO v_adv
      FROM public.advertised_prices ap
     WHERE ap.tenant_id = v_addendum.tenant_id
       AND upper(ap.vin) = v_vin
       AND ap.captured_method = 'marketcheck_syndication'
     ORDER BY ap.captured_at DESC
     LIMIT 1;
    IF v_adv IS NOT NULL THEN
      v_method := 'feed_price';
    END IF;
  END IF;

  -- Rows with captured_method NULL or 'crawl_seed' are intentionally unreachable
  -- above: unknown provenance and a feed-priced placeholder are not evidence of
  -- an advertised price, and this gate is customer-facing.

  IF v_expected IS NULL OR v_adv IS NULL THEN
    v_status := 'pending';
  ELSIF abs(v_expected - v_adv) <= _tolerance THEN
    v_status := 'verified';
  ELSE
    v_status := 'mismatch';
  END IF;

  UPDATE public.addendums SET
    price_verification_status = v_status,
    price_verified            = (v_status = 'verified'),
    price_verified_at         = CASE WHEN v_status = 'verified' THEN now() ELSE price_verified_at END,
    price_verification_method = coalesce(v_method, 'scrape_pending'),
    scraped_advertised_price  = v_adv,
    price_verification_delta  = CASE WHEN v_adv IS NULL OR v_expected IS NULL THEN NULL ELSE v_expected - v_adv END
  WHERE id = _addendum_id;

  RETURN v_status;
END;
$function$;

-- Self-check. Raises if the change did not take, if the shape or the grants
-- moved, or if the live data no longer behaves the way the header claims.
DO $$
DECLARE
  v_def  text;
  v_oid  oid;
  v_bad  int;
  v_cov_before int;
  v_cov_after  int;
  v_pilot uuid := '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142';
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'verify_addendum_price';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'verify_addendum_price is missing after the replace';
  END IF;

  -- Shape is unchanged: (uuid, numeric) -> text, SECURITY DEFINER, search_path.
  IF pg_get_function_identity_arguments(v_oid) <> '_addendum_id uuid, _tolerance numeric' THEN
    RAISE EXCEPTION 'verify_addendum_price signature changed: (%)', pg_get_function_identity_arguments(v_oid);
  END IF;
  IF (SELECT prorettype FROM pg_proc WHERE oid = v_oid) <> 'text'::regtype THEN
    RAISE EXCEPTION 'verify_addendum_price no longer returns text';
  END IF;
  IF NOT coalesce((SELECT prosecdef FROM pg_proc WHERE oid = v_oid), false)
     OR NOT coalesce((SELECT proconfig FROM pg_proc WHERE oid = v_oid) @> ARRAY['search_path=public'], false) THEN
    RAISE EXCEPTION 'verify_addendum_price lost SECURITY DEFINER or its search_path';
  END IF;

  -- The old unbounded website-first pick is gone and every new rule is present.
  IF position('(ap.source_channel = ''website'') DESC' in v_def) > 0 THEN
    RAISE EXCEPTION 'verify_addendum_price still orders website-first with no age bound';
  END IF;
  IF position('dealer_vdp_observation' in v_def) = 0 THEN
    RAISE EXCEPTION 'verify_addendum_price does not require captured_method = dealer_vdp_observation';
  END IF;
  IF position('interval ''7 days''' in v_def) = 0 THEN
    RAISE EXCEPTION 'verify_addendum_price has no 7-day observation bound';
  END IF;
  IF position('price_rejected' in v_def) = 0 THEN
    RAISE EXCEPTION 'verify_addendum_price does not treat a later price_rejected as superseding';
  END IF;
  IF position('marketcheck_syndication' in v_def) = 0 THEN
    RAISE EXCEPTION 'verify_addendum_price has no feed fallback; vehicles would lose the ability to sign';
  END IF;

  -- Grants must not have been lost. (anon/authenticated hold no EXECUTE today,
  -- revoked by 20260627175334; a later deliberate grant is reported, not fatal.)
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on verify_addendum_price';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE NOTICE 'verify_addendum_price is executable by anon/authenticated; it was not at the time this migration was written';
  END IF;

  -- Live behaviour, only where the pilot data this was measured against exists.
  IF EXISTS (SELECT 1 FROM public.advertised_prices WHERE tenant_id = v_pilot) THEN
    -- No superseded or wrongly-provenanced row may be the winning observation.
    SELECT count(*) INTO v_bad
      FROM public.advertised_prices ap
     WHERE ap.tenant_id = v_pilot
       AND ap.source_channel = 'website'
       AND ap.captured_method IS DISTINCT FROM 'dealer_vdp_observation';
    IF v_bad > 0 THEN
      RAISE NOTICE '% website rows on the pilot tenant are not dealer_vdp_observation and are now ignored by the gate', v_bad;
    END IF;

    -- Coverage must not shrink: every active listing that yields a comparable
    -- price under the old pick must still yield one under the new ladder.
    SELECT count(*) INTO v_cov_before
      FROM public.vehicle_listings l
     WHERE l.archived_at IS NULL AND l.status <> 'archived'
       AND EXISTS (SELECT 1 FROM public.advertised_prices ap
                    WHERE ap.tenant_id = l.tenant_id AND upper(ap.vin) = upper(l.vin));

    SELECT count(*) INTO v_cov_after
      FROM public.vehicle_listings l
     WHERE l.archived_at IS NULL AND l.status <> 'archived'
       AND EXISTS (
         SELECT 1 FROM public.advertised_prices ap
          WHERE ap.tenant_id = l.tenant_id AND upper(ap.vin) = upper(l.vin)
            AND (
              ap.captured_method = 'marketcheck_syndication'
              OR (ap.captured_method IN ('dealer_vdp_observation','manual_dealer_confirmation')
                  AND ap.captured_at >= now() - interval '7 days')
            ));

    IF v_cov_after < v_cov_before THEN
      RAISE EXCEPTION
        'verify_addendum_price would leave % active listing(s) with no comparable price (before %, after %)',
        v_cov_before - v_cov_after, v_cov_before, v_cov_after;
    END IF;
    RAISE NOTICE 'verify_addendum_price: active-listing price coverage before % / after %', v_cov_before, v_cov_after;
  END IF;
END $$;