DO $$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb)'::regprocedure);
 def:=replace(def,'sec text; domain text; value jsonb;','sec text; v_domain text; v_value jsonb;');
 def:=replace(def,'domain:=','v_domain:=');def:=replace(def,'a.domain=domain','a.domain=v_domain');
 def:=replace(def,'value:=','v_value:=');def:=replace(def,'value->','v_value->');def:=replace(def,'value ?','v_value ?');
 def:=replace(def,'jsonb_each(value)','jsonb_each(v_value)');def:=replace(def,'coalesce(value,','coalesce(v_value,');
 -- qualified alias columns m.value/x.value must not be rewritten.
 def:=replace(def,'m.v_value','m.value');def:=replace(def,'x.v_value','x.value');
 EXECUTE def;
END $$;