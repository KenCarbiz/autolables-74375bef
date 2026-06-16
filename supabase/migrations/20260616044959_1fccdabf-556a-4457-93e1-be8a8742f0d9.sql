CREATE OR REPLACE FUNCTION public.record_addendum_event(
  _signing_token uuid, _event text, _channel text DEFAULT NULL, _details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _new text;
BEGIN
  SELECT id INTO _id FROM public.addendums WHERE signing_token = _signing_token LIMIT 1;
  IF _id IS NULL THEN RETURN; END IF;

  INSERT INTO public.addendum_events (addendum_id, signing_token, event, channel, actor, details)
  VALUES (_id, _signing_token, _event, _channel, 'customer', COALESCE(_details,'{}'::jsonb));

  _new := CASE _event WHEN 'customer_opened' THEN 'customer_opened'
                      WHEN 'reviewing' THEN 'customer_opened'
                      WHEN 'customer_signed' THEN 'partially_signed' ELSE NULL END;

  IF _new IS NOT NULL THEN
    PERFORM set_config('app.allow_lifecycle_update', 'on', true);
    UPDATE public.addendums SET lifecycle_status = _new
     WHERE id = _id AND lifecycle_status NOT IN ('partially_signed','fully_executed','archived')
       AND lifecycle_status <> _new;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_addendum_event(uuid,text,text,jsonb) TO anon, authenticated;