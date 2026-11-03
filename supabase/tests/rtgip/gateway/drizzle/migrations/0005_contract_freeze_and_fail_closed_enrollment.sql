-- ============ TASK 1: strict canonical v1 type gate (no silent coercion) ============
alter function public.gw_publish_internal(jsonb, uuid) rename to gw_publish_core;
revoke all on function public.gw_publish_core(jsonb, uuid) from public, anon, authenticated;

create or replace function public.gw_contract_violation(_env jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare v jsonb;
begin
  if _env is null or jsonb_typeof(_env) <> 'object' then return 'envelope must be a JSON object'; end if;
  v := _env->'schema_version';
  if v is null then return 'missing required envelope field'; end if;
  if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric) then
    return 'foreign dialect: schema_version must be an integer (canonical v1), got ' || left(v::text, 40);
  end if;
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
  if (_env->>'event_type') = 'acquisition.recorded' then
    return 'non-canonical event_type acquisition.recorded (AutoCurb draft); mapping to acquisition.closed is TBD';
  end if;
  return null;
end $$;

create or replace function public.gw_publish_internal(_env jsonb, _bench uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  v_reason := gw_contract_violation(_env);
  if v_reason is not null then return jsonb_build_object('status','rejected','reason',v_reason); end if;
  return gw_publish_core(_env, _bench);
end $$;
revoke all on function public.gw_publish_internal(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gw_contract_violation(jsonb) to authenticated;
revoke execute on function public.gw_contract_violation(jsonb) from public, anon;

-- ============ TASK 2: fail-closed enrollment ============
create table public.gw_dev_owner_allowlist (
  email text primary key check (email = lower(email) and email like '%@%'),
  note text,
  added_at timestamptz not null default now()
);
grant all on public.gw_dev_owner_allowlist to service_role;
alter table public.gw_dev_owner_allowlist enable row level security;
-- no policies: invisible to anon/authenticated

create table public.gw_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.gw_tenants(id),
  email text not null check (email = lower(email) and email like '%@%'),
  role public.gw_role not null default 'viewer',
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);
create unique index gw_invites_open_uq on public.gw_invites(tenant_id, email) where accepted_at is null and revoked_at is null;
grant select on public.gw_invites to authenticated;
grant all on public.gw_invites to service_role;
alter table public.gw_invites enable row level security;
create policy "tenant admins read invites" on public.gw_invites for select to authenticated
  using (public.gw_has_role(tenant_id, array['admin']::public.gw_role[]));

-- verified, non-anonymous email of the caller (null otherwise)
create or replace function public.gw_caller_verified_email() returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(u.email) from auth.users u
  where u.id = auth.uid() and u.email is not null and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false
$$;
revoke all on function public.gw_caller_verified_email() from public, anon, authenticated;

create or replace function public.gw_dev_join() returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'gw_dev_join is disabled: tenant access requires an admin invite or the DEV owner allowlist';
end $$;
revoke all on function public.gw_dev_join() from public, anon, authenticated;

create or replace function public.gw_dev_claim_owner() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text; n int;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  v_email := gw_caller_verified_email();
  if v_email is null then raise exception 'verified email required'; end if;
  if not exists (select 1 from gw_dev_owner_allowlist where email = v_email) then
    raise exception 'not on DEV owner allowlist';
  end if;
  insert into gw_tenant_members(user_id, tenant_id, role)
    select auth.uid(), id, 'admin' from gw_tenants where is_synthetic
  on conflict (user_id, tenant_id) do update set role = 'admin';
  get diagnostics n = row_count;
  insert into gw_audit_log(actor, action, detail) values (auth.uid(), 'dev_owner_bootstrap', jsonb_build_object('tenants', n));
  return jsonb_build_object('granted', n);
end $$;

create or replace function public.gw_invite_member(_tenant text, _email text, _role public.gw_role) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text := lower(trim(_email));
begin
  if not gw_has_role(_tenant, array['admin']::gw_role[]) then raise exception 'only tenant admins can invite'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email'; end if;
  insert into gw_invites(tenant_id, email, role, invited_by) values (_tenant, v_email, _role, auth.uid()) returning id into v_id;
  insert into gw_audit_log(tenant_id, actor, action, detail) values (_tenant, auth.uid(), 'invite', jsonb_build_object('invite_id', v_id, 'role', _role));
  return v_id;
end $$;

create or replace function public.gw_revoke_invite(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_t text;
begin
  select tenant_id into v_t from gw_invites where id = _id;
  if v_t is null or not gw_has_role(v_t, array['admin']::gw_role[]) then raise exception 'only tenant admins can revoke'; end if;
  update gw_invites set revoked_at = now() where id = _id and accepted_at is null;
  insert into gw_audit_log(tenant_id, actor, action, detail) values (v_t, auth.uid(), 'invite_revoked', jsonb_build_object('invite_id', _id));
end $$;

create or replace function public.gw_accept_invites() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text; r record; n int := 0;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  v_email := gw_caller_verified_email();
  if v_email is null then raise exception 'verified email required'; end if;
  for r in select * from gw_invites where email = v_email and accepted_at is null and revoked_at is null for update loop
    insert into gw_tenant_members(user_id, tenant_id, role) values (auth.uid(), r.tenant_id, r.role)
      on conflict (user_id, tenant_id) do update set role = excluded.role;
    update gw_invites set accepted_at = now(), accepted_by = auth.uid() where id = r.id;
    insert into gw_audit_log(tenant_id, actor, action, detail) values (r.tenant_id, auth.uid(), 'invite_accepted', jsonb_build_object('invite_id', r.id, 'role', r.role));
    n := n + 1;
  end loop;
  return jsonb_build_object('accepted', n);
end $$;

create or replace function public.gw_remove_member(_tenant text, _user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not gw_has_role(_tenant, array['admin']::gw_role[]) then raise exception 'only tenant admins can remove members'; end if;
  if (select role from gw_tenant_members where tenant_id = _tenant and user_id = _user) = 'admin'
     and (select count(*) from gw_tenant_members where tenant_id = _tenant and role = 'admin') <= 1 then
    raise exception 'cannot remove the last admin';
  end if;
  delete from gw_tenant_members where tenant_id = _tenant and user_id = _user;
  insert into gw_audit_log(tenant_id, actor, action, detail) values (_tenant, auth.uid(), 'member_removed', jsonb_build_object('user', _user));
end $$;

revoke all on function public.gw_dev_claim_owner(), public.gw_invite_member(text,text,public.gw_role), public.gw_revoke_invite(uuid),
  public.gw_accept_invites(), public.gw_remove_member(text,uuid) from public, anon;
grant execute on function public.gw_dev_claim_owner(), public.gw_invite_member(text,text,public.gw_role), public.gw_revoke_invite(uuid),
  public.gw_accept_invites(), public.gw_remove_member(text,uuid) to authenticated;

-- belt and braces: membership rows can only be written by these definer functions
revoke insert, update, delete on public.gw_tenant_members from anon, authenticated;