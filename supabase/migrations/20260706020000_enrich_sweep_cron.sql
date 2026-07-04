-- The nightly self-chaining enrich sweep was never scheduled — enrichment
-- only ran at ingest, and the specs decode (options/features) never ran in
-- bulk at all, leaving most inventory with an empty equipment list. Runs at
-- 03:15 UTC; the sweep self-chains until every incomplete VIN is covered.
-- Applied to the live database by cloning the epa-fuel-economy-sweep
-- command (same anon key + cron secret) with the URL swapped; kept here as
-- the canonical record.

SELECT cron.schedule(
  'enrich-sweep-nightly',
  '15 3 * * *',
  (SELECT replace(replace(command, 'functions/v1/epa-fuel-economy', 'functions/v1/enrich-sweep'), '{"batch": true}', '{}')
   FROM cron.job WHERE jobname = 'epa-fuel-economy-sweep')
);
