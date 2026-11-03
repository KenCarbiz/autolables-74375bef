DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.gw_extension_contract_violation(jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'IF (SELECT count(*) FROM jsonb_object_keys(d))<>15 OR', 'IF (SELECT count(*) FROM jsonb_object_keys(d))<>15 OR');
 IF position('FOREACH k IN ARRAY ARRAY[''instance'',''episode'']' IN definition)=0 THEN RAISE EXCEPTION 'unexpected vehicle type guard';END IF;
 definition:=replace(definition,'FOREACH k IN ARRAY ARRAY[''instance'',''episode'']', 'FOREACH k IN ARRAY ARRAY[''vin'',''instance'',''episode'']');
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION public.gw_extension_contract_violation(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_extension_contract_violation(jsonb) TO service_role;