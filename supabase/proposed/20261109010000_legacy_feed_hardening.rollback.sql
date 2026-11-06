-- Rollback for 20261109010000_legacy_feed_hardening.sql. PROPOSED, NOT APPLIED.
-- Safety rollback (permission hardening only). Keep every binding, receipt, connection,
-- and each tenant's existing legacy_unsigned cutover decision. NEVER globally re-enable
-- shared-secret authentication on dealers already restricted to signed requests.
-- A tenant-specific emergency fallback is a separate, time-boxed security exception
-- requiring operator approval, exact tenant/feed/provider scope and an audit trail.
-- This file does not undo signed authentication or change live feed switches.

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
