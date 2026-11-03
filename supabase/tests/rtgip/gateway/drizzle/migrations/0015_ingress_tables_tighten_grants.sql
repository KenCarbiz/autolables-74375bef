-- 0015: explicit least privilege on 0014 ingress tables (nonce cache service-role only; metadata/receipts read-only).
revoke all on public.gw_ingest_nonces from public, anon, authenticated;
revoke all on public.gw_ingest_keys from public, anon, authenticated;
revoke all on public.gw_ingest_receipts from public, anon, authenticated;
revoke all on sequence public.gw_ingest_receipts_id_seq from public, anon, authenticated;
grant select on public.gw_ingest_keys to authenticated;
grant select on public.gw_ingest_receipts to authenticated;