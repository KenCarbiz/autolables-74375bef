
-- Helper to (re)create accepted-member policies
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'ct_mvp_certification_runs','dealer_branding','dealer_cpo_programs',
    'dealer_passport_settings','dealer_price_labels','dealer_review_sources',
    'dealer_rule_preferences','dealer_settings','dealer_template_preferences',
    'document_lifecycle_events','signature_evidence'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' tenant members read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' tenant members write', t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = %I.tenant_id
            AND tm.user_id = (SELECT auth.uid())
            AND tm.accepted_at IS NOT NULL
        ))
    $f$, t || ' tenant members read', t, t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = %I.tenant_id
            AND tm.user_id = (SELECT auth.uid())
            AND tm.accepted_at IS NOT NULL
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = %I.tenant_id
            AND tm.user_id = (SELECT auth.uid())
            AND tm.accepted_at IS NOT NULL
        ))
    $f$, t || ' tenant members write', t, t, t);
  END LOOP;
END $$;

-- Waitlist: replace WITH CHECK (true) with basic field validation
DROP POLICY IF EXISTS "Anyone can join the waitlist" ON public.waitlist_signups;
CREATE POLICY "Anyone can join the waitlist"
  ON public.waitlist_signups
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL
    AND length(email) BETWEEN 3 AND 320
    AND email LIKE '%_@_%.__%'
    AND full_name IS NOT NULL AND length(full_name) BETWEEN 1 AND 200
    AND dealership_name IS NOT NULL AND length(dealership_name) BETWEEN 1 AND 200
    AND status = 'new'
  );

-- Realtime: drop broad rt-% wildcard, require exact tenant_id segment match
DROP POLICY IF EXISTS "Authenticated users can subscribe" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated users can broadcast" ON realtime.messages;

CREATE POLICY "Authenticated users can subscribe"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.accepted_at IS NOT NULL
        AND tm.tenant_id::text = ANY (string_to_array(realtime.topic(), ':'))
    )
  );

CREATE POLICY "Authenticated users can broadcast"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.accepted_at IS NOT NULL
        AND tm.tenant_id::text = ANY (string_to_array(realtime.topic(), ':'))
    )
  );
