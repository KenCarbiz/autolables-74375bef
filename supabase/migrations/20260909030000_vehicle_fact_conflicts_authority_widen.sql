-- vehicle_fact_conflicts.authority was created with the same three-value list
-- as vehicle_facts.authority and was widened by nothing when history_provider
-- joined FactAuthority. factory-sticker-orchestrate/truth.ts writes
-- conflict.authority straight into this column, so the first disagreement
-- between two history-provider facts on a VIN would have been rejected with
-- the same silent failure 20260909010000 closes for facts. Superset only; the
-- DO block reads the live definition back and fails the migration otherwise.

ALTER TABLE public.vehicle_fact_conflicts
  DROP CONSTRAINT IF EXISTS vehicle_fact_conflicts_authority_check;
ALTER TABLE public.vehicle_fact_conflicts
  ADD CONSTRAINT vehicle_fact_conflicts_authority_check CHECK (authority IN (
    'manufacturer','dealer','history_provider','shared'));

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'vehicle_fact_conflicts_authority_check'
     AND conrelid = 'public.vehicle_fact_conflicts'::regclass;
  IF def IS NULL OR def NOT LIKE '%history_provider%' THEN
    RAISE EXCEPTION 'vehicle_fact_conflicts_authority_check does not allow history_provider: %', coalesce(def, '<missing>');
  END IF;
END $$;
