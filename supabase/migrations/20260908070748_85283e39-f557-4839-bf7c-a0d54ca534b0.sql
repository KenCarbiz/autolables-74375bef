REVOKE ALL ON TABLE public.neovin_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.provider_payload_shapes FROM anon, authenticated;
REVOKE ALL ON TABLE public.service_locks FROM anon, authenticated;
GRANT ALL ON TABLE public.neovin_snapshots TO service_role;
GRANT ALL ON TABLE public.provider_payload_shapes TO service_role;
GRANT ALL ON TABLE public.service_locks TO service_role;