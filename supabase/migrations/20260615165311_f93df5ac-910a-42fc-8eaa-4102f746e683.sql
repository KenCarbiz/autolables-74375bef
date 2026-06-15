ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS disclosure_optional text,
  ADD COLUMN IF NOT EXISTS benefit_justification_optional text;