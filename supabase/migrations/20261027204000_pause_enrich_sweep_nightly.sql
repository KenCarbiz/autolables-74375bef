-- ── Pause the nightly enrich sweep until the plan quota is settled ──────────
--
-- Applied 2026-10-27 on the owner's authorization, together with
-- 20261027203000. The sweep's nightly chain (cron job enrich-sweep-nightly,
-- 03:15 UTC) is what spends the account's 5,000-call monthly plan quota; with
-- it paused, the month's provider calls are the syndication feed, the public
-- comps route on a cache miss, and operator actions. The hourly
-- marketcheck-sync job stays active: it is the feed.
--
-- marketcheck-sync also kicks the sweep once a day at ENRICH_SWEEP_HOUR_UTC
-- (default 08:00); the operator can set that secret to 25 so no hour matches.
-- The Admin button can still start a sweep by hand.
--
-- Un-pause:
--   SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job
--     WHERE jobname = 'enrich-sweep-nightly'), active := true);

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'enrich-sweep-nightly'),
  active := false
);
