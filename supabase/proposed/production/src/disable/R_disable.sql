-- Forward recovery for R (rtgip_source_readers): the restricted reader role can no longer execute the three
-- readers, so no producer can read custody facts. The rooftop map and every other row are kept.
-- Re-running R restores the grants.
DO $$
DECLARE f text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_source_reader') THEN
    FOREACH f IN ARRAY ARRAY['rtgip_src.labels_episode_history(uuid,text,uuid)','rtgip_src.labels_episode_milestones(uuid,text,uuid)','rtgip_src.labels_listing_state(uuid,text,uuid)'] LOOP
      IF to_regprocedure(f) IS NOT NULL THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM rtgip_source_reader', f);
      END IF;
    END LOOP;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
