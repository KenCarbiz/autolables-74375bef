INSERT INTO public.sticker_templates (
  template_key, name, type, size, style_tags, config, is_active
)
VALUES
  (
    'addendum-saturday-premium',
    'Saturday Premium Addendum V2',
    'addendum',
    '4.5x11',
    ARRAY['Modern','Readability','Compliance'],
    jsonb_build_object(
      'id', 'addendum-saturday-premium',
      'name', 'Saturday Premium Addendum V2',
      'type', 'addendum',
      'size', '4.5x11',
      'widthIn', 4.5,
      'heightIn', 11,
      'styleTags', jsonb_build_array('Modern','Readability','Compliance'),
      'supportsLogo', true,
      'supportsQr', true,
      'supportsAccent', true,
      'defaultAccent', '#2563EB',
      'sections', jsonb_build_array('installed','upgrades','totals','qr'),
      'maxItems', jsonb_build_object('installed', 12, 'upgrades', 6, 'benefits', 6),
      'requiredFields', jsonb_build_array('vehicleTitle','vin','stock'),
      'optionalFields', jsonb_build_array('vehicleImageUrl','marketPrice','marketStatus','marketDelta','estimatedPayment','notes'),
      'marginsIn', 0,
      'useCase', '4.5x11 premium branded addendum — V2 icon tile system, dealer masthead, passport QR, equipment and upgrades',
      'complianceNote', 'Summarizes dealer-installed equipment and optional upgrades; full disclosure packet remains in the QR passport.'
    ),
    true
  ),
  (
    'addendum-new-car-saas',
    'New Car SaaS Template V2',
    'addendum',
    '4.5x11',
    ARRAY['Modern','SaaS','Readability','New'],
    jsonb_build_object(
      'id', 'addendum-new-car-saas',
      'name', 'New Car SaaS Template V2',
      'type', 'addendum',
      'size', '4.5x11',
      'widthIn', 4.5,
      'heightIn', 11,
      'styleTags', jsonb_build_array('Modern','SaaS','Readability'),
      'supportsLogo', true,
      'supportsQr', true,
      'supportsAccent', true,
      'defaultAccent', '#2563EB',
      'sections', jsonb_build_array('installed','upgrades','totals','qr'),
      'maxItems', jsonb_build_object('installed', 12, 'upgrades', 6, 'benefits', 6),
      'requiredFields', jsonb_build_array('vehicleTitle','vin','stock'),
      'optionalFields', jsonb_build_array('vehicleImageUrl','marketPrice','marketStatus','marketDelta','estimatedPayment','notes'),
      'marginsIn', 0,
      'useCase', '4.5x11 new vehicle addendum — V2 icon tile system, shares the premium layout, own data behaviour.',
      'complianceNote', 'New vehicle addendum supplements the federal Monroney label; it never replaces it.'
    ),
    true
  )
ON CONFLICT (template_key) DO UPDATE SET
  name       = EXCLUDED.name,
  type       = EXCLUDED.type,
  size       = EXCLUDED.size,
  style_tags = EXCLUDED.style_tags,
  config     = EXCLUDED.config,
  is_active  = true;