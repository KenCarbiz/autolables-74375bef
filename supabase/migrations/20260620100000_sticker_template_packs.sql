-- Sticker Studio template packs. Upserts the full 18-template catalog (6 base +
-- 12 new packs) into sticker_templates so the DB-backed gallery matches the code
-- registry. The config jsonb is the override merged onto the code base config
-- for the type at render time. Built-in fallback templates are unchanged, so the
-- app works before (built-ins) and after (DB catalog) this migration.

INSERT INTO public.sticker_templates (template_key, name, type, size, style_tags, config) VALUES
  -- Window stickers (8.5x11)
  ('window-modern',    'Modern SaaS Blue',          'window',  '8.5x11', ARRAY['Modern','SaaS'],        '{"id":"window-modern","name":"Modern SaaS Blue","styleTags":["Modern","SaaS"],"defaultAccent":"#2563EB","blackLabelReady":true,"useCase":"Everyday used-car window sticker"}'),
  ('window-classic',   'Classic Monroney',          'window',  '8.5x11', ARRAY['Classic','Compliance'], '{"id":"window-classic","name":"Classic Monroney","styleTags":["Classic","Compliance"],"defaultAccent":"#0B2041","supportsAccent":false,"useCase":"Factory-style disclosure layout"}'),
  ('window-luxury',    'Luxury Black Label',        'window',  '8.5x11', ARRAY['Luxury'],               '{"id":"window-luxury","name":"Luxury Black Label","styleTags":["Luxury"],"defaultAccent":"#7c5c1e","blackLabelReady":true,"useCase":"Premium / high-line inventory"}'),
  ('window-ev',        'EV / Hybrid Focus',         'window',  '8.5x11', ARRAY['EV','Modern'],          '{"id":"window-ev","name":"EV / Hybrid Focus","styleTags":["EV","Modern"],"defaultAccent":"#0f766e","blackLabelReady":true,"useCase":"Electrified inventory"}'),
  ('window-cpo',       'CPO Confidence Report',     'window',  '8.5x11', ARRAY['CPO','Classic'],        '{"id":"window-cpo","name":"CPO Confidence Report","styleTags":["CPO","Classic"],"defaultAccent":"#047857","useCase":"Certified pre-owned reassurance sheet"}'),
  ('window-value',     'Value-First Used Car',      'window',  '8.5x11', ARRAY['Value','Modern'],       '{"id":"window-value","name":"Value-First Used Car","styleTags":["Value","Modern"],"defaultAccent":"#b91c1c","useCase":"Price-forward value messaging"}'),
  ('window-passport',  'Vehicle Passport Report',   'window',  '8.5x11', ARRAY['Passport','Modern'],    '{"id":"window-passport","name":"Vehicle Passport Report","styleTags":["Passport","Modern"],"defaultAccent":"#2563EB","useCase":"Scan-first packet hero"}'),
  ('window-readable',  'Minimal High-Readability',  'window',  '8.5x11', ARRAY['Readability','Classic'],'{"id":"window-readable","name":"Minimal High-Readability","styleTags":["Readability","Classic"],"defaultAccent":"#0B2041","supportsAccent":false,"useCase":"Maximum legibility, low ink"}'),
  ('window-noir',      'Executive Noir',            'window',  '8.5x11', ARRAY['Luxury'],               '{"id":"window-noir","name":"Executive Noir","styleTags":["Luxury"],"defaultAccent":"#c9a227","blackLabelReady":true,"useCase":"Black-label premium"}'),
  -- Addendum strips (4.5x11)
  ('addendum-modern',     'Clean Addendum Blue',        'addendum','4.5x11', ARRAY['Modern','SaaS'],        '{"id":"addendum-modern","name":"Clean Addendum Blue","styleTags":["Modern","SaaS"],"defaultAccent":"#2563EB","blackLabelReady":true,"useCase":"Default supplemental addendum"}'),
  ('addendum-luxury',     'Luxury Black Addendum',      'addendum','4.5x11', ARRAY['Luxury'],               '{"id":"addendum-luxury","name":"Luxury Black Addendum","styleTags":["Luxury"],"defaultAccent":"#7c5c1e","blackLabelReady":true,"useCase":"Premium add-on strip"}'),
  ('addendum-compliance', 'Compliance-First Addendum',  'addendum','4.5x11', ARRAY['Compliance','Classic'], '{"id":"addendum-compliance","name":"Compliance-First Addendum","styleTags":["Compliance","Classic"],"defaultAccent":"#0B2041","supportsAccent":false,"useCase":"Disclosure-forward addendum"}'),
  ('addendum-value',      'Value Stack Addendum',       'addendum','4.5x11', ARRAY['Value','Modern'],       '{"id":"addendum-value","name":"Value Stack Addendum","styleTags":["Value","Modern"],"defaultAccent":"#b91c1c","useCase":"Stacked value emphasis"}'),
  ('addendum-installed',  'Installed Equipment Focus',  'addendum','4.5x11', ARRAY['Modern'],               '{"id":"addendum-installed","name":"Installed Equipment Focus","styleTags":["Modern"],"defaultAccent":"#2563EB","maxItems":{"installed":16,"upgrades":6,"benefits":6},"useCase":"Heavy accessory lists"}'),
  ('addendum-passport',   'QR Passport Addendum',       'addendum','4.5x11', ARRAY['Passport','Modern'],    '{"id":"addendum-passport","name":"QR Passport Addendum","styleTags":["Passport","Modern"],"defaultAccent":"#2563EB","useCase":"Scan-to-packet addendum"}'),
  ('addendum-readable',   'Narrow High-Readability',    'addendum','4.5x11', ARRAY['Readability','Classic'],'{"id":"addendum-readable","name":"Narrow High-Readability","styleTags":["Readability","Classic"],"defaultAccent":"#0B2041","supportsAccent":false,"useCase":"Maximum legibility addendum"}'),
  ('addendum-lot',        'Minimal Lot Label',          'addendum','4.5x11', ARRAY['Readability','Compliance'],'{"id":"addendum-lot","name":"Minimal Lot Label","styleTags":["Readability","Compliance"],"defaultAccent":"#111827","supportsAccent":false,"blackLabelReady":true,"useCase":"Bare-bones lot label"}'),
  ('addendum-noir',       'Executive Noir Addendum',    'addendum','4.5x11', ARRAY['Luxury'],               '{"id":"addendum-noir","name":"Executive Noir Addendum","styleTags":["Luxury"],"defaultAccent":"#c9a227","blackLabelReady":true,"useCase":"Black-label premium strip"}')
ON CONFLICT (template_key) DO UPDATE
  SET name = EXCLUDED.name,
      type = EXCLUDED.type,
      size = EXCLUDED.size,
      style_tags = EXCLUDED.style_tags,
      config = EXCLUDED.config,
      updated_at = now();

-- Freeze v1 for any template that doesn't have a version row yet.
INSERT INTO public.sticker_template_versions (template_id, version, config, changelog)
SELECT id, 1, config, 'Template pack seed' FROM public.sticker_templates
ON CONFLICT (template_id, version) DO NOTHING;
