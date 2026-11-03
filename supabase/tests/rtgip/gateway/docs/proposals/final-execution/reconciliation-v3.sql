-- PROPOSED ONLY: no journal entry, no hosted application. v2 remains untouched.
-- One statement snapshot; seven predicates and overlap accounting retained exactly.
CREATE FUNCTION public.gw_reconcile_v3(_tenant text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE report jsonb; total bigint;
BEGIN
 IF NOT gw_is_member(_tenant) THEN RAISE EXCEPTION 'forbidden'; END IF;
 WITH
 o AS MATERIALIZED(SELECT * FROM gw_outbox WHERE tenant_id=_tenant),
 q AS MATERIALIZED(SELECT * FROM gw_queue WHERE tenant_id=_tenant),
 i AS MATERIALIZED(SELECT * FROM gw_inbox WHERE tenant_id=_tenant),
 missing AS MATERIALIZED(SELECT o.event_id,r.id route_id FROM o JOIN gw_routes r ON r.source_app=o.source_app AND o.event_type=ANY(r.event_types)
 WHERE NOT EXISTS(SELECT 1 FROM gw_queue x WHERE x.event_id=o.event_id AND x.route_id=r.id)),
 heads AS MATERIALIZED(SELECT DISTINCT ON(q.target_app,x.source_app,x.aggregate_type,x.aggregate_id)
 q.target_app,x.source_app,x.aggregate_type,x.aggregate_id,x.aggregate_revision mx,x.event_id,q.route_id
 FROM q JOIN gw_outbox x ON x.event_id=q.event_id WHERE q.status='delivered'
 ORDER BY q.target_app,x.source_app,x.aggregate_type,x.aggregate_id,x.aggregate_revision DESC),
 behind AS MATERIALIZED(SELECT h.*,coalesce((p.source_revisions->>(h.source_app::text||':'||h.aggregate_type))::bigint,0) pr,p.tenant_id IS NOT NULL has_proj
 FROM heads h LEFT JOIN gw_projections p ON p.tenant_id=_tenant AND p.target_app=h.target_app AND p.aggregate_type=h.aggregate_type AND p.aggregate_id=h.aggregate_id
 WHERE coalesce((p.source_revisions->>(h.source_app::text||':'||h.aggregate_type))::bigint,0)<h.mx),
 qc AS(SELECT count(*) copies,
 count(*) FILTER(WHERE status='delivered' AND NOT EXISTS(SELECT 1 FROM gw_inbox x WHERE x.target_app=q.target_app AND x.event_id=q.event_id)) no_inbox,
 count(*) FILTER(WHERE status IN('delivered','duplicate','stale') AND NOT EXISTS(SELECT 1 FROM gw_inbox x WHERE x.target_app=q.target_app AND x.event_id=q.event_id)) terminal_no_inbox,
 count(*) FILTER(WHERE status='dead' AND NOT EXISTS(SELECT 1 FROM gw_dead_letters d WHERE d.queue_id=q.id)) dead_no_dlq,
 count(*) FILTER(WHERE (status='leased' AND lease_until<now()) OR(status IN('pending','retry') AND accepted_at<now()-interval '15 minutes')) stuck,
 count(*) FILTER(WHERE status='delivered' AND delivered_at-accepted_at>interval '60 seconds') late FROM q),
 ic AS(SELECT count(*) no_ack FROM i WHERE NOT EXISTS(SELECT 1 FROM gw_queue x WHERE x.event_id=i.event_id AND x.target_app=i.target_app AND x.status IN('delivered','duplicate','stale','pending','retry','leased','held'))),
 routes AS(SELECT route_id,jsonb_build_object('copies',count(*),'delivered',count(*) FILTER(WHERE status='delivered'),
 'duplicate',count(*) FILTER(WHERE status='duplicate'),'stale',count(*) FILTER(WHERE status='stale'),'dead',count(*) FILTER(WHERE status='dead'),
 'in_flight',count(*) FILTER(WHERE status IN('pending','retry','leased','held')),'late_delivered',count(*) FILTER(WHERE status='delivered' AND delivered_at-accepted_at>interval '60 seconds')) j FROM q GROUP BY route_id),
 dlq AS(SELECT jsonb_build_object('poison',count(*) FILTER(WHERE reason LIKE 'POISON:%'),'invariant',count(*) FILTER(WHERE reason LIKE 'INVARIANT:%'),
 'other',count(*) FILTER(WHERE reason NOT LIKE 'POISON:%' AND reason NOT LIKE 'INVARIANT:%'),'unresolved',count(*) FILTER(WHERE resolved_at IS NULL)) j FROM gw_dead_letters WHERE tenant_id=_tenant),
 counts AS(SELECT (SELECT count(*) FROM missing) missing,(SELECT count(*) FROM behind) lag,(SELECT count(*) FROM o) sources,qc.*,ic.no_ack FROM qc CROSS JOIN ic)
 SELECT jsonb_build_object('version',3,'missing_fanout',missing,'delivered_without_inbox',no_inbox,'terminal_without_inbox',terminal_no_inbox,
 'inbox_without_ack',no_ack,'dead_without_dead_letter',dead_no_dlq,'projection_behind_delivered',lag,'stuck_messages',stuck,
 'never_lose_ok',missing+stuck+terminal_no_inbox+no_ack+dead_no_dlq=0,'checked',sources,'source_events',sources,'route_copies',copies,
 'late_deliveries',late,'late_threshold_s',60,'routes',coalesce((SELECT jsonb_object_agg(route_id,j) FROM routes),'{}'),
 'copies_by_status',coalesce((SELECT jsonb_object_agg(status,n) FROM(SELECT status,count(*) n FROM q GROUP BY status)s),'{}'),
 'dlq',(SELECT j FROM dlq),'missing_fanout_keys',coalesce((SELECT jsonb_agg(x) FROM(SELECT * FROM missing ORDER BY event_id,route_id LIMIT 50)x),'[]'),
 'projection_behind_keys',coalesce((SELECT jsonb_agg(x) FROM(SELECT route_id,target_app,source_app,aggregate_type,aggregate_id,mx max_delivered_revision,event_id head_event_id,pr projection_revision,has_proj projection_exists FROM behind ORDER BY aggregate_id,route_id LIMIT 50)x),'[]'),
 'samples_truncated',missing>50 OR lag>50,'snapshot_at',statement_timestamp(),'historical_original_ids_verified',false),
 missing+no_inbox+lag+stuck+(terminal_no_inbox-no_inbox)+no_ack+dead_no_dlq INTO report,total FROM counts;
 INSERT INTO gw_reconciliation_runs(tenant_id,actor,checked,mismatches,details)VALUES(_tenant,auth.uid(),(report->>'checked')::int,total,report);
 RETURN report;
END $$;
REVOKE ALL ON FUNCTION public.gw_reconcile_v3(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gw_reconcile_v3(text) TO authenticated;