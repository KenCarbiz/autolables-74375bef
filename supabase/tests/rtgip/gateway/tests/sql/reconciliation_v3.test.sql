-- Disposable-only equivalence proof. No changes to hosted reconciliation or historical evidence.
DO $$ DECLARE actor uuid:=gen_random_uuid();v2 jsonb;v3 jsonb;k text;passed int:=0;tenant text;
BEGIN
 INSERT INTO gw_tenant_members(user_id,tenant_id,role) SELECT actor,id,'admin' FROM gw_tenants;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 FOREACH tenant IN ARRAY ARRAY['grp-syn-northwind','grp-syn-lakeshore'] LOOP
 v2:=gw_reconcile(tenant);v3:=gw_reconcile_v3(tenant);
 FOREACH k IN ARRAY ARRAY['missing_fanout','delivered_without_inbox','terminal_without_inbox','inbox_without_ack','dead_without_dead_letter','projection_behind_delivered','stuck_messages'] LOOP
 IF v2->k IS DISTINCT FROM v3->k OR jsonb_typeof(v3->k)<>'number' THEN RAISE EXCEPTION 'v2/v3 counter mismatch %',k; END IF;passed:=passed+1;
 END LOOP;
 IF v2->'dlq' IS DISTINCT FROM v3->'dlq' OR v2->'routes' IS DISTINCT FROM v3->'routes' OR v3->'historical_original_ids_verified'<>'false'::jsonb THEN RAISE EXCEPTION 'v3 changed informational or historical semantics';END IF;passed:=passed+1;
 END LOOP;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;