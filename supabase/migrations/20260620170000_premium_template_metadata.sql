-- Sync the DB-backed catalog metadata for the three polished premium hero
-- templates with the code registry (names, tags, config). The RENDER layout is
-- selected by template id in code, so this only refreshes display metadata; it
-- adds no tables and is idempotent. Safe no-op if the rows aren't present yet.

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
