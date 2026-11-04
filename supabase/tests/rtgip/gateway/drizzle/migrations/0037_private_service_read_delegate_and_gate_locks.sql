-- Keep service staging private/off. Repair delegates before any runtime wiring.
DO $$ DECLARE def text;BEGIN
 def:=pg_get_functiondef('public.gw_service_execute(text,text,text,timestamptz,text,text,inet)'::regprocedure);
 def:=replace(def,'FROM gw_settings WHERE id=1;','FROM gw_settings WHERE id=1 FOR SHARE;');
 def:=replace(def,'FROM gw_service_stage_gates WHERE id=1;','FROM gw_service_stage_gates WHERE id=1 FOR SHARE;');
 def:=replace(def,'rooftop_ids,key_fingerprint,not_before','rooftop_ids,key_fingerprint,not_before');
 def:=replace(def,'ON CONFLICT(key_id,source_app,purpose)','ON CONFLICT(key_id,source_app)');
 EXECUTE def;
 def:=pg_get_functiondef('public.gw_service_provision(uuid,text,public.gw_app,text,text[],inet[],text,text,text,text[],public.gw_app[],public.gw_app[],text[],timestamptz,timestamptz,integer)'::regprocedure);
 def:=replace(def,'IF cardinality(_rooftops) NOT BETWEEN','IF _rooftops IS NULL OR _network IS NULL OR _events IS NULL OR _targets IS NULL OR _owners IS NULL OR _purposes IS NULL OR array_position(_rooftops,NULL) IS NOT NULL OR array_position(_network,NULL) IS NOT NULL OR array_position(_events,NULL) IS NOT NULL OR array_position(_targets,NULL) IS NOT NULL OR array_position(_owners,NULL) IS NOT NULL OR array_position(_purposes,NULL) IS NOT NULL OR cardinality(_rooftops) NOT BETWEEN');
 EXECUTE def;
END $$;