-- Deal lifecycle: mark an executed addendum as physically delivered.
--
-- Lifecycle the sidebar surfaces: Saved (draft) -> Waiting for signature ->
-- Signed (executed, awaiting delivery) -> Delivered. A signed addendum stays
-- in "Signed" until the dealer clicks Delivered, which stamps delivered_at and
-- drops the vehicle out of inventory.

ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by TEXT;

CREATE INDEX IF NOT EXISTS idx_addendums_delivered_at
  ON public.addendums (delivered_at);
