
DROP POLICY IF EXISTS "ct_mvp_digest_outbox_authenticated_read" ON public.ct_mvp_compliance_digest_outbox;
CREATE POLICY "ct_mvp_digest_outbox_authenticated_read"
  ON public.ct_mvp_compliance_digest_outbox FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tm.tenant_id::text FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL
  ));

DROP POLICY IF EXISTS "customer_engagement_events_authenticated_read" ON public.customer_engagement_events;
CREATE POLICY "customer_engagement_events_authenticated_read"
  ON public.customer_engagement_events FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tm.tenant_id::text FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL
  ));

DROP POLICY IF EXISTS "passport_delivery_outbox_authenticated_read" ON public.passport_document_delivery_outbox;
CREATE POLICY "passport_delivery_outbox_authenticated_read"
  ON public.passport_document_delivery_outbox FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tm.tenant_id::text FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL
  ));

DROP POLICY IF EXISTS "passport_document_delivery_requests_authenticated_read" ON public.passport_document_delivery_requests;
CREATE POLICY "passport_document_delivery_requests_authenticated_read"
  ON public.passport_document_delivery_requests FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tm.tenant_id::text FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL
  ));

DROP POLICY IF EXISTS "passport_delivery_settings_authenticated_read" ON public.passport_delivery_settings;
CREATE POLICY "passport_delivery_settings_authenticated_read"
  ON public.passport_delivery_settings FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tm.tenant_id::text FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL
  ));

DROP POLICY IF EXISTS "tenant read usage" ON public.autolabels_usage_events;
CREATE POLICY "tenant read usage" ON public.autolabels_usage_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));
DROP POLICY IF EXISTS "tenant insert usage" ON public.autolabels_usage_events;
CREATE POLICY "tenant insert usage" ON public.autolabels_usage_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant dealer_print_settings" ON public.dealer_print_settings;
CREATE POLICY "tenant dealer_print_settings" ON public.dealer_print_settings FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "dealer prefs" ON public.dealer_sticker_template_prefs;
CREATE POLICY "dealer prefs" ON public.dealer_sticker_template_prefs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant dealer_template_customizations" ON public.dealer_template_customizations;
CREATE POLICY "tenant dealer_template_customizations" ON public.dealer_template_customizations FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant generated_documents" ON public.generated_documents;
CREATE POLICY "tenant generated_documents" ON public.generated_documents FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant qr_codes" ON public.qr_codes;
CREATE POLICY "tenant qr_codes" ON public.qr_codes FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant read qr_scan_events" ON public.qr_scan_events;
CREATE POLICY "tenant read qr_scan_events" ON public.qr_scan_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant select stale_document_flags" ON public.stale_document_flags;
CREATE POLICY "tenant select stale_document_flags" ON public.stale_document_flags FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));
DROP POLICY IF EXISTS "tenant insert stale_document_flags" ON public.stale_document_flags;
CREATE POLICY "tenant insert stale_document_flags" ON public.stale_document_flags FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));
DROP POLICY IF EXISTS "tenant update stale_document_flags" ON public.stale_document_flags;
CREATE POLICY "tenant update stale_document_flags" ON public.stale_document_flags FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant vehicle_addendums" ON public.vehicle_addendums;
CREATE POLICY "tenant vehicle_addendums" ON public.vehicle_addendums FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
    WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "tenant vehicle_addendum_items" ON public.vehicle_addendum_items;
CREATE POLICY "tenant vehicle_addendum_items" ON public.vehicle_addendum_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_addendums a
    WHERE a.id = vehicle_addendum_items.vehicle_addendum_id
      AND a.tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
        WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vehicle_addendums a
    WHERE a.id = vehicle_addendum_items.vehicle_addendum_id
      AND a.tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
        WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL)
  ));

DROP POLICY IF EXISTS "Authenticated users can subscribe" ON realtime.messages;
CREATE POLICY "Authenticated users can subscribe" ON realtime.messages FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL AND (
      realtime.topic() LIKE 'rt-%'
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = (SELECT auth.uid())
          AND tm.accepted_at IS NOT NULL
          AND position(tm.tenant_id::text in realtime.topic()) > 0
      )
    )
  );

DROP POLICY IF EXISTS "Authenticated users can broadcast" ON realtime.messages;
CREATE POLICY "Authenticated users can broadcast" ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL AND (
      realtime.topic() LIKE 'rt-%'
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = (SELECT auth.uid())
          AND tm.accepted_at IS NOT NULL
          AND position(tm.tenant_id::text in realtime.topic()) > 0
      )
    )
  );

ALTER VIEW public.customer_engagement_vehicle_summary SET (security_invoker = true);
ALTER VIEW public.customer_engagement_document_summary SET (security_invoker = true);
ALTER VIEW public.passport_delivery_request_summary SET (security_invoker = true);

ALTER FUNCTION public.set_updated_at() SET search_path = public;
