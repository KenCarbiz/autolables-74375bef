-- Multi-site advertised-price sources (Wave 37)
--
-- The price-integrity crawler now records the advertised price found on each
-- marketplace per VIN (dealer website, CARFAX, CarGurus, Cars.com, AutoTrader,
-- Capital One) so a dealer can confirm every site lists the same price. The
-- live advertised_prices channel column carried a CHECK that only allowed the
-- original eight labels, which would reject the new 'carfax' / 'capital_one'
-- channels. Drop that CHECK (whatever it is named, on whichever channel column
-- the live schema uses) so the application controls the allowed values.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND rel.relname = 'advertised_prices'
      AND con.contype = 'c'
      AND (pg_get_constraintdef(con.oid) ILIKE '%source_channel%'
        OR pg_get_constraintdef(con.oid) ILIKE '%source_label%')
  LOOP
    EXECUTE format('ALTER TABLE public.advertised_prices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
