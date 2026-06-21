-- Reconcile sticker_templates metadata with code registry hero renderers.
UPDATE public.sticker_templates SET
  name = 'Vehicle Passport Premium',
  style_tags = ARRAY['Passport','Modern'],
  config = jsonb_build_object(
    'id','window-premium',
    'name','Vehicle Passport Premium',
    'styleTags', jsonb_build_array('Passport','Modern'),
    'defaultAccent','#2563EB',
    'useCase','Flagship scan-first window sticker with premium price + QR cards'
  ),
  is_featured = true,
  updated_at = now()
WHERE template_key = 'window-premium';

UPDATE public.sticker_templates SET
  name = 'Big Price Lot Sticker',
  style_tags = ARRAY['Value','Readability'],
  config = jsonb_build_object(
    'id','window-bold',
    'name','Big Price Lot Sticker',
    'styleTags', jsonb_build_array('Value','Readability'),
    'defaultAccent','#b91c1c',
    'blackLabelReady', true,
    'useCase','High-readability lot sticker with huge price and QR, readable at 6-10 ft'
  ),
  is_featured = true,
  updated_at = now()
WHERE template_key = 'window-bold';

UPDATE public.sticker_templates SET
  name = 'Executive Noir',
  style_tags = ARRAY['Luxury'],
  config = jsonb_build_object(
    'id','window-luxury',
    'name','Executive Noir',
    'styleTags', jsonb_build_array('Luxury'),
    'defaultAccent','#c9a227',
    'blackLabelReady', true,
    'useCase','Luxury black-label window sticker for high-line inventory'
  ),
  is_featured = true,
  updated_at = now()
WHERE template_key = 'window-luxury';

-- Snapshot the refreshed configs into sticker_template_versions.
-- window-premium and window-bold get v1 (no prior version); window-luxury bumps to v2.
INSERT INTO public.sticker_template_versions (template_id, version, config, changelog)
SELECT t.id,
       COALESCE((SELECT MAX(v.version) FROM public.sticker_template_versions v WHERE v.template_id = t.id), 0) + 1,
       t.config,
       'Reconcile catalog with hero renderer (Vehicle Passport Premium / Big Price / Executive Noir).'
FROM public.sticker_templates t
WHERE t.template_key IN ('window-premium','window-bold','window-luxury')
ON CONFLICT (template_id, version) DO NOTHING;
