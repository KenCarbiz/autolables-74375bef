CREATE OR REPLACE FUNCTION public.get_or_create_install_token(_store_id text, _vin text, _ymm text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tok uuid; _slug text;
BEGIN
  SELECT install_token INTO _tok FROM public.vehicle_listings
   WHERE vin = _vin AND store_id = _store_id LIMIT 1;
  IF _tok IS NOT NULL THEN RETURN _tok; END IF;
  _slug := lower(regexp_replace(coalesce(_ymm,'vehicle'), '[^a-z0-9]+', '-', 'gi'))
           || '-' || right(_vin, 6) || '-' || substr(md5(random()::text), 1, 5);
  INSERT INTO public.vehicle_listings (store_id, vin, ymm, slug, status)
  VALUES (_store_id, _vin, _ymm, _slug, 'draft')
  ON CONFLICT DO NOTHING
  RETURNING install_token INTO _tok;
  IF _tok IS NULL THEN
    SELECT install_token INTO _tok FROM public.vehicle_listings
     WHERE vin = _vin AND store_id = _store_id LIMIT 1;
  END IF;
  RETURN _tok;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_or_create_install_token(text,text,text) TO authenticated;