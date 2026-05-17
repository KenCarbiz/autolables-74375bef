DO $$
DECLARE
  _table TEXT;
  _tables TEXT[] := ARRAY['vehicle_files','vin_queue','leads','product_rules','prep_sign_offs'];
BEGIN
  FOREACH _table IN ARRAY _tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=_table) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', _table);
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', _table);
      END IF;
    END IF;
  END LOOP;
END $$;