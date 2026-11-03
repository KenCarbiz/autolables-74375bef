-- Private boundary follow-up, no keys or gate activation.
ALTER TABLE public.gw_service_receipts ADD COLUMN units integer NOT NULL DEFAULT 1 CHECK(units BETWEEN 1 AND 50);
DO $$ DECLARE def text;BEGIN
 def:=pg_get_functiondef('public.gw_service_execute(text,text,text,timestamptz,text,text,inet)'::regprocedure);
 def:=replace(def,'ELSIF octet_length(_raw)>16384','ELSIF _raw IS NULL OR octet_length(_raw)>16384');
 def:=replace(def,'b->''vehicle''->>''vin'' NOT LIKE ''DEVSYN%''','coalesce(b->''vehicle''->>''vin'','''') NOT LIKE ''DEVSYN%''');
 def:=replace(def,'(SELECT count(*) FROM gw_service_receipts WHERE key_id=_key AND created_at>clock_timestamp()-interval ''1 minute'')+units','(SELECT coalesce(sum(units),0) FROM gw_service_receipts WHERE key_id=_key AND created_at>clock_timestamp()-interval ''1 minute'')+units');
 def:=replace(def,'revoked_at=NULL','revoked_at=gw_ingest_keys.revoked_at');
 def:=replace(def,'event_id,decision,reason,http_status) VALUES','event_id,decision,reason,http_status,units) VALUES');
 def:=replace(def,'event,decision,left(reason,128),status);','event,decision,left(reason,128),status,greatest(1,least(units,50)));');
 EXECUTE def;
END $$;
COMMENT ON COLUMN public.gw_service_receipts.units IS 'Logical work count for per-key rate budget; nonce/key lock serialize admission.';