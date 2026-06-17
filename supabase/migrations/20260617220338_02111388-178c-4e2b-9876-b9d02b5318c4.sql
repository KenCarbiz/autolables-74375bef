ALTER TABLE public.addendums ADD COLUMN IF NOT EXISTS customer_info JSONB NOT NULL DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';