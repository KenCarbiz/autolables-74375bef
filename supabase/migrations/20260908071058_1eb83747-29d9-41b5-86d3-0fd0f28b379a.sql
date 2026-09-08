DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['neovin_snapshots','provider_payload_shapes','service_locks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service role only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "service role only" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;