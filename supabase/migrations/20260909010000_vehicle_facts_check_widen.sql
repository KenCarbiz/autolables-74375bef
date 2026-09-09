-- Widen the vehicle_facts / vehicle_source_records CHECK lists to match the
-- TypeScript enums that write them.
--
-- src/lib/vehicleTruth/precedence.ts has carried `dealer_vdp` in SourceKind
-- and `history_provider` in FactAuthority since the history-fact work, and
-- every resolver, ranking and cap already handles both. The tables did not:
-- these constraints were created inline on 2026-07-27 with the seven original
-- source kinds and three original authorities, and nothing widened them.
--
-- Nothing persisted the new values yet, so nothing failed visibly. It would
-- have failed invisibly. refreshVehicleTruth wrote all of a vehicle's facts in
-- one multi-row upsert and discarded the result; supabase-js resolves rather
-- than throws on a constraint violation, so the first `history_provider` fact
-- would have rejected the whole statement -- every fact for that VIN, not one
-- -- while the refresh reported success and the sticker generated off an
-- empty ledger. The write side now surfaces per-row errors; this migration
-- removes the reason there would be any.
--
-- Only the two values the engine already defines are added. The DO block at
-- the end reads the live definitions back and fails the migration if either
-- is missing, and src/lib/vehicleTruth/checkConstraintDrift.test.ts reads
-- this file to fail the suite if the enum ever grows past the CHECK again.

ALTER TABLE public.vehicle_facts
  DROP CONSTRAINT IF EXISTS vehicle_facts_source_kind_check;
ALTER TABLE public.vehicle_facts
  ADD CONSTRAINT vehicle_facts_source_kind_check CHECK (source_kind IN (
    'oem_authorized','neovin','marketcheck','dealer_confirmed',
    'vin_decode','dealer_vdp','other_structured','ai_inference'));

ALTER TABLE public.vehicle_source_records
  DROP CONSTRAINT IF EXISTS vehicle_source_records_source_kind_check;
ALTER TABLE public.vehicle_source_records
  ADD CONSTRAINT vehicle_source_records_source_kind_check CHECK (source_kind IN (
    'oem_authorized','neovin','marketcheck','dealer_confirmed',
    'vin_decode','dealer_vdp','other_structured','ai_inference'));

ALTER TABLE public.vehicle_facts
  DROP CONSTRAINT IF EXISTS vehicle_facts_authority_check;
ALTER TABLE public.vehicle_facts
  ADD CONSTRAINT vehicle_facts_authority_check CHECK (authority IN (
    'manufacturer','dealer','history_provider','shared'));

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'vehicle_facts_source_kind_check'
     AND conrelid = 'public.vehicle_facts'::regclass;
  IF def IS NULL OR def NOT LIKE '%dealer_vdp%' THEN
    RAISE EXCEPTION 'vehicle_facts_source_kind_check does not allow dealer_vdp: %', coalesce(def, '<missing>');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'vehicle_source_records_source_kind_check'
     AND conrelid = 'public.vehicle_source_records'::regclass;
  IF def IS NULL OR def NOT LIKE '%dealer_vdp%' THEN
    RAISE EXCEPTION 'vehicle_source_records_source_kind_check does not allow dealer_vdp: %', coalesce(def, '<missing>');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'vehicle_facts_authority_check'
     AND conrelid = 'public.vehicle_facts'::regclass;
  IF def IS NULL OR def NOT LIKE '%history_provider%' THEN
    RAISE EXCEPTION 'vehicle_facts_authority_check does not allow history_provider: %', coalesce(def, '<missing>');
  END IF;
END $$;
