-- Reasoning effort and verbosity become tenant configuration.
--
-- Reasoning tokens bill as OUTPUT, so on a nightly run across a whole lot this
-- is a larger cost lever than the choice of model. The default is deliberately
-- "low": the DriveSignal prompt already specifies the analysis — the evidence
-- hierarchy, the feature tiers, the story questions, the quality checks — and
-- the facts arrive pre-verified in the snapshot. The model is following a
-- detailed procedure, not solving a problem.
--
-- Raise it if the gates say quality demands it. That is an UPDATE, not a
-- deploy, which is the point of putting it here.

ALTER TABLE public.description_settings
  ADD COLUMN IF NOT EXISTS reasoning_effort text DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS verbosity        text DEFAULT 'medium';

ALTER TABLE public.description_settings
  DROP CONSTRAINT IF EXISTS description_settings_reasoning_effort_check;
ALTER TABLE public.description_settings
  ADD CONSTRAINT description_settings_reasoning_effort_check
  CHECK (reasoning_effort IS NULL
         OR reasoning_effort IN ('minimal', 'low', 'medium', 'high'));

ALTER TABLE public.description_settings
  DROP CONSTRAINT IF EXISTS description_settings_verbosity_check;
ALTER TABLE public.description_settings
  ADD CONSTRAINT description_settings_verbosity_check
  CHECK (verbosity IS NULL OR verbosity IN ('low', 'medium', 'high'));

COMMENT ON COLUMN public.description_settings.reasoning_effort IS
  'Reasoning budget for the generation call. NULL leaves the provider default untouched. Reasoning tokens bill as output, so this is the primary cost lever on a fleet-wide run.';

UPDATE public.description_settings
   SET reasoning_effort = COALESCE(reasoning_effort, 'low'),
       verbosity        = COALESCE(verbosity, 'medium');
