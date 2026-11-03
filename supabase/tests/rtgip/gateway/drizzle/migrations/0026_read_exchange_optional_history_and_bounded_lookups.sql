DO $$ DECLARE def text; BEGIN
 def:=pg_get_functiondef('public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb)'::regprocedure);
 def:=replace(def,'THEN p.state ? ''listing_history''','THEN p.state ? ''listing''');
 -- Deduplicate identical lookups within an authenticated batch but charge every logical lookup to budget.
 def:=replace(def,'FOR lookup IN SELECT * FROM jsonb_array_elements(_lookups) LOOP','FOR lookup IN SELECT DISTINCT value FROM jsonb_array_elements(_lookups) LOOP');
 EXECUTE def;
END $$;