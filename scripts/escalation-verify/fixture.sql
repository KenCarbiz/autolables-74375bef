-- Synthetic dealerships and leads for the escalation run. Applied after the
-- db-verify platform, pre-state and both Administration V2 migrations. No
-- hosted identifier, name, phone or address appears here; every address is on
-- the reserved example.test domain and is answered by the local fake sender.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'Escalating Motors', 'escalating-motors'),
  ('e0000000-0000-4000-8000-000000000002', 'Refused Mail Motors', 'refused-mail-motors'),
  ('e0000000-0000-4000-8000-000000000003', 'No Destination Motors', 'no-destination-motors'),
  ('e0000000-0000-4000-8000-000000000004', 'Escalation Off Motors', 'escalation-off-motors'),
  ('e0000000-0000-4000-8000-000000000005', 'Text Only Motors', 'text-only-motors'),
  ('e0000000-0000-4000-8000-000000000006', 'No Routing Motors', 'no-routing-motors');

INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES
  ('e0000000-0000-4000-8000-000000000001', jsonb_build_object('passport_contact_routing', jsonb_build_object(
     'escalationRules', jsonb_build_object('enabled', true, 'escalateToBdcAfterMinutes', 15, 'escalateToManagerAfterMinutes', 60, 'notifyMethods', jsonb_build_array('email')),
     'bdcSettings', jsonb_build_object('bdcEmail', 'bdc@escalating.example.test'),
     'managerFallback', jsonb_build_object('managerEmail', 'manager@escalating.example.test')))),
  ('e0000000-0000-4000-8000-000000000002', jsonb_build_object('passport_contact_routing', jsonb_build_object(
     'escalationRules', jsonb_build_object('enabled', true, 'escalateToBdcAfterMinutes', 15, 'escalateToManagerAfterMinutes', 0),
     'bdcSettings', jsonb_build_object('bdcEmail', 'refuse-bdc@refused.example.test')))),
  ('e0000000-0000-4000-8000-000000000003', jsonb_build_object('passport_contact_routing', jsonb_build_object(
     'escalationRules', jsonb_build_object('enabled', true, 'escalateToBdcAfterMinutes', 15),
     'bdcSettings', jsonb_build_object('bdcEmail', 'not an address')))),
  ('e0000000-0000-4000-8000-000000000004', jsonb_build_object('passport_contact_routing', jsonb_build_object(
     'escalationRules', jsonb_build_object('enabled', false),
     'bdcSettings', jsonb_build_object('bdcEmail', 'bdc@off.example.test')))),
  ('e0000000-0000-4000-8000-000000000005', jsonb_build_object('passport_contact_routing', jsonb_build_object(
     'escalationRules', jsonb_build_object('enabled', true, 'notifyMethods', jsonb_build_array('sms')),
     'bdcSettings', jsonb_build_object('bdcEmail', 'bdc@text.example.test')))),
  ('e0000000-0000-4000-8000-000000000006', jsonb_build_object('dealer_name', 'No Routing Motors'));

-- Leads. The two-letter name is the case key the run checks; it is also the
-- only lead detail, so the audit check can prove no lead detail leaks there.
INSERT INTO public.leads (id, tenant_id, store_id, name, phone, email, vehicle_interest, vehicle_vin, status, routing, first_response_at, escalation_level, created_at)
SELECT id::uuid, tenant::uuid, NULL, name, '555-0100', name || '@shopper.example.test', 'Example sedan', 'EXAMPLEVIN0000001', status,
       CASE WHEN routed THEN '{"target":"bdc"}'::jsonb END, CASE WHEN answered THEN now() - interval '1 minute' END, level, now() - (age || ' minutes')::interval
FROM (VALUES
  -- Escalating Motors: BDC after 15 minutes, manager after 60.
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'la', 'new',       true,  false, 0, 20),
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'lb', 'new',       true,  false, 0, 90),
  ('f0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'lc', 'new',       true,  false, 1, 90),
  ('f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'ld', 'new',       true,  false, 2, 90),
  ('f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000001', 'le', 'new',       true,  true,  0, 20),
  ('f0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000001', 'lf', 'contacted', true,  false, 0, 20),
  ('f0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000001', 'lg', 'new',       false, false, 0, 20),
  ('f0000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000001', 'lh', 'new',       true,  false, 0, 5),
  -- Refused Mail Motors: the sender refuses the BDC address.
  ('f0000000-0000-4000-8000-000000000009', 'e0000000-0000-4000-8000-000000000002', 'lr', 'new',       true,  false, 0, 30),
  -- The other dealerships each have one due lead that must not be sent.
  ('f0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000003', 'ln', 'new',       true,  false, 0, 30),
  ('f0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000004', 'lo', 'new',       true,  false, 0, 30),
  ('f0000000-0000-4000-8000-000000000012', 'e0000000-0000-4000-8000-000000000005', 'lt', 'new',       true,  false, 0, 30),
  ('f0000000-0000-4000-8000-000000000013', 'e0000000-0000-4000-8000-000000000006', 'lu', 'new',       true,  false, 0, 30)
) AS v(id, tenant, name, status, routed, answered, level, age);
