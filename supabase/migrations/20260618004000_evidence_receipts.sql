-- Evidence receipts: persist the audit-packet chain root at export time so a
-- per-VIN evidence file is re-verifiable later. Regenerate the packet, compare
-- the chain root to the stored receipt; a mismatch localizes the altered
-- section. Append-only; insert only via a SECURITY DEFINER RPC.

CREATE TABLE IF NOT EXISTS public.evidence_receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  vin            text NOT NULL,
  chain_root     text NOT NULL,
  manifest       jsonb NOT NULL,
  packet_version text NOT NULL DEFAULT '1',
  generated_by   uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_receipts_vin ON public.evidence_receipts (tenant_id, vin, created_at DESC);

ALTER TABLE public.evidence_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evidence_receipts_tenant_read" ON public.evidence_receipts;
CREATE POLICY "evidence_receipts_tenant_read" ON public.evidence_receipts
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())
    )
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

-- Append-only: no direct INSERT/UPDATE/DELETE for clients; writes via the RPC.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.evidence_receipts FROM authenticated, anon;
GRANT SELECT ON public.evidence_receipts TO authenticated;

CREATE OR REPLACE FUNCTION public.record_evidence_receipt(
  _vin text, _chain_root text, _manifest jsonb, _packet_version text DEFAULT '1'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid; _id uuid;
BEGIN
  -- Resolve the caller's tenant; only members (or admins) can write a receipt.
  SELECT tenant_id INTO _tenant FROM public.tenant_members
   WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
   ORDER BY accepted_at DESC LIMIT 1;
  IF _tenant IS NULL AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'no tenant for caller';
  END IF;
  INSERT INTO public.evidence_receipts (tenant_id, vin, chain_root, manifest, packet_version, generated_by)
  VALUES (_tenant, upper(trim(_vin)), _chain_root, _manifest, COALESCE(_packet_version, '1'), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_evidence_receipt(text, text, jsonb, text) TO authenticated;
