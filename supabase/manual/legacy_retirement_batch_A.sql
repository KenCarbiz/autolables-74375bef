-- PRODUCTION EXECUTION SCRIPT. DO NOT RUN until Ken approves this exact list.
-- Preconditions: supabase/proposed/20261113000000_legacy_scrape_retirement.sql
-- applied (as the next free drizzle migration number), and PR #54 (Passport
-- "no longer listed" for archived listings) published, so retired links stop
-- showing purchase actions.
-- Batch A: 37 MarketCheck-scraped listings that are in none of the six SFTP
-- feeds and have no customer deal, signing or open lead.
-- The 14 George Harte INFINITI matches and the manual 2021 Rogue are NOT here.

BEGIN;

-- 0. Baseline (record these numbers in the thread before continuing).
SELECT count(*) AS store_inventory_rows,
       md5(string_agg(id::text||vin||coalesce(feed_price::text,'')||presence||coalesce(listing_id::text,'')||updated_at::text, ',' ORDER BY id)) AS store_inventory_hash
  FROM public.store_inventory;
SELECT status, count(*) FROM public.vehicle_listings WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142' GROUP BY 1;

-- 1. Dry run inside the transaction: must report eligible 37, blocked 0.
SELECT public.legacy_listing_retire(
  '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142',
  ARRAY[
    '9fe5cca1-1e0d-4688-8320-d530400f059f',
    '01e01c5d-e723-4b34-aba4-0ebe25a9c92c',
    '553c7abb-9d6c-4a20-b148-d093e3dde552',
    '4a5d9976-f8f9-475f-890f-e0c3ca2493bb',
    'a895365e-7625-497e-bf6c-525dbdc10da0',
    '445a2599-5adc-4eb7-82ea-801147d93ba7',
    '2d2f1a76-a93d-4378-a76f-6ce6250d4502',
    '56a12bbf-1173-4f81-af8e-9c8f0d48343a',
    'efcadddc-c4b1-459c-92bb-26ce552011c9',
    '6cec3722-b6ba-4bcb-9673-75069156de72',
    '002ed385-8cee-4e37-a888-5f284c5bd8be',
    'f371162d-f726-4d86-b605-e676d84fa5bd',
    '51e1789b-eab5-48db-9609-0de2bab02193',
    '2dd29934-cc47-438b-9977-783a3b61f0e4',
    '0b161ca5-1076-4265-a4e0-3436d7b4e92c',
    'd0e50f18-724a-4855-ad5d-cd529f854810',
    '3616c2a1-6a26-4716-91ff-e90db77ec4e8',
    'a981068e-3850-4b60-a960-8b825bde93c1',
    '934a0488-8dfb-4187-8939-602f9cfcc947',
    'a56ba38f-a283-4caa-ba53-876a1625fc74',
    '87146b8e-8e1c-4a95-a736-82089f1bd296',
    '0db95e59-19b6-481f-a261-fd5accc6033b',
    '3aaa763e-5996-4465-95bd-3a4a105971da',
    '49e2f447-aa9d-49d1-8486-f3f7bcbcfb74',
    '249507c0-d583-4500-b92f-8a705613d541',
    '27e87a6d-bb5b-4128-9f88-546d6bf5bcdb',
    'dce74a56-fb01-4f79-b6ae-808b25d043bd',
    'b751d992-b77b-4928-bbce-2656cb4e55f7',
    'bcc0de6d-2a85-45f7-b74e-c2eb272b4e1e',
    '4d0a8f10-da29-4bfb-9be5-12bef4b0fd9b',
    'ddc46e6a-cc04-4754-a197-caba0eb97f72',
    '69872304-1210-415f-8131-f3904e3fbeb4',
    '45e7fd3a-bd58-48ef-bd1c-fc0273470315',
    '5b676369-ad13-4fa3-ba1a-332c38c332d7',
    '8ec51425-742f-4c46-8a18-cd32fe5905ee',
    '2fbb8b91-35d8-4afd-8658-3c297bb282b3',
    'ff94cf1c-2aa3-4ad4-8b17-5c58e8fc9831'
  ]::uuid[],
  ARRAY[
    'JN1BV7AR6FM406806',
    'YV4A22PK3J1375505',
    '1HGCV1F50KA083807',
    '1FMCU0G68MUA61022',
    '3N1AB8BV3MY259117',
    'NMTKHMBXXMR129285',
    '3PCAJ5FB1PF122711',
    '3PCAJ5KR0PF114912',
    '5N1DL1FS5PC369237',
    '5N1DL1FS8PC368244',
    'JN8AZ3DB7S9403242',
    '5NMP54G13TH144040',
    'KMHL64JAXTA547670',
    '5N1AL1FS9TC358190',
    '5N1AL1FWXTC358105',
    'JN8AZ3AE1T9720885',
    '5N1AL1F82VC330223',
    '5N1AL1F83VC338928',
    '5N1AL1F89VC339940',
    '5N1AL1F93VC340011',
    '5N1AL1F96VC338415',
    '5N1AL1HZ1VC346273',
    '5N1AC0EX0VC609186',
    '5N1AC0EX5VC609278',
    '5N1AC0EX7VC609251',
    '5N1AC0FX1VC609809',
    '5N1AC0FX4VC605169',
    '5N1AC0FX5VC605679',
    '5N1AC0FX5VC605746',
    '5N1AC0FX5VC605844',
    '5N1AC0FX5VC606038',
    '5N1AC0FX6VC605481',
    '5N1AC0FX8VC608687',
    '5N1AC0FX9VC607600',
    '5N1AC0JX1VC606660',
    '5N1AC0JXXVC605801',
    'JN8AZ3DB9V9450387'
  ],
  ARRAY['harteinfiniti.com', 'hartecars.com'],
  '{}'::text[],
  'Retire legacy MarketCheck website-scrape listings replaced by the Files.com/vAuto SFTP feeds',
  NULL,
  true) AS dry_run;

