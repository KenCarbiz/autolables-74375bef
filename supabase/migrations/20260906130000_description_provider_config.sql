-- Provider, prompt profile and knowledge revision become tenant configuration.
--
-- Generation used to be a hard-coded call to one vendor, so choosing a model
-- was a code change and choosing a vendor was a rewrite. These three columns
-- are what the DescriptionGenerationProvider abstraction reads.
--
-- Defaults preserve today's behaviour exactly: every tenant stays on the
-- current writer until its row says otherwise. Nothing here switches anyone.

ALTER TABLE public.description_settings
  ADD COLUMN IF NOT EXISTS generation_provider text NOT NULL DEFAULT 'anthropic',
  ADD COLUMN IF NOT EXISTS prompt_profile      text NOT NULL DEFAULT 'platform_v3',
  ADD COLUMN IF NOT EXISTS knowledge_revision  text;

ALTER TABLE public.description_settings
  DROP CONSTRAINT IF EXISTS description_settings_generation_provider_check;
ALTER TABLE public.description_settings
  ADD CONSTRAINT description_settings_generation_provider_check
  CHECK (generation_provider IN ('anthropic', 'openai'));

COMMENT ON COLUMN public.description_settings.generation_provider IS
  'Which DescriptionGenerationProvider adapter serves this tenant. The credential is a server-side secret named per adapter and never stored here.';
COMMENT ON COLUMN public.description_settings.prompt_profile IS
  'Instruction profile. "drivesignal-v3-system" selects the owner-approved DriveSignal writer, whose text is pinned by checksum in the repo; anything else keeps the platform prompt builder.';
COMMENT ON COLUMN public.description_settings.knowledge_revision IS
  'Revision of the DriveSignal knowledge corpus whose modules may be loaded. Reference knowledge explains a verified feature; it never establishes that a VIN has one.';

-- Harte is the pilot. The profile, corpus revision and model are set here so
-- the configuration is reviewable, but generation_provider is deliberately
-- LEFT ON THE DEFAULT: flipping the vendor is a spend decision, and it is one
-- statement when the account is funded and the owner says go.
--
--   UPDATE public.description_settings
--      SET generation_provider = 'openai'
--    WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142';
--
-- Reverting is the same statement with 'anthropic'.
UPDATE public.description_settings
   SET prompt_profile     = 'drivesignal-v3-system',
       knowledge_revision = '3.0',
       generation_model   = 'gpt-5.6-luna'
 WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND prompt_profile = 'platform_v3';

-- Owner decision: all tenants run the DriveSignal pilot, and the OpenAI
-- account carries a 100/month cap. Today that is one dealership; the column
-- default is changed too so a dealership onboarded tomorrow arrives on the
-- same writer rather than silently on the old one.
ALTER TABLE public.description_settings
  ALTER COLUMN generation_provider SET DEFAULT 'openai',
  ALTER COLUMN prompt_profile      SET DEFAULT 'drivesignal-v3-system';

UPDATE public.description_settings
   SET generation_provider = 'openai',
       prompt_profile      = 'drivesignal-v3-system',
       knowledge_revision  = '3.0',
       generation_model    = 'gpt-5.6-luna'
 WHERE generation_provider = 'anthropic';

-- Our own ceiling sits BELOW the provider's, so a runaway trips a gate we
-- control and produces a retryable exception, rather than being hard-failed
-- mid-sweep by the vendor with a quota error on every remaining vehicle.
INSERT INTO public.description_generation_budgets AS b (
  tenant_id, monthly_generation_budget, monthly_preview_budget,
  max_cost_per_generation, daily_generation_limit, per_user_daily_limit,
  warning_threshold_pct, hard_stop_pct, currency)
SELECT ds.tenant_id, 90, 10, 0.50, 250, 100, 80, 100, 'USD'
  FROM public.description_settings ds
ON CONFLICT (tenant_id) DO UPDATE
   SET monthly_generation_budget = LEAST(b.monthly_generation_budget, 90),
       monthly_preview_budget    = LEAST(b.monthly_preview_budget, 10),
       updated_at = now();
