-- Gateway DEV only. Do not mutate immutable envelopes, existing projections, receipts or reconciliation.
CREATE FUNCTION public.gw_appraisal_read_facts(_tenant text,_instance text,_episode text,_target public.gw_app) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
SELECT coalesce((SELECT jsonb_build_object('appraisal_completed',true,'audit_ref',o.event_id::text,'completed_at',o.occurred_at) FROM gw_outbox o JOIN gw_queue q ON q.event_id=o.event_id AND q.target_app=_target AND q.status IN('delivered','duplicate') JOIN gw_inbox i ON i.event_id=o.event_id AND i.target_app=q.target_app AND i.tenant_id=o.tenant_id AND i.result='applied' WHERE o.tenant_id=_tenant AND o.source_app='autocurb' AND o.event_type='appraisal.completed' AND o.aggregate_type='vehicle_instance' AND o.aggregate_id=_instance AND o.instance_id=_instance AND o.episode_id=_episode ORDER BY o.aggregate_revision DESC LIMIT 1),'{"appraisal_completed":false}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.gw_appraisal_read_facts(text,text,text,public.gw_app) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.gw_appraisal_read_facts(text,text,text,public.gw_app) TO service_role;
DO $$ DECLARE def text;old text; a int;b int;BEGIN
 def:=pg_get_functiondef('public.gw_read_fetch(text,text,timestamptz,text,text,text,text,integer,text,uuid)'::regprocedure);
 old:='(r.state->''appraisal'') - ''appraisal_cents''';IF position(old IN def)=0 THEN RAISE EXCEPTION 'appraisal read anchor missing';END IF;
 def:=replace(def,old,'gw_appraisal_read_facts(_tenant,r.inst,r.cur_epi,k.source_app)');EXECUTE def;
 def:=pg_get_functiondef('public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb)'::regprocedure);
 a:=position('ELSIF sec=''acquisition'' THEN' IN def);b:=position('ELSE
      IF v_value->>''source''=_source::text' IN def);IF a=0 OR b<=a THEN RAISE EXCEPTION 'exchange acquisition anchors missing';END IF;
 def:=substr(def,1,a-1)||'ELSIF sec=''acquisition'' THEN safe:=gw_appraisal_read_facts(_tenant,inst.id,cur_epi,chosen.target_app); '||substr(def,b);EXECUTE def;
END $$;
-- Close table-wide and separately granted raw-column reads. Preserve metadata-only tenant RLS.
REVOKE SELECT ON public.gw_outbox,public.gw_projections,public.gw_recovery_forensic_reports FROM PUBLIC,anon,authenticated;
REVOKE SELECT(envelope) ON public.gw_outbox FROM PUBLIC,anon,authenticated;
REVOKE SELECT(state) ON public.gw_projections FROM PUBLIC,anon,authenticated;
REVOKE SELECT(report) ON public.gw_recovery_forensic_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT(seq,event_id,tenant_id,rooftop_id,source_app,event_type,schema_version,aggregate_type,aggregate_id,aggregate_revision,vin,instance_id,episode_id,correlation_id,causation_id,trace_id,classification,payload_hash,bench_run_id,occurred_at,emitted_at,accepted_at) ON public.gw_outbox TO authenticated;
GRANT SELECT(tenant_id,target_app,aggregate_type,aggregate_id,vin,source_revisions,apply_count,updated_at) ON public.gw_projections TO authenticated;
GRANT SELECT(id,tenant_id,source_sha,report_sha256,synthetic,created_at) ON public.gw_recovery_forensic_reports TO authenticated;
-- Explicit-purpose admin audit only; no raw-returning DEV HTTP endpoint or automatic browser query.
CREATE FUNCTION public.gw_privileged_audit(_tenant text,_resource text,_id text,_purpose text,_case_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;allowed boolean;BEGIN
 allowed:=coalesce(gw_has_role(_tenant,ARRAY['admin']::gw_role[]),false) AND _purpose IN('source_authority_audit','recovery_forensics') AND _resource IN('outbox','projection','forensic_report') AND _case_ref ~ '^[A-Za-z0-9._:-]{1,128}$' AND length(_id) BETWEEN 1 AND 256;
 IF allowed IS DISTINCT FROM true THEN RETURN jsonb_build_object('decision','denied','http_status',403);END IF;
 IF _resource='outbox' THEN SELECT envelope INTO result FROM gw_outbox WHERE tenant_id=_tenant AND event_id::text=_id;
 ELSIF _resource='projection' THEN SELECT state INTO result FROM gw_projections WHERE tenant_id=_tenant AND target_app::text||':'||aggregate_type||':'||aggregate_id=_id;
 ELSE SELECT report INTO result FROM gw_recovery_forensic_reports WHERE tenant_id=_tenant AND id::text=_id;END IF;
 INSERT INTO gw_audit_log(tenant_id,actor,action,detail)VALUES(_tenant,auth.uid(),'privileged_raw_audit',jsonb_build_object('resource',_resource,'resource_id',_id,'purpose',_purpose,'case_ref',_case_ref,'found',result IS NOT NULL));
 IF result IS NULL THEN RETURN jsonb_build_object('decision','not_found','http_status',404);END IF;
 RETURN jsonb_build_object('decision','ok','http_status',200,'resource',_resource,'data',result);
END $$;
REVOKE ALL ON FUNCTION public.gw_privileged_audit(text,text,text,text,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.gw_privileged_audit(text,text,text,text,text) TO authenticated;
COMMENT ON FUNCTION public.gw_privileged_audit(text,text,text,text,text) IS 'Explicit-purpose tenant admin raw audit only; never ordinary app read, never auto-fetch, never log returned data.';