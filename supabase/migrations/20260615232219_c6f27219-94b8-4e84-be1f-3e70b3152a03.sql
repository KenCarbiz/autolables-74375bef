-- 1. Lifecycle status + versioning/lock (additive; leaves existing status alone)
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN (
      'draft','compliance_passed','ready_for_signature','awaiting_customer',
      'customer_opened','partially_signed','fully_executed','archived')),
  ADD COLUMN IF NOT EXISTS version_label   text,
  ADD COLUMN IF NOT EXISTS ready_at        timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS frozen_snapshot jsonb;

-- 2. DocuSign-style event timeline
CREATE TABLE IF NOT EXISTS public.addendum_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  addendum_id   uuid NOT NULL REFERENCES public.addendums(id) ON DELETE CASCADE,
  signing_token uuid,
  event         text NOT NULL,
  channel       text,
  actor         text,
  actor_name    text,
  details       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.addendum_events TO authenticated;
GRANT ALL ON public.addendum_events TO service_role;

ALTER TABLE public.addendum_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "addendum_events_read" ON public.addendum_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.addendums a WHERE a.id = addendum_events.addendum_id));

CREATE POLICY "addendum_events_insert" ON public.addendum_events
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.addendums a WHERE a.id = addendum_events.addendum_id));

REVOKE UPDATE, DELETE, TRUNCATE ON public.addendum_events FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_addendum_events_addendum ON public.addendum_events (addendum_id, created_at);

-- 3. Anonymous customer-side events via token-keyed definer RPC
CREATE OR REPLACE FUNCTION public.record_addendum_event(
  _signing_token uuid, _event text, _channel text DEFAULT NULL, _details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.addendums WHERE signing_token = _signing_token LIMIT 1;
  IF _id IS NULL THEN RETURN; END IF;
  INSERT INTO public.addendum_events (addendum_id, signing_token, event, channel, actor, details)
  VALUES (_id, _signing_token, _event, _channel, 'customer', COALESCE(_details,'{}'::jsonb));
END; $$;

GRANT EXECUTE ON FUNCTION public.record_addendum_event(uuid,text,text,jsonb) TO anon, authenticated;

-- 4. "Ready for Signatures" RPC: snapshot + lock + version + log
CREATE OR REPLACE FUNCTION public.mark_ready_for_signature(_addendum_id uuid, _version_label text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.addendums
    SET lifecycle_status = 'ready_for_signature',
        version_label   = COALESCE(version_label, _version_label),
        ready_at        = COALESCE(ready_at, now()),
        locked_at       = COALESCE(locked_at, now()),
        frozen_snapshot = COALESCE(frozen_snapshot, jsonb_build_object(
          'products_snapshot', products_snapshot, 'vehicle_ymm', vehicle_ymm,
          'vehicle_vin', vehicle_vin, 'vehicle_price', vehicle_price, 'locked_at', now()))
  WHERE id = _addendum_id;
  INSERT INTO public.addendum_events (addendum_id, event, actor, details)
    VALUES (_addendum_id, 'ready_for_signature', 'dealer', jsonb_build_object('version', _version_label));
END; $$;

GRANT EXECUTE ON FUNCTION public.mark_ready_for_signature(uuid,text) TO authenticated;