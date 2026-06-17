-- Price integrity (FTC advertised-price honor): the dealer's actual selling
-- price, captured per addendum, so the all-in total (selling + doc fee +
-- pre-installed items) can be reconciled against the scraped advertised price.
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS selling_price numeric(10,2);

COMMENT ON COLUMN public.addendums.selling_price IS
  'Actual selling price before doc fee. expectedOnline = selling_price + doc fee + pre-installed (in-advertised) items, verified against advertised_prices.';
