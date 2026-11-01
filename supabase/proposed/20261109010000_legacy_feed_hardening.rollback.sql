-- Rollback for 20261109010000_legacy_feed_hardening.sql. PROPOSED, NOT APPLIED.
-- Keeps every row (bindings, receipts, and the widened connections.app check). Re-opens the
-- legacy shared-secret format for every tenant and removes client entry points. Nothing is dropped.

UPDATE public.legacy_feed_bindings SET legacy_unsigned = 'allowed' WHERE legacy_unsigned <> 'allowed';

REVOKE ALL ON public.legacy_feed_bindings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.legacy_feed_receipts FROM PUBLIC, anon, authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.legacy_feed_claim_request(uuid, text, text, text)',
    'public.legacy_feed_complete_request(uuid, text, jsonb)',
    'public.legacy_feed_legacy_allowed(uuid, text, text)',
    'public.legacy_feed_hold_archived(uuid, text, uuid, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
