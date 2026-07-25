-- ──────────────────────────────────────────────────────────────────────
-- S5: manager messaging + in-app notifications.
--
-- service_messages is the per-vehicle thread between service and the desk.
-- Chat SUPPORTS communication; it never authorizes work — decisions stay
-- structured on service_requests (20260724030000 / 20260726107000).
-- user_notifications is the in-app bell feed, deduped by dedupe_key so a
-- re-run (cron sweep, retried decision) can never double-notify.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.service_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin text NOT NULL,
  author uuid REFERENCES auth.users(id),
  author_name text,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_messages_vin_idx
  ON public.service_messages (tenant_id, vin, created_at DESC);

ALTER TABLE public.service_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service messages tenant read" ON public.service_messages;
CREATE POLICY "service messages tenant read"
  ON public.service_messages FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

-- Members write as themselves; the thread is append-only (no UPDATE/DELETE
-- policy) so the communication record cannot be rewritten after the fact.
DROP POLICY IF EXISTS "service messages tenant write" ON public.service_messages;
CREATE POLICY "service messages tenant write"
  ON public.service_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
    AND (author IS NULL OR author = (SELECT auth.uid()))
  );

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  dedupe_key text UNIQUE,
  vin text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_idx
  ON public.user_notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_tenant_idx
  ON public.user_notifications (tenant_id, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- A user sees and updates (marks read) only their own bell items.
DROP POLICY IF EXISTS "notifications owner read" ON public.user_notifications;
CREATE POLICY "notifications owner read"
  ON public.user_notifications FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notifications owner update" ON public.user_notifications;
CREATE POLICY "notifications owner update"
  ON public.user_notifications FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Members may notify other members of the SAME tenant (e.g. paging a manager);
-- automation writes via service_role / SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "notifications tenant insert" ON public.user_notifications;
CREATE POLICY "notifications tenant insert"
  ON public.user_notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = user_notifications.tenant_id
        AND tm.user_id = user_notifications.user_id
        AND tm.accepted_at IS NOT NULL
    )
  );
