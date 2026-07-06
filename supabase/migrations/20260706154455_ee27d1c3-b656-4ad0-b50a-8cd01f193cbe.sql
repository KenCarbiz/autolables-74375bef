ALTER FUNCTION public.issue_dept_signoff_token(uuid, text, text, text) SET search_path = public, extensions;
ALTER FUNCTION public.issue_title_upload_token(uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public.issue_vehicle_ready_token(uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public.recon_submit_member(text, text, text, text, jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.seed_recon_estimate_for_ingest(uuid, text, text, uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public.submit_recon_estimate(text, text, text, text, jsonb, numeric) SET search_path = public, extensions;