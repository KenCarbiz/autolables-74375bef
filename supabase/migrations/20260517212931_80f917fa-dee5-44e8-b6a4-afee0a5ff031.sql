CREATE OR REPLACE FUNCTION public.find_abandoned_signings(
  _min_hours_since_open  INTEGER DEFAULT 24,
  _min_hours_since_retry INTEGER DEFAULT 72,
  _limit                 INTEGER DEFAULT 100
) RETURNS TABLE (
  addendum_id   UUID,
  signing_token UUID,
  tenant_id     UUID,
  store_id      UUID,
  vehicle_ymm   TEXT,
  vehicle_vin   TEXT,
  dealer_name   TEXT,
  customer_email TEXT,
  opened_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH opens AS (
    SELECT entity_id::uuid AS addendum_id, min(created_at) AS opened_at
    FROM public.audit_log
    WHERE action = 'signing_link_opened'
      AND created_at < now() - make_interval(hours => _min_hours_since_open)
      AND created_at > now() - INTERVAL '14 days'
    GROUP BY entity_id
  ),
  signed AS (
    SELECT DISTINCT entity_id::uuid AS addendum_id
    FROM public.audit_log
    WHERE action = 'addendum_signed'
      AND created_at > now() - INTERVAL '14 days'
  ),
  reengaged AS (
    SELECT entity_id::uuid AS addendum_id, max(created_at) AS last_retry
    FROM public.audit_log
    WHERE action = 'signing_link_reengaged'
    GROUP BY entity_id
  )
  SELECT
    a.id AS addendum_id,
    a.signing_token,
    a.tenant_id,
    NULL::uuid AS store_id,
    a.vehicle_ymm,
    a.vehicle_vin,
    a.dealer_snapshot ->> 'name' AS dealer_name,
    COALESCE(
      (SELECT s.signer_email FROM public.addendum_signings s
        WHERE s.addendum_id = a.id AND s.signer_type = 'customer'
        ORDER BY s.signed_at DESC NULLS LAST LIMIT 1),
      (SELECT l.email FROM public.leads l
        WHERE l.vehicle_vin = a.vehicle_vin AND l.tenant_id = a.tenant_id AND l.email <> ''
        ORDER BY l.captured_at DESC LIMIT 1),
      a.customer_email
    ) AS customer_email,
    o.opened_at
  FROM public.addendums a
  JOIN opens o ON o.addendum_id = a.id
  LEFT JOIN signed s ON s.addendum_id = a.id
  LEFT JOIN reengaged r ON r.addendum_id = a.id
  WHERE s.addendum_id IS NULL
    AND (r.last_retry IS NULL OR r.last_retry < now() - make_interval(hours => _min_hours_since_retry))
    AND a.signing_token IS NOT NULL
    AND a.status <> 'signed'
  ORDER BY o.opened_at ASC
  LIMIT GREATEST(_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.find_abandoned_signings(INTEGER, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.record_signing_reengagement(
  _addendum_id UUID,
  _channel     TEXT DEFAULT 'email',
  _details     JSONB DEFAULT '{}'::JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _store_id TEXT;
  _tenant_id UUID;
BEGIN
  SELECT store_id, tenant_id INTO _store_id, _tenant_id
    FROM public.addendums WHERE id = _addendum_id LIMIT 1;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES (
    'signing_link_reengaged',
    'addendum',
    _addendum_id::text,
    COALESCE(_store_id, _tenant_id::text),
    coalesce(_details, '{}'::JSONB) || jsonb_build_object('channel', _channel)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_signing_reengagement(UUID, TEXT, JSONB) TO service_role;