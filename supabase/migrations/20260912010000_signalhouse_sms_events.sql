-- ── Signal House webhook events, recorded once ────────────────────────────
--
-- Signal House posts inbound messages and delivery receipts to a single
-- endpoint as { timestamp, event, identifier, metaData }. Two properties of
-- that delivery decide the shape of this table:
--
--   1. Payloads are NOT SIGNED. There is no HMAC, no signature header and no
--      request timestamp, so a row here proves only that somebody who knew the
--      URL posted it. Nothing irreversible or financial may key off a row in
--      this table alone; it records that something is claimed to have changed,
--      and the authoritative state is read back from the API.
--
--   2. Delivery is a direct POST with a 3-second timeout, retried 3 times
--      500ms apart, and carries NO delivery id to dedupe on. A receiver that
--      is slow (not wrong — merely slow) is sent the same event up to three
--      times. Idempotency therefore has to come from the event's own
--      identifiers, which is what the unique index below is for.
--
-- There is no INSERT/UPDATE policy: the webhook writes with the service role,
-- and no dealer-facing path may forge a carrier receipt for another tenant.

CREATE TABLE IF NOT EXISTS public.sms_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,

  provider text NOT NULL DEFAULT 'signalhouse',
  event text NOT NULL,

  -- Whatever the event is about: a message id for a delivery receipt, a
  -- campaign or brand id for a registration outcome.
  identifier text,

  direction text,
  from_number text,
  to_number text,
  message_body text,

  -- The provider's own timestamp, not our receive time. Retries of one event
  -- repeat it, which is what makes the dedupe index below work.
  occurred_at timestamptz,

  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- COALESCE rather than a plain unique index: NULLs are distinct in Postgres,
-- so an event with no identifier would otherwise dedupe against nothing and
-- land three times per retried delivery.
CREATE UNIQUE INDEX IF NOT EXISTS sms_events_dedupe_idx
  ON public.sms_events (
    provider,
    event,
    COALESCE(identifier, ''),
    COALESCE(occurred_at, 'epoch'::timestamptz)
  );

CREATE INDEX IF NOT EXISTS sms_events_tenant_created_idx
  ON public.sms_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sms_events_identifier_idx
  ON public.sms_events (identifier);

ALTER TABLE public.sms_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_events_select_own_tenant"
  ON public.sms_events FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
