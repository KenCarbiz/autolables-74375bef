-- Pre-launch waitlist signups from the public landing page. Anonymous
-- prospects submit (anon INSERT); only platform admins can read the list.
CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  full_name        text NOT NULL,
  email            text NOT NULL,
  phone            text,
  dealership_name  text NOT NULL,
  role             text,            -- Dealer Principal / GM / F&I / Compliance / …
  oem_brands       text,            -- franchises, e.g. "Infiniti, Nissan" or "Independent"
  rooftops         text,            -- 1 / 2-3 / 4-10 / 11+
  city             text,
  state            text,
  current_provider text,            -- current DMS / inventory / website provider
  monthly_volume   text,            -- approximate monthly new+used volume
  notes            text,
  source           text,            -- where the signup came from
  user_agent       text,
  status           text NOT NULL DEFAULT 'new'  -- ops triage: new / contacted / onboarded
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created ON public.waitlist_signups (created_at DESC);

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

-- Anyone (an anonymous prospect on the landing page) may join the waitlist.
CREATE POLICY "Anyone can join the waitlist"
  ON public.waitlist_signups FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only platform admins may read the submissions.
CREATE POLICY "Admins read waitlist signups"
  ON public.waitlist_signups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- Admins may update triage status.
CREATE POLICY "Admins update waitlist signups"
  ON public.waitlist_signups FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  );
