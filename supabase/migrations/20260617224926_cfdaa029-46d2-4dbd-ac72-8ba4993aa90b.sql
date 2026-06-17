ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by TEXT;
CREATE INDEX IF NOT EXISTS idx_addendums_delivered_at ON public.addendums (delivered_at);
NOTIFY pgrst, 'reload schema';