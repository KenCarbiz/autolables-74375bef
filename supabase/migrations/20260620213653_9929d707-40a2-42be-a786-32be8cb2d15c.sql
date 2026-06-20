
-- 1) oem-stickers: drop anon read; switch to signed URLs (issued by edge function)
DROP POLICY IF EXISTS "Public read oem-stickers" ON storage.objects;

CREATE POLICY "Tenant members read oem-stickers"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'oem-stickers'
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR (split_part(name, '/', 1))::uuid IN (
        SELECT tenant_id FROM public.tenant_members
        WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
      )
    )
  );

-- 2) vehicle_listings: prevent anon from reading the secret install_token column.
-- RLS allows anon SELECT for status='published'; column-level REVOKE forces
-- PostgREST to exclude install_token from anon queries.
REVOKE SELECT (install_token) ON public.vehicle_listings FROM anon;
REVOKE SELECT (install_token) ON public.vehicle_listings FROM PUBLIC;

-- 3) realtime.messages: enable RLS and require an authenticated session.
-- Per-row tenant filtering still happens via RLS on the published source
-- tables (postgres_changes events are filtered by source-table RLS), so this
-- closes the open-channel subscription hole without breaking existing flows.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can subscribe" ON realtime.messages;
CREATE POLICY "Authenticated users can subscribe"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can broadcast" ON realtime.messages;
CREATE POLICY "Authenticated users can broadcast"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
