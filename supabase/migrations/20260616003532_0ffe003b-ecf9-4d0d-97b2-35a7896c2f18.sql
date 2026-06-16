CREATE OR REPLACE FUNCTION public.mark_addendum_executed(_addendum_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.addendums
    SET lifecycle_status = 'fully_executed'
  WHERE id = _addendum_id AND lifecycle_status <> 'fully_executed';

  INSERT INTO public.addendum_events (addendum_id, event, actor)
    VALUES (_addendum_id, 'executed', 'system');
END; $$;

GRANT EXECUTE ON FUNCTION public.mark_addendum_executed(uuid) TO authenticated;