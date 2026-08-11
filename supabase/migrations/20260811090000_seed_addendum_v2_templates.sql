-- Register the V2 addendum templates in the dealer-visible sticker catalog.
--
-- Two problems this fixes.
--
-- 1. The catalog hook replaced the built-in template list outright whenever
--    sticker_templates returned any active row. A template whose renderer
--    shipped in the build but had no row here was therefore invisible in the
--    Sticker Studio — which is why the New Car SaaS addendum could not be
--    found. The hook now merges instead of replacing, and these rows make the
--    two addendums explicit rather than relying on that fallback.
--
-- 2. Both rows still described the sheet as 4.25x11. The template registry has
--    always declared 4.5x11 (widthIn 4.5), and the components now draw that,
--    so the stored config was contradicting the renderer.
--
-- Names carry the V2 suffix so the version is visible where a dealer picks a
-- template. template_key is unchanged, so every stored reference — saved
-- defaults, generated_documents.template_id, dealer customizations — keeps
-- resolving. Idempotent: re-running changes nothing.

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
