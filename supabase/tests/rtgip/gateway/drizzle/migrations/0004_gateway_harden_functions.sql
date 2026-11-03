alter function public.gw_forbid_mutation() set search_path = public;
revoke execute on function public.gw_is_member(text) from public, anon;
revoke execute on function public.gw_has_role(text, public.gw_role[]) from public, anon;
grant execute on function public.gw_is_member(text) to authenticated;
grant execute on function public.gw_has_role(text, public.gw_role[]) to authenticated;
