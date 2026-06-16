CREATE OR REPLACE FUNCTION public.block_signed_addendum_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.allow_lifecycle_update', true) = 'on' THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN RETURN NEW; END IF;
  IF (OLD.status = 'signed' OR OLD.customer_signed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Signed addendum is immutable (id %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_addendum_executed(_addendum_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.allow_lifecycle_update', 'on', true);
  UPDATE public.addendums SET lifecycle_status = 'fully_executed'
   WHERE id = _addendum_id AND lifecycle_status <> 'fully_executed';
  INSERT INTO public.addendum_events (addendum_id, event, actor)
   VALUES (_addendum_id, 'executed', 'system');
END; $$;

GRANT EXECUTE ON FUNCTION public.mark_addendum_executed(uuid) TO authenticated;