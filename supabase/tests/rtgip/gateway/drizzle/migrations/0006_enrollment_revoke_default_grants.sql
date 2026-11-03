revoke all on public.gw_dev_owner_allowlist from public, anon, authenticated;
revoke all on public.gw_invites from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.gw_invites from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.gw_tenant_members from public, anon, authenticated;