-- 1) Storage: remove the unscoped dealer_logos INSERT/write policy. The
--    per-tenant policies from 20260614033948 (dealer_logos_tenant_insert /
--    _update / _delete) remain and enforce the folder = tenant_id rule.
DROP POLICY IF EXISTS "dealer_logos_write" ON storage.objects;

-- 2) qr_codes: stop letting anonymous callers list every active QR row.
--    Scans go through the log_qr_scan RPC (SECURITY DEFINER) which resolves
--    the token internally, so no client needs a blanket SELECT.
DROP POLICY IF EXISTS "anon read active qr_codes" ON public.qr_codes;
REVOKE SELECT ON public.qr_codes FROM anon;

-- 3) Pin search_path on the one function that was missing it.
ALTER FUNCTION public.recall_payload_signature(jsonb) SET search_path = public;