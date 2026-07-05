-- The customer_engagement_events CHECK predates the PassportCtaDock's six
-- customer_passport_* CTA signals (reserve/trade/call/contact/open/close), so
-- inserting them aborted the batch and those clicks never persisted. Extend the
-- allowed set to match the client tracker's full event enum.
ALTER TABLE public.customer_engagement_events
  DROP CONSTRAINT IF EXISTS customer_engagement_events_event_type_check;

ALTER TABLE public.customer_engagement_events
  ADD CONSTRAINT customer_engagement_events_event_type_check CHECK (event_type IN (
    'passport_opened','window_sticker_scanned','public_listing_opened','packet_opened',
    'document_opened','document_downloaded','document_printed','photo_viewed','video_played',
    'cta_clicked','lead_form_opened','lead_submitted','share_clicked','call_clicked',
    'text_clicked','directions_clicked','finance_clicked','trade_clicked','scroll_depth',
    'time_on_page','engagement_ping',
    'customer_passport_opened','customer_passport_closed','customer_passport_reserve_clicked',
    'customer_passport_trade_clicked','customer_passport_call_clicked','customer_passport_contact_clicked'
  ));