-- 2. Real run (same arguments, p_dry_run false, Ken's approval text).
SELECT public.legacy_listing_retire(
  '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142',
  ARRAY[
    '9fe5cca1-1e0d-4688-8320-d530400f059f',
    '01e01c5d-e723-4b34-aba4-0ebe25a9c92c',
    '553c7abb-9d6c-4a20-b148-d093e3dde552',
    '4a5d9976-f8f9-475f-890f-e0c3ca2493bb',
    'a895365e-7625-497e-bf6c-525dbdc10da0',
    '445a2599-5adc-4eb7-82ea-801147d93ba7',
    '2d2f1a76-a93d-4378-a76f-6ce6250d4502',
    '56a12bbf-1173-4f81-af8e-9c8f0d48343a',
    'efcadddc-c4b1-459c-92bb-26ce552011c9',
    '6cec3722-b6ba-4bcb-9673-75069156de72',
    '002ed385-8cee-4e37-a888-5f284c5bd8be',
    'f371162d-f726-4d86-b605-e676d84fa5bd',
    '51e1789b-eab5-48db-9609-0de2bab02193',
    '2dd29934-cc47-438b-9977-783a3b61f0e4',
    '0b161ca5-1076-4265-a4e0-3436d7b4e92c',
    'd0e50f18-724a-4855-ad5d-cd529f854810',
    '3616c2a1-6a26-4716-91ff-e90db77ec4e8',
    'a981068e-3850-4b60-a960-8b825bde93c1',
    '934a0488-8dfb-4187-8939-602f9cfcc947',
    'a56ba38f-a283-4caa-ba53-876a1625fc74',
    '87146b8e-8e1c-4a95-a736-82089f1bd296',
    '0db95e59-19b6-481f-a261-fd5accc6033b',
    '3aaa763e-5996-4465-95bd-3a4a105971da',
    '49e2f447-aa9d-49d1-8486-f3f7bcbcfb74',
    '249507c0-d583-4500-b92f-8a705613d541',
    '27e87a6d-bb5b-4128-9f88-546d6bf5bcdb',
    'dce74a56-fb01-4f79-b6ae-808b25d043bd',
    'b751d992-b77b-4928-bbce-2656cb4e55f7',
    'bcc0de6d-2a85-45f7-b74e-c2eb272b4e1e',
    '4d0a8f10-da29-4bfb-9be5-12bef4b0fd9b',
    'ddc46e6a-cc04-4754-a197-caba0eb97f72',
    '69872304-1210-415f-8131-f3904e3fbeb4',
    '45e7fd3a-bd58-48ef-bd1c-fc0273470315',
    '5b676369-ad13-4fa3-ba1a-332c38c332d7',
    '8ec51425-742f-4c46-8a18-cd32fe5905ee',
    '2fbb8b91-35d8-4afd-8658-3c297bb282b3',
    'ff94cf1c-2aa3-4ad4-8b17-5c58e8fc9831'
  ]::uuid[],
  ARRAY[
    'JN1BV7AR6FM406806',
    'YV4A22PK3J1375505',
    '1HGCV1F50KA083807',
    '1FMCU0G68MUA61022',
    '3N1AB8BV3MY259117',
    'NMTKHMBXXMR129285',
    '3PCAJ5FB1PF122711',
    '3PCAJ5KR0PF114912',
    '5N1DL1FS5PC369237',
    '5N1DL1FS8PC368244',
    'JN8AZ3DB7S9403242',
    '5NMP54G13TH144040',
    'KMHL64JAXTA547670',
    '5N1AL1FS9TC358190',
    '5N1AL1FWXTC358105',
    'JN8AZ3AE1T9720885',
    '5N1AL1F82VC330223',
    '5N1AL1F83VC338928',
    '5N1AL1F89VC339940',
    '5N1AL1F93VC340011',
    '5N1AL1F96VC338415',
    '5N1AL1HZ1VC346273',
    '5N1AC0EX0VC609186',
    '5N1AC0EX5VC609278',
    '5N1AC0EX7VC609251',
    '5N1AC0FX1VC609809',
    '5N1AC0FX4VC605169',
    '5N1AC0FX5VC605679',
    '5N1AC0FX5VC605746',
    '5N1AC0FX5VC605844',
    '5N1AC0FX5VC606038',
    '5N1AC0FX6VC605481',
    '5N1AC0FX8VC608687',
    '5N1AC0FX9VC607600',
    '5N1AC0JX1VC606660',
    '5N1AC0JXXVC605801',
    'JN8AZ3DB9V9450387'
  ],
  ARRAY['harteinfiniti.com', 'hartecars.com'],
  '{}'::text[],
  'Retire legacy MarketCheck website-scrape listings replaced by the Files.com/vAuto SFTP feeds',
  'Ken approved batch A (37 VINs) in the AutoLabels project thread on <DATE>',
  false) AS result;   -- note the returned batch_id; it is the rollback key

-- 3. Verify before COMMIT.
SELECT count(*) = 37 AS ok_retired FROM public.vehicle_listings WHERE archive_reason = 'legacy_scrape_retired';
SELECT count(*) = 37 AS ok_audit FROM public.legacy_listing_retirements;
SELECT status, count(*) FROM public.vehicle_listings WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142' GROUP BY 1;  -- published 163 -> 126, archived 199 -> 236
SELECT count(*) AS store_inventory_rows,
       md5(string_agg(id::text||vin||coalesce(feed_price::text,'')||presence||coalesce(listing_id::text,'')||updated_at::text, ',' ORDER BY id)) AS store_inventory_hash
  FROM public.store_inventory;   -- must equal step 0

-- 4. Optional, separate yes needed: stop the legacy scraper config for Harte.
-- (The guard already blocks it from republishing or repricing retired rows;
-- this stops it writing to the tenant at all. Its cron is already inactive.)
-- UPDATE public.marketcheck_sync_config SET enabled = false WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142';

COMMIT;   -- or ROLLBACK if any check above is false

-- ROLLBACK AFTER COMMIT (reversible):
--   SELECT public.legacy_listing_restore('<batch_id from step 2>', 'Ken approved restore on <DATE>');
--   -- re-publishes the 37 with their prior archive fields, sticker states and description cases.
--   -- Then, only if the guards should go too: run 20261113000000_legacy_scrape_retirement.rollback.sql.
