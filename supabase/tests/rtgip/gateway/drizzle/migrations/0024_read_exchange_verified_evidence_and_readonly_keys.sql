-- Separate read-only app identities from ingress authorization; preserve existing key behavior.
ALTER TABLE public.gw_ingest_keys ADD COLUMN key_usage text NOT NULL DEFAULT 'push_read' CHECK(key_usage IN('push_read','read_only'));
-- Backfill additive column, synthetic identities only.
UPDATE public.gw_ingest_keys SET key_usage='read_only' WHERE key_id LIKE '%-x1';
DO $$ DECLARE def text; old text := 'elsif (_env->>''source_app'') is distinct from k.source_app::text then'; BEGIN
 def:=pg_get_functiondef('public.gw_dev_ingest(text,text,timestamptz,text,jsonb)'::regprocedure);
 IF position(old IN def)=0 THEN RAISE EXCEPTION 'ingress patch anchor not found'; END IF;
 def:=replace(def,old,'elsif k.key_usage = ''read_only'' then v_dec := ''denied''; v_reason := ''read-only identity cannot ingest''; v_status := 403; '||old);
 EXECUTE def;
END $$;

-- Service evidence shaping matches the signed AutoFilm adapter: refs are merged into projection by apply.
CREATE FUNCTION public.gw_exchange_service(_state jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $$
WITH candidates AS (
 SELECT _state->'mpi' value,'mpi' kind
 UNION ALL SELECT value,'repair' FROM jsonb_each(coalesce(_state->'repair','{}'))
), verified AS (
 SELECT value,kind FROM candidates WHERE value->'technician_verified'='true'::jsonb
  AND coalesce(value->>'service_visit_ref','')<>''
  AND (coalesce(value->>'evidence_ref','')<>'' OR (jsonb_typeof(value->'evidence_refs')='array' AND jsonb_array_length(value->'evidence_refs')>0))
  AND ((kind='mpi' AND value->>'source'='autofilm' AND value->>'reviewer_role' IN('service_manager','shop_foreman','quality_reviewer') AND coalesce(value->>'reviewer_approved_at','')<>'')
   OR (kind='repair' AND coalesce(value->>'completed_at','')<>''))
), shaped AS (
 SELECT kind,(SELECT jsonb_object_agg(x.key,x.value) FROM jsonb_each(v.value)x JOIN gw_source_authority a
  ON a.domain='service' AND a.field=x.key AND a.owner_app='autofilm' AND a.shareable AND a.classification='internal') fact
 FROM verified v
)
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shaped) THEN '{"unavailable":"independent verified service evidence required"}'::jsonb
 ELSE jsonb_strip_nulls(jsonb_build_object('mpi',(SELECT fact FROM shaped WHERE kind='mpi' LIMIT 1),'repairs',(SELECT coalesce(jsonb_agg(fact),'[]') FROM shaped WHERE kind='repair'))) END $$;
REVOKE ALL ON FUNCTION public.gw_exchange_service(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_exchange_service(jsonb) TO service_role;
DO $$ DECLARE def text; a integer; b integer; BEGIN
 def:=pg_get_functiondef('public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb)'::regprocedure);
 a:=position('ELSIF sec=''service'' THEN' IN def); b:=position('ELSIF sec=''acquisition'' THEN' IN def);
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'service patch anchors missing';END IF;
 def:=substr(def,1,a-1)||'ELSIF sec=''service'' THEN safe:=gw_exchange_service(chosen.state); IF safe ? ''unavailable'' THEN stale:=true; END IF;
     '||substr(def,b);
 -- Use actual canonical evidence, not guessed appraisal_completed/acquired fields.
 def:=replace(def,'safe:=jsonb_build_object(''appraisal_completed'',coalesce((value->>''appraisal_completed'')::boolean,false),''acquired'',coalesce((value->>''acquired'')::boolean,false),''rev'',value->''rev'');',
 'safe:=jsonb_build_object(''appraisal_completed'',EXISTS(SELECT 1 FROM gw_outbox o WHERE o.tenant_id=_tenant AND o.source_app=''autocurb'' AND o.aggregate_id=inst.id AND o.event_type=''appraisal.completed'' AND EXISTS(SELECT 1 FROM gw_queue q WHERE q.event_id=o.event_id AND q.status=''delivered'')),''acquired'',EXISTS(SELECT 1 FROM gw_outbox o WHERE o.tenant_id=_tenant AND o.source_app=''autocurb'' AND o.aggregate_id=inst.id AND o.event_type=''acquisition.closed'' AND EXISTS(SELECT 1 FROM gw_queue q WHERE q.event_id=o.event_id AND q.status=''delivered'')),''rev'',value->''rev'');');
 EXECUTE def;
END $$;