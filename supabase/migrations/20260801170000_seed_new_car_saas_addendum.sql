-- Seed the New Car SaaS Template addendum.
-- A duplicate of the Saturday Premium Addendum, registered on its own
-- template_key so the new vehicle build-out never touches the approved premium
-- addendum. The React renderer lives in src/components/saturday/NewCarSaasAddendum.tsx
-- and is bound to this key in src/lib/stickerStudio/saturdayTemplates.tsx.
-- Idempotent: safe to run more than once.

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
    'addendum-new-car-saas',
    'New Car SaaS Template',
    'addendum',
    '4.5x11',
    ARRAY['Modern','SaaS','Readability','New'],
    jsonb_build_object(
      'id', 'addendum-new-car-saas',
      'name', 'New Car SaaS Template',
      'type', 'addendum',
      'size', '4.5x11',
      'widthIn', 4.5,
      'heightIn', 11,
      'styleTags', jsonb_build_array('Modern','SaaS','Readability'),
      'supportsLogo', true,
      'supportsQr', true,
      'supportsAccent', true,
      'defaultAccent', '#2563EB',
      'sections', jsonb_build_array('installed','upgrades','benefits','totals','qr'),
      'maxItems', jsonb_build_object('installed', 12, 'upgrades', 6, 'benefits', 6),
      'requiredFields', jsonb_build_array('vehicleTitle','vin','stock'),
      'optionalFields', jsonb_build_array('vehicleImageUrl','marketPrice','marketStatus','marketDelta','estimatedPayment','notes'),
      'marginsIn', 0,
      'useCase', '4.25x11 new vehicle addendum — independently editable duplicate of the Saturday Premium Addendum.',
      'complianceNote', 'New vehicle addendum supplements the federal Monroney label; it never replaces it.'
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
