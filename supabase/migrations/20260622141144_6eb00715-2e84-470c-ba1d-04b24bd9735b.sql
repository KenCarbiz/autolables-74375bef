INSERT INTO public.sticker_templates (template_key, name, type, size, style_tags, config, is_active)
VALUES
  ('window-saturday-hero', 'Saturday Hero Window', 'window', '8.5x11', ARRAY['Modern','Readability','Passport'],
    jsonb_build_object('id','window-saturday-hero','name','Saturday Hero Window','type','window','size','8.5x11','widthIn',8.5,'heightIn',11,'styleTags',jsonb_build_array('Modern','Readability','Passport'),'supportsLogo',true,'supportsQr',true,'supportsAccent',true,'defaultAccent','#2563EB','sections',jsonb_build_array('specs','totals','installed','benefits','upgrades','notes','qr'),'maxItems',jsonb_build_object('installed',12,'upgrades',6,'benefits',6),'requiredFields',jsonb_build_array('vehicleTitle','vin','stock'),'optionalFields',jsonb_build_array('vehicleImageUrl','exteriorColor','interiorColor','engine','drivetrain','transmission','fuelEconomyCity','fuelEconomyHighway','fuelType','doorsSeats','topFeatures','historySignals','vehicleScore','vehicleScoreLabel','dealerTrustScore','dealerReviewCount','marketPrice','marketStatus','marketDelta','estimatedPayment','journeyEvents','notes'),'marginsIn',0,'useCase','Large-photo Saturday-style dealer window sticker with QR vehicle passport and bold price band'),
    true),
  ('window-saturday-classic', 'Saturday Classic Window', 'window', '8.5x11', ARRAY['Classic','Readability','CPO'],
    jsonb_build_object('id','window-saturday-classic','name','Saturday Classic Window','type','window','size','8.5x11','widthIn',8.5,'heightIn',11,'styleTags',jsonb_build_array('Classic','Readability','CPO'),'supportsLogo',true,'supportsQr',true,'supportsAccent',true,'defaultAccent','#07376f','sections',jsonb_build_array('specs','totals','installed','benefits','upgrades','notes','qr'),'maxItems',jsonb_build_object('installed',12,'upgrades',6,'benefits',6),'requiredFields',jsonb_build_array('vehicleTitle','vin','stock'),'optionalFields',jsonb_build_array('vehicleImageUrl','exteriorColor','interiorColor','engine','drivetrain','transmission','fuelEconomyCity','fuelEconomyHighway','fuelType','doorsSeats','topFeatures','historySignals','vehicleScore','vehicleScoreLabel','dealerTrustScore','dealerReviewCount','marketPrice','marketStatus','marketDelta','estimatedPayment','journeyEvents','notes'),'marginsIn',0,'useCase','Blue-outline Honda-style Saturday sticker with highlights, equipment, fuel economy, price, and QR'),
    true),
  ('addendum-saturday-premium', 'Saturday Premium Addendum', 'addendum', '4.5x11', ARRAY['Modern','Readability','Compliance'],
    jsonb_build_object('id','addendum-saturday-premium','name','Saturday Premium Addendum','type','addendum','size','4.5x11','widthIn',4.5,'heightIn',11,'styleTags',jsonb_build_array('Modern','Readability','Compliance'),'supportsLogo',true,'supportsQr',true,'supportsAccent',true,'defaultAccent','#2563EB','sections',jsonb_build_array('installed','upgrades','benefits','totals','qr'),'maxItems',jsonb_build_object('installed',12,'upgrades',6,'benefits',6),'requiredFields',jsonb_build_array('vehicleTitle','vin','stock'),'optionalFields',jsonb_build_array('vehicleImageUrl','marketPrice','marketStatus','marketDelta','estimatedPayment','notes'),'marginsIn',0,'useCase','4.5x11 companion addendum strip for Saturday window stickers','complianceNote','Summarizes dealer-installed equipment and optional upgrades; full disclosure packet remains in the QR passport.'),
    true)
