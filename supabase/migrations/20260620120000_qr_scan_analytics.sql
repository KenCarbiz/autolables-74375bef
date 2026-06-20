-- QR scan analytics. A stable QR code per vehicle + sticker type points at the
-- /q/:token redirect, which logs a scan event and forwards to the Vehicle
-- Passport. Privacy-preserving: we store device category / browser / referrer /
-- user agent only — no raw IP (the browser can't see it and we don't want it).
-- Tenant-scoped via the canonical RLS pattern; public scan logging goes through
-- a SECURITY DEFINER RPC, not broad anon insert.

CREATE TABLE IF NOT EXISTS public.qr_codes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  vehicle_id            uuid NOT NULL,
  generated_document_id uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  sticker_type          text NOT NULL DEFAULT 'window' CHECK (sticker_type IN ('window','addendum','passport')),
  destination_url       text NOT NULL,
  token                 text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  scan_count            integer NOT NULL DEFAULT 0,
  last_scanned_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vehicle_id, sticker_type)
);
CREATE INDEX IF NOT EXISTS idx_qr_codes_vehicle ON public.qr_codes (vehicle_id);

CREATE TABLE IF NOT EXISTS public.qr_scan_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  qr_code_id   uuid NOT NULL REFERENCES public.qr_codes(id) ON DELETE CASCADE,
  vehicle_id   uuid,
  sticker_type text,
  device_type  text,          -- mobile / tablet / desktop
  browser      text,
  referrer     text,
  user_agent   text,
  country      text,          -- coarse, optional (left null here)
  scanned_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qr_scan_events_tenant ON public.qr_scan_events (tenant_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_scan_events_vehicle ON public.qr_scan_events (vehicle_id, scanned_at DESC);

DROP TRIGGER IF EXISTS trg_qr_codes_updated ON public.qr_codes;
CREATE TRIGGER trg_qr_codes_updated BEFORE UPDATE ON public.qr_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS — dealers manage/read their own; scan events are read-only to the tenant
-- (writes happen through the SECURITY DEFINER RPC below).
ALTER TABLE public.qr_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_scan_events  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant qr_codes" ON public.qr_codes FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "tenant read qr_scan_events" ON public.qr_scan_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- Public scan logger: resolves the token, records the event, bumps counters,
-- and returns the destination URL for the redirect. anon-executable.
CREATE OR REPLACE FUNCTION public.log_qr_scan(
  _token text, _device text DEFAULT NULL, _browser text DEFAULT NULL,
  _referrer text DEFAULT NULL, _ua text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  qr public.qr_codes%ROWTYPE;
BEGIN
  SELECT * INTO qr FROM public.qr_codes WHERE token = _token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.qr_scan_events (tenant_id, qr_code_id, vehicle_id, sticker_type, device_type, browser, referrer, user_agent)
  VALUES (qr.tenant_id, qr.id, qr.vehicle_id, qr.sticker_type, _device, _browser, _referrer, _ua);

  UPDATE public.qr_codes SET scan_count = scan_count + 1, last_scanned_at = now() WHERE id = qr.id;
  RETURN qr.destination_url;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_qr_scan(text, text, text, text, text) TO anon, authenticated;
