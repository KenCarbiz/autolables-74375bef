create or replace function public.gw_contract_violation(_env jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare v jsonb; k text; t text;
begin
  if _env is null or jsonb_typeof(_env) <> 'object' then return 'envelope must be a JSON object'; end if;
  v := _env->'schema_version';
  if v is null then return 'missing required envelope field'; end if;
  if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric) then
    return 'foreign dialect: schema_version must be an integer (canonical v1), got ' || left(v::text, 40);
  end if;
  foreach k in array array['producer','source_record_id','source_version','tenant_ref','instance_ref','service_visit_ref','payload_checksum'] loop
    if _env ? k then
      return 'foreign dialect: AutoLabels PR #46 field ' || k || ' is not canonical v1 (translation unverified)';
    end if;
  end loop;
  if jsonb_typeof(_env->'event_id') is distinct from 'string' then return 'missing required envelope field'; end if;
  if jsonb_typeof(_env->'aggregate') is distinct from 'object' then
    return 'foreign dialect: aggregate must be an object {type,id,revision}';
  end if;
  v := _env->'aggregate'->'revision';
  if v is null or jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric) then
    return 'foreign dialect: aggregate.revision must be an integer';
  end if;
  if _env ? 'vehicle' and jsonb_typeof(_env->'vehicle') <> 'object' then
    return 'foreign dialect: vehicle must be an object {vin,instance_id,episode_id}';
  end if;
  if jsonb_typeof(_env->'source_app') is distinct from 'string'
     or (_env->>'source_app') not in ('autolabels','autofilm','autocurb','autoframe') then
    return 'foreign dialect: source_app must be a lowercase canonical app id';
  end if;
  if _env ? 'target_app' and (_env->>'target_app') not in ('autolabels','autofilm','autocurb','autoframe') then
    return 'foreign dialect: target_app must be a lowercase canonical app id';
  end if;
  t := _env->>'event_type';
  if t = 'acquisition.recorded' then
    return 'non-canonical event_type acquisition.recorded (AutoCurb draft); mapping to acquisition.closed is TBD';
  end if;
  if t in ('appraisal.recorded','autocurb.appraisal.recorded','autocurb.acquisition.recorded',
           'autolabels.vehicle.sold','autolabels.vehicle.delivered','autolabels.vehicle.sale_voided','autolabels.vehicle.archived',
           'vehicle.sold','vehicle.delivered','vehicle.sale_voided','vehicle.archived',
           'autofilm.inspection.completed','inspection.completed',
           'autofilm.repair.completed_verified','repair.completed_verified') then
    return 'blocked mapping: event_type ' || t || ' has no verified canonical v1 equivalent';
  end if;
  return null;
end $$;
comment on function public.gw_contract_violation(jsonb) is 'Frozen v1 dialect gate. Blocked cross-contract mappings mirror BLOCKED_EVENT_TYPES in src/lib/gateway/contract.ts and docs/contracts/COMPATIBILITY-DECISIONS.md section 9.';