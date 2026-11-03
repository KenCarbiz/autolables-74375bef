alter function public.gw_apply_internal(bigint, text) set search_path = public, extensions;

insert into public.gw_settings(id) values (1);

insert into public.gw_tenants(id, name) values
 ('grp-syn-northwind', 'Northwind Motor Group (SYNTHETIC)'),
 ('grp-syn-lakeshore', 'Lakeshore Auto Partners (SYNTHETIC)');
insert into public.gw_rooftops(id, tenant_id, name, city, state) values
 ('rt-syn-nw-01', 'grp-syn-northwind', 'Northwind Toyota (SYN)', 'Fictional Falls', 'CO'),
 ('rt-syn-nw-02', 'grp-syn-northwind', 'Northwind Honda (SYN)', 'Sample City', 'CO'),
 ('rt-syn-ls-01', 'grp-syn-lakeshore', 'Lakeshore Ford (SYN)', 'Testport', 'MI'),
 ('rt-syn-ls-02', 'grp-syn-lakeshore', 'Lakeshore Chevrolet (SYN)', 'Mockville', 'MI'),
 ('rt-syn-ls-03', 'grp-syn-lakeshore', 'Lakeshore Kia (SYN)', 'Demo Harbor', 'OH');
insert into public.gw_tenant_quotas(tenant_id) values ('grp-syn-northwind'), ('grp-syn-lakeshore');

insert into public.gw_source_allowlist(source_app, event_type, aggregate_type, authority, classification, schema_versions) values
 ('autolabels','inventory.updated','vehicle_instance','inventory/passport','internal','{1,2}'),
 ('autolabels','price.changed','vehicle_instance','pricing','internal','{1}'),
 ('autolabels','listing.sold','vehicle_instance','listing_episode','internal','{1}'),
 ('autofilm','video.engagement','vehicle_instance','video_engagement','internal','{1}'),
 ('autofilm','service.mpi_verified','vehicle_instance','mpi_service_evidence','internal','{1}'),
 ('autocurb','appraisal.completed','vehicle_instance','appraisal','internal','{1}'),
 ('autocurb','acquisition.closed','vehicle_instance','acquisition','internal','{1}'),
 ('autocurb','lead.consented','crm_lead','crm_consent','pii','{1}'),
 ('autoframe','media.approved','vehicle_instance','approved_media_metadata','media_meta','{1}');

insert into public.gw_routes(id, source_app, target_app, event_types, description) values
 ('labels->film','autolabels','autofilm','{inventory.updated,price.changed,listing.sold}','Inventory & pricing context for video'),
 ('film->labels','autofilm','autolabels','{video.engagement,service.mpi_verified}','Engagement & verified MPI on listing'),
 ('labels->curb','autolabels','autocurb','{inventory.updated,listing.sold}','Inventory state for appraisal/CRM'),
 ('curb->labels','autocurb','autolabels','{appraisal.completed,acquisition.closed}','Acquisition into inventory'),
 ('film->curb','autofilm','autocurb','{video.engagement,service.mpi_verified}','Engagement & service evidence to CRM'),
 ('curb->film','autocurb','autofilm','{appraisal.completed,lead.consented}','Appraisal & consented lead to video'),
 ('frame->labels','autoframe','autolabels','{media.approved}','Approved media metadata to listing'),
 ('frame->film','autoframe','autofilm','{media.approved}','Approved media metadata to video');

insert into public.gw_app_identities(app, tenant_id, key_id, scopes, status, rotate_after)
select a::public.gw_app, t.id, 'dev-' || a || '-' || t.id || '-k1', array['publish:' || a, 'tenant:' || t.id], 'active', now() + interval '30 days'
from unnest(array['autolabels','autofilm','autocurb','autoframe']) a cross join public.gw_tenants t;

-- Synthetic vehicles: 12 per rooftop. VIN = DEVSYN + rooftopIndex*100 + n
with rr as (select id, tenant_id, row_number() over (order by id) ri from public.gw_rooftops)
insert into public.gw_vehicle_identities(tenant_id, vin, year, make, model)
select rr.tenant_id, 'DEVSYN' || lpad((rr.ri * 100 + g)::text, 11, '0'),
  2019 + (g % 6), (array['Toyota','Honda','Ford','Chevrolet','Kia'])[1 + (g % 5)], 'Synthetic Model ' || g
from rr cross join generate_series(1, 12) g;

with rr as (select id, tenant_id, row_number() over (order by id) ri from public.gw_rooftops)
insert into public.gw_vehicle_instances(id, tenant_id, rooftop_id, identity_id)
select 'vi-' || rr.id || '-' || lpad(g::text, 3, '0'), rr.tenant_id, rr.id, v.id
from rr cross join generate_series(1, 12) g
join public.gw_vehicle_identities v on v.tenant_id = rr.tenant_id and v.vin = 'DEVSYN' || lpad((rr.ri * 100 + g)::text, 11, '0');

insert into public.gw_listing_episodes(id, tenant_id, instance_id)
select 'ep-' || substr(i.id, 4) || '-1', i.tenant_id, i.id from public.gw_vehicle_instances i;

-- Same VIN at a second rooftop in the same group (new vehicle instance + new listing episode)
insert into public.gw_vehicle_instances(id, tenant_id, rooftop_id, identity_id, kind)
select 'vi-rt-syn-nw-02-xfer-001', v.tenant_id, 'rt-syn-nw-02', v.id, 'acquisition'
from public.gw_vehicle_identities v where v.tenant_id = 'grp-syn-northwind' and v.vin = 'DEVSYN00000000401';
insert into public.gw_listing_episodes(id, tenant_id, instance_id) values ('ep-rt-syn-nw-02-xfer-001-1', 'grp-syn-northwind', 'vi-rt-syn-nw-02-xfer-001');

-- Same VIN in another group: separate tenant-scoped identity (no cross-tenant join)
insert into public.gw_vehicle_identities(tenant_id, vin, year, make, model)
values ('grp-syn-lakeshore', 'DEVSYN00000000401', 2021, 'Toyota', 'Synthetic Model 1');
insert into public.gw_vehicle_instances(id, tenant_id, rooftop_id, identity_id, kind)
select 'vi-rt-syn-ls-01-dupvin-001', 'grp-syn-lakeshore', 'rt-syn-ls-01', v.id, 'acquisition'
from public.gw_vehicle_identities v where v.tenant_id = 'grp-syn-lakeshore' and v.vin = 'DEVSYN00000000401';
insert into public.gw_listing_episodes(id, tenant_id, instance_id) values ('ep-rt-syn-ls-01-dupvin-001-1', 'grp-syn-lakeshore', 'vi-rt-syn-ls-01-dupvin-001');
