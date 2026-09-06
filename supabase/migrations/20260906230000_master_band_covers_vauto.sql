-- The master has to be at least as long as the longest channel floor.
--
-- vAuto's policy is 3221-3879 (owner decision). Channel variants are derived
-- by TRIMMING the master -- nothing expands one -- so a master written to a
-- 1800-3800 band and landing near 2600 could never produce a vAuto variant
-- that met its own floor. Every vAuto export would have sat below it forever,
-- and nothing would have reported that as an error: LENGTH_BELOW_MINIMUM is a
-- warning, so the export would simply have been quietly short.
--
-- The master band now covers the vAuto band. The writer is asked for the band
-- less the appended legal disclosure, so the finished text lands inside it
-- rather than 297 characters past the ceiling.
--
-- Reversible: set min_length back to 1800 and max_length to 3800.

UPDATE public.description_settings
   SET min_length = 3221,
       max_length = 3879,
       updated_at = now()
 WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND min_length = 1800
   AND max_length = 3800;
