-- Seed Saturday-style AutoLabels sticker templates.
-- Idempotent: safe to run more than once. These rows expose the code-backed
-- React renderers through the database catalog without changing signing,
-- billing, generated_documents, or document workflow.

INSERT INTO public.sticker_templates (
  template_key,
  name,
  type,
  size,
  style_tags,
  config,
  is_active
)
VALUES
  (
    'window-saturday-hero',
    'Saturday Hero Window',
    'window',
    '8.5x11',
    ARRAY['Modern','Readability','Passport'],
    jsonb_build_object(
      'id', 'window-saturday-hero',
      'name', 'Saturday Hero Window',
      'type', 'window',
      'size', '8.5x11',
      'widthIn', 8.5,
      'heightIn', 11,
      'styleTags', jsonb_build_array('Modern','Readability','Passport'),
      'supportsLogo', true,
      'supportsQr', true,
      'supportsAccent', true,
      'defaultAccent', '#2563EB',
      'sections', jsonb_build_array('specs','totals','installed','benefits','upgrades','notes','qr'),
      'maxItems', jsonb_build_object('installed', 12, 'upgrades', 6, 'benefits', 6),
      'requiredFields', jsonb_build_array('vehicleTitle','vin','stock'),
      'optionalFields', jsonb_build_array(
        'vehicleImageUrl','exteriorColor','interiorColor','engine','drivetrain','transmission',
        'fuelEconomyCity','fuelEconomyHighway','fuelType','doorsSeats','topFeatures','historySignals',
        'vehicleScore','vehicleScoreLabel','dealerTrustScore','dealerReviewCount','marketPrice',
        'marketStatus','marketDelta','estimatedPayment','journeyEvents','notes'
      ),
      'marginsIn', 0,
      'useCase', 'Large-photo Saturday-style dealer window sticker with QR vehicle passport and bold price band'
    ),
    true
  ),
  (
    'window-saturday-classic',
    'Saturday Classic Window',
    'window',
    '8.5x11',
    ARRAY['Classic','Readability','CPO'],
    jsonb_build_object(
      'id', 'window-saturday-classic',
      'name', 'Saturday Classic Window',
      'type', 'window',
      'size', '8.5x11',
      'widthIn', 8.5,
      'heightIn', 11,
      'styleTags', jsonb_build_array('Classic','Readability','CPO'),
      'supportsLogo', true,
      'supportsQr', true,
      'supportsAccent', true,
      'defaultAccent', '#07376f',
      'sections', jsonb_build_array('specs','totals','installed','benefits','upgrades','notes','qr'),
      'maxItems', jsonb_build_object('installed', 12, 'upgrades', 6, 'benefits', 6),
      'requiredFields', jsonb_build_array('vehicleTitle','vin','stock'),
      'optionalFields', jsonb_build_array(
        'vehicleImageUrl','exteriorColor','interiorColor','engine','drivetrain','transmission',
        'fuelEconomyCity','fuelEconomyHighway','fuelType','doorsSeats','topFeatures','historySignals',
        'vehicleScore','vehicleScoreLabel','dealerTrustScore','dealerReviewCount','marketPrice',
        'marketStatus','marketDelta','estimatedPayment','journeyEvents','notes'
      ),
      'marginsIn', 0,
      'useCase', 'Blue-outline Honda-style Saturday sticker with highlights, equipment, fuel economy, price, and QR'
    ),
    true
  ),
  (
    'addendum-saturday-premium',
    'Saturday Premium Addendum',
    'addendum',
    '4.5x11',
    ARRAY['Modern','Readability','Compliance'],
    jsonb_build_object(
      'id', 'addendum-saturday-premium',
      'name', 'Saturday Premium Addendum',
      'type', 'addendum',
      'size', '4.5x11',
      'widthIn', 4.5,
      'heightIn', 11,
      'styleTags', jsonb_build_array('Modern','Readability','Compliance'),
      'supportsLogo', true,
      'supportsQr', true,
      'supportsAccent', true,
      'defaultAccent', '#2563EB',
      'sections', jsonb_build_array('installed','upgrades','benefits','totals','qr'),
      'maxItems', jsonb_build_object('installed', 12, 'upgrades', 6, 'benefits', 6),
      'requiredFields', jsonb_build_array('vehicleTitle','vin','stock'),
      'optionalFields', jsonb_build_array('vehicleImageUrl','marketPrice','marketStatus','marketDelta','estimatedPayment','notes'),
      'marginsIn', 0,
      'useCase', '4.5x11 companion addendum strip for Saturday window stickers',
      'complianceNote', 'Summarizes dealer-installed equipment and optional upgrades; full disclosure packet remains in the QR passport.'
    ),
    true
  )
ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  size = EXCLUDED.size,
  style_tags = EXCLUDED.style_tags,
  config = EXCLUDED.config,
  is_active = EXCLUDED.is_active;

DO $$
BEGIN
  IF to_regclass('public.sticker_template_versions') IS NOT NULL THEN
    INSERT INTO public.sticker_template_versions (template_key, version, config, is_current)
    SELECT template_key, 1, config, true
    FROM public.sticker_templates
    WHERE template_key IN ('window-saturday-hero', 'window-saturday-classic', 'addendum-saturday-premium')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
