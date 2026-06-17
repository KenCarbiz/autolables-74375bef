-- Persist the full buyer / co-buyer capture on the addendum.
--
-- Previously only customer_name / cobuyer_name (composite strings) were stored,
-- so address, city, state, zip, phone, email, middle initial, and suffix were
-- lost on save and blank when the draft was reopened. Store the whole
-- CustomerInfo bag as JSONB so every typed field round-trips.

ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS customer_info JSONB NOT NULL DEFAULT '{}'::jsonb;
