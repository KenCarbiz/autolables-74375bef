-- Owner correction: the floor is 3,200 characters and 3,879 is the GOAL.
--
-- The band was set to 3221-3879, taking vAuto's own floor as the master's.
-- The owner's rule is a flat 3,200 minimum, and the ceiling is the number to
-- write toward rather than a limit to stay under.
--
-- Reaching a goal is a supply problem, never a padding problem: the writer now
-- receives 35 prioritized features out of the 356-504 each vehicle decodes,
-- plus fuel economy, doors, cylinders, engine size and country of manufacture.
-- A vehicle whose verified material genuinely runs out before 3,200 still
-- produces short copy and is flagged, rather than inflated to reach a number.

UPDATE public.description_settings
   SET min_length = 3200,
       max_length = 3879,
       updated_at = now()
 WHERE min_length = 3221
   AND max_length = 3879;
