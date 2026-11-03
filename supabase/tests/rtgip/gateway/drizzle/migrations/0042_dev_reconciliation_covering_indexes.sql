-- Phase 4B: measured reconciliation plans scan 68105 acknowledgement rows and 68105 inbox rows.
-- Add narrow metadata-only supporting indexes; do not change reconciliation predicates,
-- permissions, engine functions, historical data, delivery gates or timeout settings.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.gw_settings WHERE id=1 AND environment='DEV' AND external_delivery_enabled=false)
 THEN RAISE EXCEPTION 'Gateway DEV isolation required'; END IF;
END $$;
CREATE INDEX IF NOT EXISTS gw_inbox_tenant_event_target_idx ON public.gw_inbox (tenant_id,event_id,target_app);
CREATE INDEX IF NOT EXISTS gw_queue_event_target_ack_idx ON public.gw_queue (event_id,target_app) WHERE status IN ('delivered','duplicate','stale','pending','retry','leased','held');
COMMENT ON INDEX public.gw_inbox_tenant_event_target_idx IS 'DEV Phase 4B: tenant-scoped inbox reconciliation, metadata only, no semantic change';
COMMENT ON INDEX public.gw_queue_event_target_ack_idx IS 'DEV Phase 4B: exact existing ACK predicate coverage; no status tolerance change';