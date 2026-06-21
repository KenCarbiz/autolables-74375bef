-- Sync the DB catalog metadata for the three polished premium hero templates,
-- including the sticker_template_versions v1 config (which 20260620170000 left
-- untouched). useStickerCatalog reads sticker_templates first, so the row config
-- drives the gallery; this also brings v1 in line so version history is honest.
--
-- This is GALLERY METADATA only (name / config.name / useCase / tags). The
-- rendered customer output is selected by template id in code and frozen per
-- document in generated_documents.data_snapshot, so no new version is created —
-- v1 is updated in place (per the preferred path for metadata-only changes).
-- Idempotent; safe no-op if the rows aren't present.

-- 1) Current template rows (re-asserted; matches the code registry).
UPDATE public.sticker_templates SET
  name = 'Vehicle Passport Premium',
  style_tags = ARRAY['Passport','Modern'],
  config = '{"id":"window-passport","name":"Vehicle Passport Premium","styleTags":["Passport","Modern"],"defaultAccent":"#2563EB","useCase":"Flagship scan-first hero with premium price + QR cards"}',
  updated_at = now()
WHERE template_key = 'window-passport';

UPDATE public.sticker_templates SET
  name = 'Big Price Lot Sticker',
  style_tags = ARRAY['Value','Readability'],
  config = '{"id":"window-value","name":"Big Price Lot Sticker","styleTags":["Value","Readability"],"defaultAccent":"#b91c1c","blackLabelReady":true,"useCase":"High-readability lot sticker: huge price + QR, readable at 6-10 ft"}',
  updated_at = now()
WHERE template_key = 'window-value';

UPDATE public.sticker_templates SET
  name = 'Executive Noir',
  style_tags = ARRAY['Luxury'],
  config = '{"id":"window-noir","name":"Executive Noir","styleTags":["Luxury"],"defaultAccent":"#c9a227","blackLabelReady":true,"useCase":"Luxury black-label hero for high-line inventory"}',
  updated_at = now()
WHERE template_key = 'window-noir';

-- 2) Bring the v1 version snapshot in line with the updated row config.
UPDATE public.sticker_template_versions v SET
  config = t.config,
  changelog = COALESCE(NULLIF(v.changelog, ''), 'Initial version') || ' (premium hero metadata sync)'
FROM public.sticker_templates t
WHERE v.template_id = t.id
  AND v.version = 1
  AND t.template_key IN ('window-passport','window-value','window-noir')
  AND v.config IS DISTINCT FROM t.config;
