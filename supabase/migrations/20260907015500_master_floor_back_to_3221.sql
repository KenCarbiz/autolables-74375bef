-- Owner correction: keep the floor at 3,221. The goal stays 3,879.
--
-- 20260907014500 lowered it to 3,200; this puts it back. The floor matches
-- vAuto's own recommendedMin, so the master cannot be shorter than the
-- destination it feeds -- channel variants are derived by trimming a master
-- and nothing expands one.
--
-- Only the number changes. 3,879 remains the figure the writer works toward
-- rather than a limit to stay under, and the route to it is still coverage of
-- verified material, never padding.

UPDATE public.description_settings
   SET min_length = 3221,
       updated_at = now()
 WHERE min_length = 3200
   AND max_length = 3879;
