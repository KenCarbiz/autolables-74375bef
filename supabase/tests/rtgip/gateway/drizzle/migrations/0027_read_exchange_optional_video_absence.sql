DO $$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb)'::regprocedure);
 def:=replace(def,'IF NOT FOUND THEN facts:=facts||jsonb_build_object(sec,jsonb_build_object(''unavailable'',''no validated owned facts''));stale:=true;CONTINUE;END IF;',
 'IF NOT FOUND THEN IF sec=''video'' AND NOT EXISTS(SELECT 1 FROM gw_outbox o WHERE o.tenant_id=_tenant AND o.source_app=_source AND o.aggregate_id=inst.id AND o.event_type=''video.engagement'') THEN facts:=facts||jsonb_build_object(sec,''{}''::jsonb); ELSE facts:=facts||jsonb_build_object(sec,jsonb_build_object(''unavailable'',''no validated owned facts''));stale:=true; END IF;CONTINUE;END IF;');
 EXECUTE def;
END $$;