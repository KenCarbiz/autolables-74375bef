-- Read the latest pg_cron run for a named job so the admin UI can show a
-- green/red "did the nightly job actually fire" badge without dropping into
-- SQL. cron.* is superuser-only, so this definer RPC exposes just the status
-- of a single job, to platform admins.
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
  WHERE j.jobname = _jobname;
END $$;

GRANT EXECUTE ON FUNCTION public.get_cron_job_status(text) TO authenticated;
