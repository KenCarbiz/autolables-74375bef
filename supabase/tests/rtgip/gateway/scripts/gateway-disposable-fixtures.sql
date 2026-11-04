-- LOCAL DISPOSABLE TEST FIXTURES ONLY. Not a migration or permission to seed shared hosted data.
-- The historical migrations omitted these tool-seeded rows. Mirror existing TS registry explicitly.
-- Local auth is a compatibility fixture, not hosted authentication proof.
CREATE OR REPLACE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT public.digest($1,$2) $$;
CREATE OR REPLACE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT public.digest($1,$2) $$;
INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous,aud,role)
VALUES('00000000-0000-4000-a000-00000000ffff','disposable-owner@example.test',now(),false,'authenticated','authenticated') ON CONFLICT DO NOTHING;
INSERT INTO public.gw_tenant_members(user_id,tenant_id,role)
SELECT '00000000-0000-4000-a000-00000000ffff',id,'admin' FROM public.gw_tenants ON CONFLICT DO NOTHING;
INSERT INTO public.gw_read_exchange_policy(source_app,consumer_app,purpose,sections)
SELECT s::public.gw_app,c::public.gw_app,
CASE s WHEN 'autolabels' THEN 'listing_context' WHEN 'autofilm' THEN 'verified_condition_context' WHEN 'autocurb' THEN 'acquisition_context' ELSE 'approved_media_context' END,
CASE s WHEN 'autolabels' THEN ARRAY['identity','listing','sold_history'] WHEN 'autofilm' THEN ARRAY['service','video'] WHEN 'autocurb' THEN ARRAY['acquisition'] ELSE ARRAY['media'] END
FROM unnest(ARRAY['autolabels','autofilm','autocurb','autoframe'])s CROSS JOIN unnest(ARRAY['autolabels','autofilm','autocurb','autoframe'])c WHERE s<>c ON CONFLICT DO NOTHING;
INSERT INTO public.gw_ingest_keys(key_id,source_app,tenant_id,rooftop_ids,key_fingerprint,not_before,not_after,key_usage)
SELECT replace(a,'auto','')||'-'||g||'-x1',a::public.gw_app,
CASE g WHEN 'nw' THEN 'grp-syn-northwind' ELSE 'grp-syn-lakeshore' END,
CASE g WHEN 'nw' THEN ARRAY['rt-syn-nw-01'] ELSE ARRAY['rt-syn-ls-01'] END,
encode(public.digest('dev-public-ingest-key:'||replace(a,'auto','')||'-'||g||'-x1','sha256'),'hex'),now()-interval '1 day',now()+interval '90 days','read_only'
FROM unnest(ARRAY['autolabels','autofilm','autocurb','autoframe'])a CROSS JOIN unnest(ARRAY['nw','ls'])g ON CONFLICT DO NOTHING;
INSERT INTO public.gw_read_exchange_grants(key_id,source_app,purpose,not_after)
SELECT k.key_id,p.source_app,p.purpose,now()+interval '90 days' FROM public.gw_ingest_keys k
JOIN public.gw_read_exchange_policy p ON p.consumer_app=k.source_app WHERE k.key_id LIKE '%-x1' ON CONFLICT DO NOTHING;
INSERT INTO public.gw_extension_registry(id,source_app,target_app,event_type,purpose)VALUES
('labels->frame','autolabels','autoframe','inventory.context_authorized','frame_inventory_context'),
('film->frame','autofilm','autoframe','mpi.independently_verified_context','frame_shot_context'),
('curb->frame','autocurb','autoframe','acquisition.custody_completed','frame_new_custody_context'),
('frame->curb','autoframe','autocurb','media.subscriber_approved','curb_approved_media_context') ON CONFLICT DO NOTHING;