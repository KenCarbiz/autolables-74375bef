-- DDL-only targeted function fixes; no data cleanup or canonical changes.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.gw_extension_apply_local(text,jsonb,text,text,timestamptz)'::regprocedure) INTO definition;
 IF position('AND decision=''applied''' IN definition)=0 THEN RAISE EXCEPTION 'unexpected extension apply definition';END IF;
 definition:=replace(definition,'AND decision=''applied''','AND gw_extension_receipts.decision=''applied''');
 EXECUTE definition;
 SELECT pg_get_functiondef('public.gw_extension_contract_violation(jsonb)'::regprocedure) INTO definition;
 IF position('e:=d->>''extension''; f:=d->''facts'';' IN definition)=0 THEN RAISE EXCEPTION 'unexpected extension contract definition';END IF;
 definition:=replace(definition,'e:=d->>''extension''; f:=d->''facts'';', 'FOREACH k IN ARRAY ARRAY[''protocol'',''extension'',''source'',''target'',''event'',''tenant'',''rooftop'',''source_event'',''receipt_ref'',''acl_ref'',''occurred_at''] LOOP IF jsonb_typeof(d->k) IS DISTINCT FROM ''string'' THEN RETURN ''string type required'';END IF;END LOOP;
 e:=d->>''extension''; f:=d->''facts'';');
 definition:=replace(definition,'IF jsonb_typeof(d->''revision'') IS DISTINCT FROM ''number'' THEN', 'IF EXISTS(SELECT 1 FROM jsonb_each(f)x WHERE x.value=''null''::jsonb) THEN RETURN ''null fact forbidden'';END IF;
 IF jsonb_typeof(d->''revision'') IS DISTINCT FROM ''number'' THEN');
 definition:=replace(definition,'IF f->''verified'' IS DISTINCT FROM ''true''::jsonb OR', 'IF jsonb_typeof(f->''condition'') IS DISTINCT FROM ''string'' THEN RETURN ''condition type'';END IF;
 IF f->''verified'' IS DISTINCT FROM ''true''::jsonb OR');
 definition:=replace(definition,'IF jsonb_typeof(f->''content_sha256'') IS DISTINCT FROM ''string'' OR', 'IF jsonb_typeof(f->''mime'') IS DISTINCT FROM ''string'' OR jsonb_typeof(f->''role'') IS DISTINCT FROM ''string'' THEN RETURN ''manager metadata types'';END IF;
 IF jsonb_typeof(f->''content_sha256'') IS DISTINCT FROM ''string'' OR');
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION public.gw_extension_apply_local(text,jsonb,text,text,timestamptz),public.gw_extension_contract_violation(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_extension_apply_local(text,jsonb,text,text,timestamptz),public.gw_extension_contract_violation(jsonb) TO service_role;