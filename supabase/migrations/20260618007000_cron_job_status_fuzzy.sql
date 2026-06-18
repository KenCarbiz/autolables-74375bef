-- Make get_cron_job_status tolerant of how the job was registered: some crons
-- are named with the autolabels_ prefix and underscores (e.g.
-- autolabels_crawl_advertised_prices) while the app asks for the hyphenated
-- logical name (crawl-advertised-prices). Match by stripping separators, pick
-- the single best (active, most recently run) job.
CREATE OR REPLACE FUNCTION public.get_cron_job_status(_jobname text)
RETURNS TABLE (
  jobname      text,
  schedule     text,
  active       boolean,
  last_status  text,
  last_message text,
  last_start   timestamptz,
  last_end     timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
DECLARE
  _norm text := regexp_replace(lower(_jobname), '[-_ ]', '', 'g');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT
    j.jobname::text,
    j.schedule::text,
    j.active,
    r.status::text,
    r.return_message::text,
    r.start_time,
    r.end_time
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT d.status, d.return_message, d.start_time, d.end_time
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC
    LIMIT 1
  ) r ON true
  WHERE regexp_replace(lower(j.jobname), '[-_ ]', '', 'g') LIKE '%' || _norm || '%'
  ORDER BY j.active DESC, r.start_time DESC NULLS LAST
  LIMIT 1;
END $$;

GRANT EXECUTE ON FUNCTION public.get_cron_job_status(text) TO authenticated;
