-- Applied after the migration chain: brings the columns the sync touches in
-- line with the hosted catalogue as read on 2026-10-29 (types, nullability and
-- defaults only). The chain leaves these different because some hosted
-- changes were made outside the repository's migrations. captured_by stays
-- text here (hosted: uuid) because a view depends on it; the sync writes null.

ALTER TABLE public.advertised_prices
  ADD COLUMN IF NOT EXISTS captured_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS captured_method text,
  ADD COLUMN IF NOT EXISTS source_channel text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.advertised_prices ALTER COLUMN captured_by DROP NOT NULL;
ALTER TABLE public.advertised_prices ALTER COLUMN captured_by DROP DEFAULT;
ALTER TABLE public.advertised_prices ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE public.advertised_prices ALTER COLUMN source_url DROP NOT NULL;
ALTER TABLE public.advertised_prices ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS row_hash text;
