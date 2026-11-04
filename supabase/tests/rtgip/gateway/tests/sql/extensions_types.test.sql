-- Final strict null/type barriers; read-only assertions, rollback sentinel.
DO $$ DECLARE d jsonb;bad jsonb;passed int:=0;k text;
BEGIN
 d:='{"protocol":"gw.extension/1","extension":"labels->frame","source":"autolabels","target":"autoframe","event":"inventory.context_authorized","tenant":"grp-syn-northwind","rooftop":"rt-syn-nw-01","vehicle":{"vin":"DEVSYN00000000401","instance":"syn-instance","episode":"syn-episode"},"source_event":"syn-event","revision":1,"receipt_ref":"syn-receipt","acl_ref":"syn-acl","occurred_at":"2026-11-02T02:00:00Z","facts":{"status":"active"}}';
 IF gw_extension_contract_violation(d) IS NOT NULL THEN RAISE EXCEPTION 'positive type barrier';END IF;passed:=passed+1;
 FOREACH k IN ARRAY ARRAY['source','target','event','tenant','rooftop','source_event','receipt_ref','acl_ref','occurred_at'] LOOP
  bad:=jsonb_set(d,ARRAY[k],'null');IF gw_extension_contract_violation(bad) IS NULL THEN RAISE EXCEPTION 'nullable field admitted';END IF;passed:=passed+1;
 END LOOP;
 bad:=jsonb_set(d,'{vehicle,vin}','null');IF gw_extension_contract_violation(bad) IS NULL THEN RAISE EXCEPTION 'nullable VIN';END IF;passed:=passed+1;
 bad:=d||'{"reserved":true}';IF gw_extension_contract_violation(bad) IS NULL THEN RAISE EXCEPTION 'reserved field admitted';END IF;passed:=passed+1;
 bad:=jsonb_set(d,'{facts,status}','null');IF gw_extension_contract_violation(bad) IS NULL THEN RAISE EXCEPTION 'null fact admitted';END IF;passed:=passed+1;
 IF gw_extension_delivery()->>'decision' IS DISTINCT FROM 'disabled' OR (SELECT external_delivery_enabled FROM gw_settings) IS DISTINCT FROM false THEN RAISE EXCEPTION 'kill boundary';END IF;passed:=passed+1;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;