ON CONFLICT (template_key) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, size=EXCLUDED.size, style_tags=EXCLUDED.style_tags, config=EXCLUDED.config, is_active=EXCLUDED.is_active;

-- Dealer settings persistence
CREATE TABLE IF NOT EXISTS public.dealer_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, dealer_name text, legal_name text, state text DEFAULT 'CT', default_condition text DEFAULT 'used', is_active boolean NOT NULL DEFAULT true, settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id));
CREATE TABLE IF NOT EXISTS public.dealer_template_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, default_window_template text DEFAULT 'window-saturday-hero', default_addendum_template text DEFAULT 'addendum-saturday-premium', new_window_template text DEFAULT 'new-car-sticker', used_window_template text DEFAULT 'window-saturday-hero', dealer_cpo_template text DEFAULT 'window-saturday-hero', oem_cpo_template text DEFAULT 'window-saturday-hero', luxury_template text DEFAULT 'window-saturday-hero', settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id));
CREATE TABLE IF NOT EXISTS public.dealer_rule_preferences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, state text NOT NULL DEFAULT 'CT', require_ftc_buyers_guide boolean NOT NULL DEFAULT true, require_k208 boolean NOT NULL DEFAULT true, auto_select_templates boolean NOT NULL DEFAULT true, auto_generate_passport boolean NOT NULL DEFAULT true, auto_generate_addendum boolean NOT NULL DEFAULT true, auto_archive_signed_packet boolean NOT NULL DEFAULT true, rules jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, state));
CREATE TABLE IF NOT EXISTS public.dealer_branding (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, dealer_name text, address text, phone text, website text, logo_url text, primary_color text DEFAULT '#2563EB', secondary_color text DEFAULT '#071f3f', accent_color text DEFAULT '#22c55e', tagline text, disclaimer text, branding jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id));
CREATE TABLE IF NOT EXISTS public.dealer_review_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, source_type text NOT NULL DEFAULT 'google', label text NOT NULL DEFAULT 'Google Reviews', rating numeric(3,2), review_count integer, profile_url text, manually_entered boolean NOT NULL DEFAULT false, allow_automated_fetch boolean NOT NULL DEFAULT false, is_primary boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.dealer_passport_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, passport_enabled boolean NOT NULL DEFAULT true, show_market_data boolean NOT NULL DEFAULT true, show_reconditioning boolean NOT NULL DEFAULT true, show_service_records boolean NOT NULL DEFAULT true, show_history_signals boolean NOT NULL DEFAULT true, qr_destination_mode text NOT NULL DEFAULT 'public_listing', settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id));
CREATE TABLE IF NOT EXISTS public.dealer_cpo_programs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, program_type text NOT NULL DEFAULT 'dealer', label text NOT NULL, headline text NOT NULL, months integer, miles integer, requires_financing boolean NOT NULL DEFAULT false, price_add_on numeric(12,2), disclosure text, is_default boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.dealer_price_labels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, label text NOT NULL, context text NOT NULL DEFAULT 'used', is_default boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 100, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS idx_dealer_settings_tenant_id ON public.dealer_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_template_preferences_tenant_id ON public.dealer_template_preferences (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_rule_preferences_tenant_state ON public.dealer_rule_preferences (tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_dealer_branding_tenant_id ON public.dealer_branding (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_review_sources_tenant_id ON public.dealer_review_sources (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_passport_settings_tenant_id ON public.dealer_passport_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_cpo_programs_tenant_id ON public.dealer_cpo_programs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dealer_price_labels_tenant_id ON public.dealer_price_labels (tenant_id);

ALTER TABLE public.dealer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_template_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_rule_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_review_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_passport_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_cpo_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_price_labels ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tname text;
BEGIN
  IF to_regclass('public.tenant_members') IS NOT NULL THEN
    FOREACH tname IN ARRAY ARRAY['dealer_settings','dealer_template_preferences','dealer_rule_preferences','dealer_branding','dealer_review_sources','dealer_passport_settings','dealer_cpo_programs','dealer_price_labels'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members read" ON public.%1$I', tname);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members write" ON public.%1$I', tname);
      EXECUTE format('CREATE POLICY "%1$s tenant members read" ON public.%1$I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = (SELECT auth.uid())))', tname);
      EXECUTE format('CREATE POLICY "%1$s tenant members write" ON public.%1$I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = (SELECT auth.uid())))', tname);
    END LOOP;
  END IF;
END $$;

INSERT INTO public.dealer_price_labels (tenant_id, label, context, is_default, sort_order)
SELECT tenant_id, label, 'used', label = 'Best Price', sort_order
FROM public.dealer_settings
CROSS JOIN (VALUES ('Selling Price',10),('Market Price',20),('Best Price',30),('One Price',40),('Value Price',50),('Dealer Custom Text',60)) AS labels(label, sort_order)
ON CONFLICT DO NOTHING;

-- CT MVP evidence persistence
CREATE TABLE IF NOT EXISTS public.document_lifecycle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vehicle_id uuid, vin text, stock text, event_type text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), actor_id uuid, actor_name text, source text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.signature_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vehicle_id uuid, vin text, stock text, role text NOT NULL, signer_name text, signer_email text, signed_at timestamptz, ip_address text, user_agent text, device_label text, signature_image_url text, consent_text text, document_keys text[] NOT NULL DEFAULT ARRAY[]::text[], metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.ct_mvp_certification_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, vehicle_id uuid, vin text, stock text, vehicle_title text, ready boolean NOT NULL DEFAULT false, required_document_keys text[] NOT NULL DEFAULT ARRAY[]::text[], rule_output jsonb NOT NULL DEFAULT '{}'::jsonb, lifecycle_audit jsonb NOT NULL DEFAULT '{}'::jsonb, signature_validation jsonb NOT NULL DEFAULT '{}'::jsonb, checks jsonb NOT NULL DEFAULT '[]'::jsonb, source text NOT NULL DEFAULT 'ct-mvp-certification', certified_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_tenant_vehicle ON public.document_lifecycle_events (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_vin ON public.document_lifecycle_events (vin);
CREATE INDEX IF NOT EXISTS idx_document_lifecycle_events_event_type ON public.document_lifecycle_events (event_type);
CREATE INDEX IF NOT EXISTS idx_signature_evidence_tenant_vehicle ON public.signature_evidence (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_signature_evidence_vin ON public.signature_evidence (vin);
CREATE INDEX IF NOT EXISTS idx_signature_evidence_role ON public.signature_evidence (role);
CREATE INDEX IF NOT EXISTS idx_ct_mvp_certification_runs_tenant_vehicle ON public.ct_mvp_certification_runs (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ct_mvp_certification_runs_vin ON public.ct_mvp_certification_runs (vin);
CREATE INDEX IF NOT EXISTS idx_ct_mvp_certification_runs_ready ON public.ct_mvp_certification_runs (ready);

ALTER TABLE public.document_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ct_mvp_certification_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tname text;
BEGIN
  IF to_regclass('public.tenant_members') IS NOT NULL THEN
    FOREACH tname IN ARRAY ARRAY['document_lifecycle_events','signature_evidence','ct_mvp_certification_runs'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members read" ON public.%1$I', tname);
      EXECUTE format('DROP POLICY IF EXISTS "%1$s tenant members write" ON public.%1$I', tname);
      EXECUTE format('CREATE POLICY "%1$s tenant members read" ON public.%1$I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = (SELECT auth.uid())))', tname);
      EXECUTE format('CREATE POLICY "%1$s tenant members write" ON public.%1$I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = %1$I.tenant_id AND tm.user_id = (SELECT auth.uid())))', tname);
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ct_mvp_capture_signature_evidence_from_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  tenant uuid; vehicle uuid; vin_value text; stock_value text;
  signer_role text; signed_at_value timestamptz;
  signer_name_value text; signer_email_value text;
  ip_value text; ua_value text; consent_value text; docs_value text[];
BEGIN
  tenant := NULLIF(row_json->>'tenant_id','')::uuid;
  IF tenant IS NULL THEN tenant := NULLIF(row_json->>'store_id','')::uuid; END IF;
  IF tenant IS NULL THEN RETURN NEW; END IF;
  vehicle := NULLIF(COALESCE(row_json->>'vehicle_id', row_json->>'listing_id'),'')::uuid;
  vin_value := COALESCE(row_json->>'vehicle_vin', row_json->>'vin');
  stock_value := COALESCE(row_json->>'stock', row_json->>'stock_number');
  signer_role := COALESCE(row_json->>'signer_type', row_json->>'role', 'customer');
  signed_at_value := NULLIF(COALESCE(row_json->>'signed_at', row_json->>'customer_signed_at'),'')::timestamptz;
  IF signed_at_value IS NULL THEN RETURN NEW; END IF;
  signer_name_value := COALESCE(row_json->>'signer_name', row_json->>'customer_name');
  signer_email_value := COALESCE(row_json->>'signer_email', row_json->>'customer_email');
  ip_value := COALESCE(row_json->>'ip_address', row_json->>'customer_ip');
  ua_value := COALESCE(row_json->>'user_agent', row_json#>>'{esign_consent,user_agent}');
  consent_value := COALESCE(row_json#>>'{esign_consent,text}', row_json#>>'{esign_consent,disclosure_text}', 'Electronic signature consent captured');
  docs_value := ARRAY['window_sticker','addendum'];
  IF (row_json->'canonical_payload'->'generated_documents') IS NOT NULL THEN
    docs_value := ARRAY(SELECT DISTINCT COALESCE(value->>'document_type', value->>'type', value->>'key') FROM jsonb_array_elements(row_json->'canonical_payload'->'generated_documents') value WHERE COALESCE(value->>'document_type', value->>'type', value->>'key') IS NOT NULL);
    IF array_length(docs_value,1) IS NULL THEN docs_value := ARRAY['window_sticker','addendum']; END IF;
  END IF;
  INSERT INTO public.signature_evidence (tenant_id,vehicle_id,vin,stock,role,signer_name,signer_email,signed_at,ip_address,user_agent,consent_text,document_keys,metadata)
  VALUES (tenant,vehicle,vin_value,stock_value,signer_role,signer_name_value,signer_email_value,signed_at_value,ip_value,ua_value,consent_value,docs_value,jsonb_build_object('source_table',TG_TABLE_NAME,'source_row_id',row_json->>'id','content_hash',row_json->>'content_hash'));
  INSERT INTO public.document_lifecycle_events (tenant_id,vehicle_id,vin,stock,event_type,occurred_at,actor_name,source,metadata)
  VALUES (tenant,vehicle,vin_value,stock_value,'customer_signed',signed_at_value,signer_name_value,TG_TABLE_NAME,jsonb_build_object('source_row_id',row_json->>'id','role',signer_role));
  RETURN NEW;
END; $fn$;

DO $$
BEGIN
  IF to_regclass('public.addendum_signings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_capture_addendum_signing_evidence ON public.addendum_signings;
    CREATE TRIGGER trg_ct_mvp_capture_addendum_signing_evidence AFTER INSERT ON public.addendum_signings FOR EACH ROW EXECUTE FUNCTION public.ct_mvp_capture_signature_evidence_from_row();
  END IF;
  IF to_regclass('public.addendums') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_capture_signed_addendum_evidence ON public.addendums;
    CREATE TRIGGER trg_ct_mvp_capture_signed_addendum_evidence AFTER UPDATE ON public.addendums FOR EACH ROW WHEN ((to_jsonb(NEW)->>'status') = 'signed' AND NULLIF(COALESCE(to_jsonb(NEW)->>'customer_signed_at', to_jsonb(NEW)->>'signed_at'),'') IS NOT NULL) EXECUTE FUNCTION public.ct_mvp_capture_signature_evidence_from_row();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ct_mvp_capture_document_generation_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  tenant uuid; vehicle uuid; vin_value text; stock_value text;
  doc_type text; event_name text; occurred timestamptz;
BEGIN
  tenant := NULLIF(COALESCE(row_json->>'tenant_id', row_json->>'store_id'),'')::uuid;
  vehicle := NULLIF(COALESCE(row_json->>'vehicle_id', row_json->>'listing_id'),'')::uuid;
  vin_value := COALESCE(row_json->>'vin', row_json->>'vehicle_vin');
  stock_value := COALESCE(row_json->>'stock', row_json->>'stock_number');
  doc_type := lower(COALESCE(row_json->>'doc_type', row_json->>'document_type', row_json->>'type', row_json->>'template_id', ''));
  occurred := COALESCE(NULLIF(row_json->>'created_at','')::timestamptz, NULLIF(row_json->>'generated_at','')::timestamptz, NULLIF(row_json->>'archived_at','')::timestamptz, now());
  IF tenant IS NULL THEN RETURN NEW; END IF;
  IF doc_type IN ('buyers_guide','buyer_guide','ftc_buyers_guide','ftc-buyers-guide') OR doc_type LIKE '%buyers_guide%' OR doc_type LIKE '%buyers-guide%' OR doc_type LIKE '%ftc%' THEN
    event_name := 'ftc_buyers_guide_generated';
  ELSIF doc_type IN ('k208','k-208','ct_k208','ct-k208') OR doc_type LIKE '%k208%' OR doc_type LIKE '%k-208%' OR doc_type LIKE '%connecticut_disclosure%' OR doc_type LIKE '%ct_disclosure%' THEN
    event_name := 'k208_generated';
  ELSE RETURN NEW; END IF;
  INSERT INTO public.document_lifecycle_events (tenant_id,vehicle_id,vin,stock,event_type,occurred_at,source,metadata)
  VALUES (tenant,vehicle,vin_value,stock_value,event_name,occurred,TG_TABLE_NAME,jsonb_build_object('source_table',TG_TABLE_NAME,'source_row_id',row_json->>'id','doc_type',doc_type,'template_id',row_json->>'template_id','entity_id',row_json->>'entity_id'));
  RETURN NEW;
END; $fn$;

DO $$
BEGIN
  IF to_regclass('public.generated_documents') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_generated_documents_lifecycle ON public.generated_documents;
    CREATE TRIGGER trg_ct_mvp_generated_documents_lifecycle AFTER INSERT ON public.generated_documents FOR EACH ROW EXECUTE FUNCTION public.ct_mvp_capture_document_generation_event();
  END IF;
  IF to_regclass('public.signed_document_archive') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_archive_document_lifecycle ON public.signed_document_archive;
    CREATE TRIGGER trg_ct_mvp_archive_document_lifecycle AFTER INSERT ON public.signed_document_archive FOR EACH ROW EXECUTE FUNCTION public.ct_mvp_capture_document_generation_event();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ct_mvp_compliance_digest_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, subject text NOT NULL, summary_text text NOT NULL, digest jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','dismissed')), channel text NOT NULL DEFAULT 'manager_digest' CHECK (channel IN ('manager_digest','email','in_app')), recipient_email text, sent_at timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ct_mvp_digest_outbox_tenant_status_idx ON public.ct_mvp_compliance_digest_outbox (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ct_mvp_digest_outbox_created_idx ON public.ct_mvp_compliance_digest_outbox (created_at DESC);
ALTER TABLE public.ct_mvp_compliance_digest_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ct_mvp_digest_outbox_service_role_all" ON public.ct_mvp_compliance_digest_outbox;
CREATE POLICY "ct_mvp_digest_outbox_service_role_all" ON public.ct_mvp_compliance_digest_outbox FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "ct_mvp_digest_outbox_authenticated_read" ON public.ct_mvp_compliance_digest_outbox;
CREATE POLICY "ct_mvp_digest_outbox_authenticated_read" ON public.ct_mvp_compliance_digest_outbox FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.touch_ct_mvp_compliance_digest_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;
DROP TRIGGER IF EXISTS trg_touch_ct_mvp_compliance_digest_outbox ON public.ct_mvp_compliance_digest_outbox;
CREATE TRIGGER trg_touch_ct_mvp_compliance_digest_outbox BEFORE UPDATE ON public.ct_mvp_compliance_digest_outbox FOR EACH ROW EXECUTE FUNCTION public.touch_ct_mvp_compliance_digest_outbox();

CREATE TABLE IF NOT EXISTS public.customer_engagement_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, store_id text, vehicle_id text, vin text, stock text, session_id text NOT NULL, visitor_id text, source text NOT NULL DEFAULT 'unknown' CHECK (source IN ('passport','window_sticker_qr','website','email','sms','direct','unknown')), surface text NOT NULL DEFAULT 'unknown' CHECK (surface IN ('vehicle_passport','window_sticker','public_listing','document_packet','document_viewer','lead_form','unknown')), event_type text NOT NULL CHECK (event_type IN ('passport_opened','window_sticker_scanned','public_listing_opened','packet_opened','document_opened','document_downloaded','document_printed','photo_viewed','video_played','cta_clicked','lead_form_opened','lead_submitted','share_clicked','call_clicked','text_clicked','directions_clicked','finance_clicked','trade_clicked','scroll_depth','time_on_page','engagement_ping')), document_type text, document_id text, document_title text, packet_id text, qr_token text, referrer text, landing_url text, user_agent text, ip_address inet, device_type text, browser text, os text, country text, region text, city text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS customer_engagement_events_tenant_time_idx ON public.customer_engagement_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS customer_engagement_events_vehicle_time_idx ON public.customer_engagement_events (vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS customer_engagement_events_vin_time_idx ON public.customer_engagement_events (vin, occurred_at DESC);
CREATE INDEX IF NOT EXISTS customer_engagement_events_session_idx ON public.customer_engagement_events (session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS customer_engagement_events_event_type_idx ON public.customer_engagement_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS customer_engagement_events_document_idx ON public.customer_engagement_events (document_type, document_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS customer_engagement_events_metadata_gin_idx ON public.customer_engagement_events USING gin (metadata);
ALTER TABLE public.customer_engagement_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_engagement_events_service_role_all" ON public.customer_engagement_events;
CREATE POLICY "customer_engagement_events_service_role_all" ON public.customer_engagement_events FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "customer_engagement_events_authenticated_read" ON public.customer_engagement_events;
CREATE POLICY "customer_engagement_events_authenticated_read" ON public.customer_engagement_events FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE VIEW public.customer_engagement_vehicle_summary AS
SELECT tenant_id, vehicle_id, vin, stock, count(*) AS total_events, count(DISTINCT session_id) AS unique_sessions,
  count(*) FILTER (WHERE event_type = 'passport_opened') AS passport_opens,
  count(*) FILTER (WHERE event_type = 'window_sticker_scanned') AS sticker_scans,
  count(*) FILTER (WHERE event_type = 'packet_opened') AS packet_opens,
  count(*) FILTER (WHERE event_type = 'document_opened') AS document_opens,
  count(*) FILTER (WHERE event_type = 'cta_clicked') AS cta_clicks,
  count(*) FILTER (WHERE event_type = 'lead_submitted') AS leads,
  max(occurred_at) AS last_engaged_at, min(occurred_at) AS first_engaged_at
FROM public.customer_engagement_events GROUP BY tenant_id, vehicle_id, vin, stock;

CREATE OR REPLACE VIEW public.customer_engagement_document_summary AS
SELECT tenant_id, vehicle_id, vin, document_type, document_id, document_title, count(*) AS total_events, count(DISTINCT session_id) AS unique_sessions,
  count(*) FILTER (WHERE event_type = 'document_opened') AS opens,
  count(*) FILTER (WHERE event_type = 'document_downloaded') AS downloads,
  count(*) FILTER (WHERE event_type = 'document_printed') AS prints,
  max(occurred_at) AS last_opened_at
FROM public.customer_engagement_events WHERE document_type IS NOT NULL OR document_id IS NOT NULL
GROUP BY tenant_id, vehicle_id, vin, document_type, document_id, document_title;

CREATE TABLE IF NOT EXISTS public.passport_delivery_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT false, require_customer_name boolean NOT NULL DEFAULT true, require_sms_verification boolean NOT NULL DEFAULT false, require_phone boolean NOT NULL DEFAULT false, create_lead boolean NOT NULL DEFAULT true, notify_sales_team boolean NOT NULL DEFAULT true, allow_trade_value_cta boolean NOT NULL DEFAULT true, autocurb_trade_enabled boolean NOT NULL DEFAULT false, autocurb_trade_url text, email_subject_template text NOT NULL DEFAULT 'Your vehicle information packet from {{dealer_name}}', email_intro_template text NOT NULL DEFAULT 'Here is the vehicle information packet you requested.', metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.passport_document_delivery_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text, store_id text, vehicle_id text, vin text, stock text, packet_id text, qr_token text, customer_name text, customer_email text NOT NULL, customer_phone text, verification_required boolean NOT NULL DEFAULT false, verification_status text NOT NULL DEFAULT 'not_required' CHECK (verification_status IN ('not_required','pending','verified','failed','expired')), delivery_status text NOT NULL DEFAULT 'requested' CHECK (delivery_status IN ('requested','queued','sent','failed','cancelled')), lead_status text NOT NULL DEFAULT 'new' CHECK (lead_status IN ('new','created','sent_to_crm','failed','suppressed')), source text NOT NULL DEFAULT 'passport' CHECK (source IN ('passport','window_sticker_qr','website','email','sms','direct','unknown')), vehicle_of_interest jsonb NOT NULL DEFAULT '{}'::jsonb, requested_documents jsonb NOT NULL DEFAULT '[]'::jsonb, customer_trade_intent jsonb NOT NULL DEFAULT '{}'::jsonb, autocurb_handoff jsonb NOT NULL DEFAULT '{}'::jsonb, session_id text, visitor_id text, referrer text, landing_url text, user_agent text, ip_address inet, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, requested_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.passport_sms_verifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.passport_document_delivery_requests(id) ON DELETE CASCADE, tenant_id text, phone text NOT NULL, code_hash text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed','expired')), attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5, sent_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes', provider text, provider_message_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.passport_document_delivery_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.passport_document_delivery_requests(id) ON DELETE CASCADE, tenant_id text, channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','crm','sales_notification','autocurb_trade')), status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')), recipient text, subject text, payload jsonb NOT NULL DEFAULT '{}'::jsonb, provider text, provider_message_id text, error text, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS passport_delivery_settings_tenant_idx ON public.passport_delivery_settings (tenant_id);
CREATE INDEX IF NOT EXISTS passport_delivery_requests_tenant_time_idx ON public.passport_document_delivery_requests (tenant_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS passport_delivery_requests_vehicle_time_idx ON public.passport_document_delivery_requests (vehicle_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS passport_delivery_requests_vin_time_idx ON public.passport_document_delivery_requests (vin, requested_at DESC);
CREATE INDEX IF NOT EXISTS passport_delivery_requests_email_idx ON public.passport_document_delivery_requests (customer_email, requested_at DESC);
CREATE INDEX IF NOT EXISTS passport_sms_verifications_request_idx ON public.passport_sms_verifications (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS passport_delivery_outbox_status_idx ON public.passport_document_delivery_outbox (status, created_at ASC);
CREATE INDEX IF NOT EXISTS passport_delivery_outbox_request_idx ON public.passport_document_delivery_outbox (request_id, created_at DESC);

ALTER TABLE public.passport_delivery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_document_delivery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_sms_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_document_delivery_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "passport_delivery_settings_service_role_all" ON public.passport_delivery_settings;
CREATE POLICY "passport_delivery_settings_service_role_all" ON public.passport_delivery_settings FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "passport_delivery_settings_authenticated_read" ON public.passport_delivery_settings;
CREATE POLICY "passport_delivery_settings_authenticated_read" ON public.passport_delivery_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "passport_document_delivery_requests_service_role_all" ON public.passport_document_delivery_requests;
CREATE POLICY "passport_document_delivery_requests_service_role_all" ON public.passport_document_delivery_requests FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "passport_document_delivery_requests_authenticated_read" ON public.passport_document_delivery_requests;
CREATE POLICY "passport_document_delivery_requests_authenticated_read" ON public.passport_document_delivery_requests FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "passport_sms_verifications_service_role_all" ON public.passport_sms_verifications;
CREATE POLICY "passport_sms_verifications_service_role_all" ON public.passport_sms_verifications FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "passport_delivery_outbox_service_role_all" ON public.passport_document_delivery_outbox;
CREATE POLICY "passport_delivery_outbox_service_role_all" ON public.passport_document_delivery_outbox FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "passport_delivery_outbox_authenticated_read" ON public.passport_document_delivery_outbox;
CREATE POLICY "passport_delivery_outbox_authenticated_read" ON public.passport_document_delivery_outbox FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.touch_passport_delivery_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;
DROP TRIGGER IF EXISTS trg_touch_passport_delivery_settings ON public.passport_delivery_settings;
CREATE TRIGGER trg_touch_passport_delivery_settings BEFORE UPDATE ON public.passport_delivery_settings FOR EACH ROW EXECUTE FUNCTION public.touch_passport_delivery_updated_at();
DROP TRIGGER IF EXISTS trg_touch_passport_document_delivery_requests ON public.passport_document_delivery_requests;
CREATE TRIGGER trg_touch_passport_document_delivery_requests BEFORE UPDATE ON public.passport_document_delivery_requests FOR EACH ROW EXECUTE FUNCTION public.touch_passport_delivery_updated_at();
DROP TRIGGER IF EXISTS trg_touch_passport_document_delivery_outbox ON public.passport_document_delivery_outbox;
CREATE TRIGGER trg_touch_passport_document_delivery_outbox BEFORE UPDATE ON public.passport_document_delivery_outbox FOR EACH ROW EXECUTE FUNCTION public.touch_passport_delivery_updated_at();

CREATE OR REPLACE VIEW public.passport_delivery_request_summary AS
SELECT tenant_id, vehicle_id, vin, stock, count(*) AS total_requests,
  count(*) FILTER (WHERE verification_status = 'verified') AS verified_requests,
  count(*) FILTER (WHERE delivery_status = 'sent') AS delivered_requests,
  count(*) FILTER (WHERE lead_status IN ('created','sent_to_crm')) AS leads_created,
  count(*) FILTER (WHERE NULLIF(customer_phone,'') IS NOT NULL) AS phone_captured,
  count(*) FILTER (WHERE COALESCE(customer_trade_intent,'{}'::jsonb) <> '{}'::jsonb) AS trade_intent_count,
  max(requested_at) AS last_requested_at
FROM public.passport_document_delivery_requests
GROUP BY tenant_id, vehicle_id, vin, stock;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_settings, public.dealer_template_preferences, public.dealer_rule_preferences, public.dealer_branding, public.dealer_review_sources, public.dealer_passport_settings, public.dealer_cpo_programs, public.dealer_price_labels, public.document_lifecycle_events, public.signature_evidence, public.ct_mvp_certification_runs TO authenticated;
GRANT SELECT ON public.ct_mvp_compliance_digest_outbox, public.customer_engagement_events, public.customer_engagement_vehicle_summary, public.customer_engagement_document_summary, public.passport_delivery_settings, public.passport_document_delivery_requests, public.passport_document_delivery_outbox, public.passport_delivery_request_summary TO authenticated;
GRANT ALL ON public.dealer_settings, public.dealer_template_preferences, public.dealer_rule_preferences, public.dealer_branding, public.dealer_review_sources, public.dealer_passport_settings, public.dealer_cpo_programs, public.dealer_price_labels, public.document_lifecycle_events, public.signature_evidence, public.ct_mvp_certification_runs, public.ct_mvp_compliance_digest_outbox, public.customer_engagement_events, public.passport_delivery_settings, public.passport_document_delivery_requests, public.passport_sms_verifications, public.passport_document_delivery_outbox TO service_role;