-- DEV-only durable forensic reports; no changes to reconciliation or engine semantics.
CREATE TABLE public.gw_recovery_forensic_reports (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.gw_tenants(id),
  source_sha text NOT NULL,
  report jsonb NOT NULL,
  report_sha256 text NOT NULL,
  synthetic boolean NOT NULL DEFAULT true CHECK (synthetic = true),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.gw_recovery_forensic_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gw_recovery_forensic_reports TO authenticated;
GRANT SELECT, INSERT ON public.gw_recovery_forensic_reports TO service_role;
ALTER TABLE public.gw_recovery_forensic_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant admins read forensic reports" ON public.gw_recovery_forensic_reports FOR SELECT TO authenticated
  USING (public.gw_has_role(tenant_id, ARRAY['admin']::public.gw_role[]));
CREATE TRIGGER gw_recovery_reports_immutable BEFORE UPDATE OR DELETE ON public.gw_recovery_forensic_reports
  FOR EACH ROW EXECUTE FUNCTION public.gw_forbid_mutation();

-- SECURITY INVOKER: diagnostic SELECT only, no mutation, no browser EXECUTE grant.
CREATE FUNCTION public.gw_recovery_snapshot(_tenant text, _aggregates text[]) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public AS $$
WITH heads AS (
  SELECT DISTINCT ON (q.target_app, o.source_app, o.aggregate_type, o.aggregate_id)
    q.id queue_id, q.route_id, q.target_app, o.source_app, o.aggregate_type, o.aggregate_id,
    o.aggregate_revision expected_revision, o.event_id, o.payload_hash
  FROM gw_queue q JOIN gw_outbox o ON o.event_id = q.event_id
  WHERE q.tenant_id = _tenant AND o.tenant_id = _tenant AND q.status = 'delivered' AND o.aggregate_id = ANY(_aggregates)
  ORDER BY q.target_app, o.source_app, o.aggregate_type, o.aggregate_id, o.aggregate_revision DESC, o.event_id
), groups AS (
  SELECT h.*, p.tenant_id IS NOT NULL projection_exists,
    coalesce((p.source_revisions->>(h.source_app::text || ':' || h.aggregate_type))::bigint, 0) actual_revision,
    i.result inbox_result, i.applied_at inbox_applied_at, q.delivered_at ack_at,
    s.revision source_accepted_revision,
    EXISTS (SELECT 1 FROM gw_evidence e WHERE e.event_id = h.event_id AND e.tenant_id = _tenant
      AND e.target_app = h.target_app AND e.payload_hash = h.payload_hash AND e.kind IN ('applied','applied_sold_guard')) applied_evidence_exists
  FROM heads h JOIN gw_queue q ON q.id = h.queue_id
  LEFT JOIN gw_projections p ON p.tenant_id = _tenant AND p.target_app = h.target_app
    AND p.aggregate_type = h.aggregate_type AND p.aggregate_id = h.aggregate_id
  LEFT JOIN gw_inbox i ON i.tenant_id = _tenant AND i.target_app = h.target_app AND i.event_id = h.event_id
  LEFT JOIN gw_source_revisions s ON s.tenant_id = _tenant AND s.source_app = h.source_app
    AND s.aggregate_type = h.aggregate_type AND s.aggregate_id = h.aggregate_id
), events AS (SELECT * FROM gw_outbox WHERE tenant_id = _tenant AND aggregate_id = ANY(_aggregates)),
copies AS (SELECT q.* FROM gw_queue q JOIN events e ON e.event_id = q.event_id WHERE q.tenant_id = _tenant)
SELECT jsonb_build_object(
  'captured_at', clock_timestamp(), 'transaction_id', txid_current(), 'tenant_id', _tenant,
  'groups', coalesce((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object('invariant_failed', g.actual_revision < g.expected_revision)
    ORDER BY g.aggregate_id, g.route_id) FROM groups g), '[]'::jsonb),
  'projection_behind_delivered', (SELECT count(*) FROM groups WHERE actual_revision < expected_revision),
  'source_events', (SELECT count(*) FROM events), 'route_copies', (SELECT count(*) FROM copies),
  'missing_fanout', (SELECT count(*) FROM events o JOIN gw_routes r ON r.source_app = o.source_app AND o.event_type = ANY(r.event_types)
    WHERE NOT EXISTS (SELECT 1 FROM copies q WHERE q.event_id = o.event_id AND q.route_id = r.id)),
  'terminal_without_inbox', (SELECT count(*) FROM copies q WHERE q.status IN ('delivered','duplicate','stale')
    AND NOT EXISTS (SELECT 1 FROM gw_inbox i WHERE i.tenant_id = _tenant AND i.target_app = q.target_app AND i.event_id = q.event_id)),
  'originals', jsonb_build_object(
    'outbox', coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.seq) FROM events o), '[]'::jsonb),
    'queue', coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM copies q), '[]'::jsonb),
    'inbox', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.target_app, i.event_id) FROM gw_inbox i
      WHERE i.tenant_id = _tenant AND i.event_id IN (SELECT event_id FROM events)), '[]'::jsonb),
    'evidence', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM gw_evidence e
      WHERE e.tenant_id = _tenant AND e.event_id IN (SELECT event_id FROM events)), '[]'::jsonb),
    'projections', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.aggregate_id, p.target_app) FROM gw_projections p
      WHERE p.tenant_id = _tenant AND p.aggregate_id = ANY(_aggregates)), '[]'::jsonb),
    'source_revisions', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.aggregate_id, s.source_app) FROM gw_source_revisions s
      WHERE s.tenant_id = _tenant AND s.aggregate_id = ANY(_aggregates)), '[]'::jsonb)
  )
) $$;
REVOKE ALL ON FUNCTION public.gw_recovery_snapshot(text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gw_recovery_snapshot(text,text[]) TO service_role;