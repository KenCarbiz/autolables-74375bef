-- Reconcile the live DB window catalog with the polished hero renderers. The
-- live keys (seeded by 20260620232625 / base seed) are authoritative; the code
-- registry + renderer now attach the three hero layouts to these existing keys:
--   window-premium -> Vehicle Passport Premium
--   window-bold    -> Big Price Lot Sticker
--   window-luxury  -> Executive Noir
-- This UPDATES existing rows (no new keys, no duplicate concepts) and, because
-- the customer-facing rendered output changes, snapshots a v2 version row.
-- Idempotent; safe no-op if a key is absent.

-- 1) Metadata to match the code registry. config.id MUST equal template_key so
--    the renderer selection (templateFromConfig -> PREMIUM_RENDERERS) fires.
UPDATE public.sticker_templates SET
  name = 'Vehicle Passport Premium', type = 'window', size = '8.5x11',
  style_tags = ARRAY['Passport','Modern'], is_active = true,
  config = '{"id":"window-premium","name":"Vehicle Passport Premium","styleTags":["Passport","Modern"],"defaultAccent":"#2563EB","useCase":"Flagship scan-first window sticker with premium price + QR cards"}',
  updated_at = now()
WHERE template_key = 'window-premium';

UPDATE public.sticker_templates SET
  name = 'Big Price Lot Sticker', type = 'window', size = '8.5x11',
  style_tags = ARRAY['Value','Readability'], is_active = true,
  config = '{"id":"window-bold","name":"Big Price Lot Sticker","styleTags":["Value","Readability"],"defaultAccent":"#b91c1c","blackLabelReady":true,"useCase":"High-readability lot sticker with huge price and QR"}',
  updated_at = now()
WHERE template_key = 'window-bold';

UPDATE public.sticker_templates SET
  name = 'Executive Noir', type = 'window', size = '8.5x11',
  style_tags = ARRAY['Luxury'], is_active = true,
  config = '{"id":"window-luxury","name":"Executive Noir","styleTags":["Luxury"],"defaultAccent":"#c9a227","blackLabelReady":true,"useCase":"Luxury black-label window sticker for high-line inventory"}',
  updated_at = now()
WHERE template_key = 'window-luxury';

-- 2) Snapshot a v2 version (the visual output changed) and advance current_version.
INSERT INTO public.sticker_template_versions (template_id, version, config, changelog)
SELECT id, 2, config, 'Premium hero redesign: Vehicle Passport Premium / Big Price Lot Sticker / Executive Noir'
FROM public.sticker_templates
WHERE template_key IN ('window-premium','window-bold','window-luxury')
ON CONFLICT (template_id, version) DO NOTHING;

UPDATE public.sticker_templates
SET current_version = 2, updated_at = now()
WHERE template_key IN ('window-premium','window-bold','window-luxury')
  AND current_version < 2;

-- 3) Retire the earlier code-invented window keys (seeded by 20260620100000)
--    so the active catalog equals the live + reconciled set
--    {window-bold, window-classic, window-luxury, window-minimal, window-modern,
--    window-premium} with no duplicate hero concepts. Deactivate, do not delete
--    (generated_documents reference template_id as a frozen text snapshot, not a
--    FK, so retiring a catalog row never affects existing documents).
UPDATE public.sticker_templates
SET is_active = false, updated_at = now()
WHERE template_key IN ('window-passport','window-value','window-noir','window-ev','window-cpo','window-readable')
  AND is_active = true;
